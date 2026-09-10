import type { Edge, Node } from 'reactflow';
import type { Artifact } from '../../types';
import type { DiagramAudience, DiagramIR } from '../../lib/diagram';
import { extractMermaidCode } from '../../utils/diagram/extractMermaid';
import { extractIRFromArtifact, mermaidToIR, renderIRToReactFlow } from './index';
import { projectIR } from './audienceProjector';
import { analyzeDiagramQuality, toDiagramIR } from './quality/diagramQualityService';
import { migrateDiagramIROrSelf } from './irMigration';
import { runDiagramQualityGate, type QualityGateChange } from './qualityGate';
import { annotateDiagramType } from './diagramTypeInference';

export type RenderableSource = 'artifact.ir' | 'content.mermaid' | 'content.reactflow' | 'generated.ir' | 'fallback';
export type RenderableStatus = 'ready' | 'repairable' | 'invalid';

export interface DiagramDiagnostics {
    stage:
        | 'artifact-ir'
        | 'extract-mermaid'
        | 'parse-mermaid'
        | 'build-ir'
        | 'audience-projection'
        | 'reactflow-conversion'
        | 'layout';
    message: string;
    detail?: string;
}

export interface RenderableDiagramResolution {
    status: RenderableStatus;
    source: RenderableSource;
    ir: DiagramIR | null;
    reactFlow: { nodes: Node[]; edges: Edge[] };
    diagnostics: DiagramDiagnostics[];
    quality: ReturnType<typeof analyzeDiagramQuality> | null;
    warnings: string[];
    repairActions: string[];
    counters: {
        baseNodes: number;
        projectedNodes: number;
        renderNodes: number;
        validEdges: number;
    };
    /** Changes the deterministic quality gate applied to the IR before render. */
    qualityGateChanges: QualityGateChange[];
    /** True when the quality gate brought the IR to ≥ 90/100. */
    qualityGateReachedTarget: boolean;
}

interface ResolveOptions {
    audience: DiagramAudience;
    generatedFlow?: { nodes: Node[]; edges: Edge[] } | null;
}

const EMPTY_FLOW = { nodes: [] as Node[], edges: [] as Edge[] };

const toValidEdges = (ir: DiagramIR) => {
    const ids = new Set(ir.nodes.map((n) => n.id));
    return ir.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
};

/**
 * Last-resort placeholder IR for artifacts whose content failed to produce a
 * renderable diagram. Surfaces the failure visually instead of leaving the
 * canvas blank, so the architect knows what to do (regenerate or edit).
 */
function buildPlaceholderIR(artifact: Pick<Artifact, 'id' | 'type' | 'content'>): DiagramIR {
    const dialect =
        artifact.type === 'mermaid-c4-context' ? 'C4 Contexto' :
        artifact.type === 'mermaid-c4-container' ? 'C4 Contenedor' :
        artifact.type === 'mermaid-c4-component' ? 'C4 Componente' :
        artifact.type === 'mermaid-c4-deployment' ? 'C4 Despliegue' :
        artifact.type === 'mermaid-erd' ? 'ERD' :
        artifact.type === 'mermaid-sequence' ? 'Secuencia' :
        artifact.type === 'mermaid-state' ? 'Estado' :
        artifact.type === 'mermaid-gantt' ? 'Gantt' :
        artifact.type === 'mermaid-graph' ? 'Flujo / Integración' :
        artifact.type === 'react-flow-graph' ? 'ReactFlow' :
        artifact.type === 'hybrid-text-diagram' ? 'Híbrido (texto+diagrama)' :
        'Diagrama';
    return {
        nodes: [
            {
                id: 'placeholder-info',
                label: 'Diagrama no disponible',
                kind: 'system',
                description: `La IA no produjo un ${dialect} válido. Pulsa "Generar de Nuevo" o edita el contenido desde la pestaña Documento.`,
                shape: 'rectangle',
                status: 'warning',
            },
            {
                id: 'placeholder-action',
                label: 'Generar de nuevo',
                kind: 'process',
                description: 'Reintentar la generación con el mismo template.',
                shape: 'rectangle',
                status: 'active',
            },
        ],
        edges: [
            {
                id: 'placeholder-edge',
                source: 'placeholder-info',
                target: 'placeholder-action',
                label: 'Acción sugerida',
                relation: 'default',
            },
        ],
        groups: [],
        metadata: {
            title: 'Marcador de posición',
            sourceFormat: 'unknown',
            generatedAt: new Date().toISOString(),
            degradationReason: 'no-parseable-content',
        },
    };
}

const sanitizeIR = (ir: DiagramIR): DiagramIR => {
    const coerceNode = (raw: DiagramIR['nodes'][number]) => {
        const legacyData = (raw as unknown as { data?: { label?: string; type?: string; description?: string; kind?: string; technology?: string } }).data;
        const label = (raw.label && raw.label.trim().length > 0)
            ? raw.label
            : (legacyData?.label?.trim() || raw.id);
        const kind = raw.kind || legacyData?.kind || legacyData?.type || 'system';
        const description = raw.description ?? legacyData?.description;
        const technology = raw.technology ?? legacyData?.technology ?? legacyData?.type;
        return {
            ...raw,
            label,
            kind,
            ...(description ? { description } : {}),
            ...(technology ? { technology } : {}),
        };
    };

    // Defence in depth: instead of dropping nodes whose label is empty (which
    // can wipe out the entire canvas when an upstream parser yields blank
    // labels), we patch the label with the id as a last-resort fallback.  The
    // user can rename the node, but the diagram still renders.
    const nodes = ir.nodes
        .filter((n) => n && typeof n === 'object' && typeof n.id === 'string' && n.id.length > 0)
        .map(coerceNode);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = ir.edges.filter((e) => e.source && e.target && ids.has(e.source) && ids.has(e.target));
    return { ...ir, nodes, edges };
};

export function resolveRenderableDiagram(
    artifact: Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>,
    options: ResolveOptions,
): RenderableDiagramResolution {
    const diagnostics: DiagramDiagnostics[] = [];
    const warnings: string[] = [];
    const repairActions: string[] = [];

    let source: RenderableSource = 'fallback';
    let baseIR: DiagramIR | null = null;

    if (artifact.ir && artifact.ir.nodes?.length > 0) {
        // The `artifact.ir` payload comes from Firestore and may have been
        // persisted by an older schema (legacy kinds, missing metadata,
        // dangling refs).  Migrate transparently before sanitising so the
        // canvas always sees the current contract.
        baseIR = sanitizeIR(migrateDiagramIROrSelf(artifact.ir));
        // Phase 2: annotate the explicit diagram archetype on the IR so
        // downstream renderers / quality gates / the selector all agree on
        // the type without re-running heuristics.
        baseIR = annotateDiagramType(baseIR, artifact.type);
        source = 'artifact.ir';
    }

    if (!baseIR && options.generatedFlow?.nodes?.length) {
        baseIR = sanitizeIR(toDiagramIR(options.generatedFlow.nodes, options.generatedFlow.edges));
        baseIR = annotateDiagramType(baseIR, artifact.type);
        source = 'generated.ir';
    }

    if (!baseIR) {
        const extracted = extractIRFromArtifact({
            content: artifact.content,
            representation: artifact.representation,
            type: artifact.type,
        });
        if (extracted?.nodes?.length) {
            baseIR = sanitizeIR(extracted);
            baseIR = annotateDiagramType(baseIR, artifact.type);
            source = artifact.type === 'react-flow-graph' ? 'content.reactflow' : 'content.mermaid';
        }
    }

    if (!baseIR) {
        const mermaid = extractMermaidCode(artifact.content, artifact.representation);
        if (mermaid) {
            try {
                baseIR = sanitizeIR(mermaidToIR(mermaid));
                baseIR = annotateDiagramType(baseIR, artifact.type);
                source = 'content.mermaid';
            } catch (error) {
                diagnostics.push({
                    stage: 'parse-mermaid',
                    message: 'No fue posible parsear Mermaid a DiagramIR.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    // Propagate the deterministic-skeleton flag from raw content to IR
    // metadata so the canvas can render the "Esqueleto base — edítame" badge.
    // The marker is inserted by `buildDeterministicDiagramSkeleton` and
    // travels through `mermaidToIR` as a stripped comment, so we detect it
    // by inspecting the original content blob here.
    if (baseIR && typeof artifact.content === 'string' && artifact.content.includes('arky:skeleton-fallback')) {
        baseIR = {
            ...baseIR,
            metadata: {
                ...(baseIR.metadata ?? {}),
                fallback: 'skeleton',
                degradationReason:
                    baseIR.metadata?.degradationReason ??
                    'Contenido proviene del esqueleto determinista local (la IA no devolvió un diagrama parseable).',
            },
        };
    }

    if (!baseIR || baseIR.nodes.length === 0) {
        diagnostics.push({
            stage: 'build-ir',
            message: 'No se pudo construir un DiagramIR renderizable.',
            detail: `artifact=${artifact.id} type=${artifact.type} contentLen=${(artifact.content ?? '').length}`,
        });
        repairActions.push('Regenerar diagrama (la IA no produjo Mermaid válido)');
        repairActions.push('Editar contenido manualmente desde la pestaña Documento');
        repairActions.push('Copiar reporte técnico para soporte');

        // Last-resort placeholder. Instead of returning a totally empty
        // canvas (which is indistinguishable from a render bug), we emit a
        // tiny IR that explains to the architect what happened. The
        // placeholder is visually distinct (status: 'warning') so the user
        // immediately sees that the artifact failed to generate and can
        // click "Generar de Nuevo".
        const placeholder = buildPlaceholderIR(artifact);
        const placeholderRender = renderIRToReactFlow(placeholder);
        const placeholderQuality = analyzeDiagramQuality(placeholder);
        return {
            status: 'repairable',
            source,
            ir: placeholder,
            reactFlow: placeholderRender,
            diagnostics,
            quality: placeholderQuality,
            warnings: [...warnings, 'El artefacto se guardó sin un diagrama parseable. Se muestra un marcador de posición para que puedas regenerar.'],
            repairActions,
            counters: {
                baseNodes: 0,
                projectedNodes: placeholder.nodes.length,
                renderNodes: placeholderRender.nodes.length,
                validEdges: placeholder.edges.length,
            },
            qualityGateChanges: [],
            qualityGateReachedTarget: false,
        };
    }

    // ── Quality gate ───────────────────────────────────────────────────────
    // Always runs in CONSERVATIVE mode (no description fill, no label
    // humanisation, no id rewriting) so existing diagrams keep their visual
    // identity. The pass only fixes structural issues that would prevent
    // rendering: dangling edges, orphan nodes, missing groups, missing
    // metadata. Errors are caught so a broken pass can never blank the
    // canvas.
    //
    // Persisted IRs (`source === 'artifact.ir'`) that already declare a
    // quality score >= 90 skip the gate entirely (already polished by the
    // generation pipeline).
    const skipGate = source === 'artifact.ir'
        && (baseIR.metadata?.qualityReview?.score ?? 0) >= 90;
    let gateResult: ReturnType<typeof runDiagramQualityGate> | null = null;
    if (!skipGate) {
        try {
            const candidate = runDiagramQualityGate(baseIR, {
                artifact: { name: artifact.id, type: artifact.type, audience: options.audience },
                audience: options.audience,
                targetScore: 90,
                maxPasses: 1,
                aggressive: false,
            });
            // Defensive: never let the gate strip nodes from the IR.
            if (candidate.ir.nodes.length >= baseIR.nodes.length) {
                gateResult = candidate;
                baseIR = candidate.ir;
            } else {
                warnings.push('Quality gate produjo menos nodos; usando IR base.');
            }
        } catch (err) {
            // Quality-gate exceptions must never blank the canvas. Log and
            // keep the original IR so the user sees the diagram regardless.
            console.warn('[resolveRenderableDiagram] quality gate threw; using base IR', err);
        }
    }

    const projected = sanitizeIR(projectIR(baseIR, options.audience));
    let renderIR = projected;

    if (projected.nodes.length === 0 && baseIR.nodes.length > 0) {
        renderIR = baseIR;
        warnings.push('La proyección por audiencia quedó vacía. Se usa la vista completa.');
        diagnostics.push({
            stage: 'audience-projection',
            message: 'Proyección vacía, fallback al IR base.',
            detail: `audience=${options.audience}`,
        });
    }

    const reactFlow = renderIR.nodes.length > 0 ? renderIRToReactFlow(renderIR) : EMPTY_FLOW;
    const renderNodes = reactFlow.nodes.length;
    const validEdges = toValidEdges(renderIR).length;

    if (renderNodes === 0) {
        diagnostics.push({
            stage: 'reactflow-conversion',
            message: 'La conversión a React Flow terminó sin nodos visibles.',
            detail: `renderIR.nodes=${renderIR.nodes.length} baseIR.nodes=${baseIR.nodes.length} projected.nodes=${projected.nodes.length} source=${source}`,
        });
        repairActions.push('Reparar IR eliminando nodos/edges inválidos');
        repairActions.push('Copiar reporte técnico para soporte');
        if (renderIR.nodes.length > 0) {
            console.warn('[resolveRenderableDiagram] non-empty IR produced empty ReactFlow output', {
                renderIRNodes: renderIR.nodes.length,
                renderIREdges: renderIR.edges.length,
                source,
            });
        }
        const placeholder = buildPlaceholderIR(artifact);
        const placeholderRender = renderIRToReactFlow(placeholder);
        const placeholderQuality = analyzeDiagramQuality(placeholder);
        return {
            status: 'repairable',
            source,
            ir: placeholder,
            reactFlow: placeholderRender,
            diagnostics,
            quality: placeholderQuality,
            warnings: [...warnings, 'El render final no produjo nodos visibles. Se muestra un placeholder accionable en lugar de canvas vacío.'],
            repairActions,
            counters: {
                baseNodes: baseIR.nodes.length,
                projectedNodes: projected.nodes.length,
                renderNodes: placeholderRender.nodes.length,
                validEdges: placeholder.edges.length,
            },
            qualityGateChanges: gateResult?.changes ?? [],
            qualityGateReachedTarget: false,
        };
    }

    const quality = analyzeDiagramQuality(renderIR);
    const status: RenderableStatus = 'ready';

    return {
        status,
        source,
        ir: renderIR,
        reactFlow,
        diagnostics,
        quality,
        warnings,
        repairActions,
        counters: {
            baseNodes: baseIR.nodes.length,
            projectedNodes: projected.nodes.length,
            renderNodes,
            validEdges,
        },
        qualityGateChanges: gateResult?.changes ?? [],
        qualityGateReachedTarget: gateResult?.reachedTarget ?? quality.score >= 90,
    };
}
