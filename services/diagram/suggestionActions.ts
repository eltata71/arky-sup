/**
 * Deterministic action enrichment for diagram suggestions.
 *
 * Gap 13 — the suggestion panel must offer EXECUTABLE actions, not only
 * advisory text. This module inspects the IR + quality report and emits
 * `ArtifactSuggestionAction[]` payloads that the UI can run directly
 * (apply ELK layout, change orientation, set density, convert process to
 * BPMN, tag PHI/PII, regenerate with IR-direct…).
 *
 * Pure / synchronous — no side effects, no AI call. Safe to run on
 * every render.
 */

import type {
    ArtifactSuggestion,
    ArtifactSuggestionAction,
} from '../../lib/artifacts/artifactSuggestions';
import type { DiagramIR } from '../../lib/diagram';
import type { DiagramQualityReport } from './quality/diagramQualityService';

export interface SuggestionActionContext {
    ir: DiagramIR;
    quality?: DiagramQualityReport | null;
    /** Current canvas direction so toggle actions invert correctly. */
    currentDirection?: 'TB' | 'LR';
    /** Current canvas density so the density buttons disable the active one. */
    currentDensity?: 'compact' | 'normal' | 'spacious';
}

/**
 * Build the deterministic action catalog for a diagram. The catalog is
 * always non-empty: at minimum it surfaces the regenerate / repair
 * options so the panel never shows a suggestion without a button.
 */
export function buildDiagramSuggestionActions(ctx: SuggestionActionContext): ArtifactSuggestionAction[] {
    const { ir, quality, currentDirection = 'TB', currentDensity = 'normal' } = ctx;
    const actions: ArtifactSuggestionAction[] = [];

    // Apply ELK layout — always available for non-sequence/state diagrams.
    const dtype = ir.metadata?.diagramType;
    if (dtype !== 'sequence' && dtype !== 'erd') {
        actions.push({
            kind: 'apply-elk-layout',
            label: 'Aplicar ELK layered',
            description: 'Re-corre el layout con ELK + ruteo ortogonal para reducir cruces.',
        });
    }

    // Toggle direction.
    actions.push({
        kind: 'set-layout-direction',
        label: currentDirection === 'TB' ? 'Cambiar a izquierda → derecha (LR)' : 'Cambiar a arriba → abajo (TB)',
        params: { direction: currentDirection === 'TB' ? 'LR' : 'TB' },
    });

    // Density triplet.
    const densities: Array<{ value: 'compact' | 'normal' | 'spacious'; label: string }> = [
        { value: 'compact', label: 'Densidad compact' },
        { value: 'normal', label: 'Densidad normal' },
        { value: 'spacious', label: 'Densidad spacious' },
    ];
    for (const d of densities) {
        if (d.value === currentDensity) continue;
        actions.push({
            kind: 'set-layout-density',
            label: d.label,
            params: { density: d.value },
        });
    }

    // BPMN conversion — when the diagram looks like a generic process and
    // has no BPMN start/end events yet.
    const looksLikeProcess = /process|flow|workflow/i.test(`${ir.metadata?.title ?? ''} ${dtype ?? ''}`);
    const hasBpmnStart = ir.nodes.some((n) => /(start[_-]?event|inicio|trigger)/i.test(`${n.kind ?? ''} ${n.label}`));
    const hasBpmnEnd = ir.nodes.some((n) => /(end[_-]?event|fin|complete|t[eé]rmino)/i.test(`${n.kind ?? ''} ${n.label}`));
    if (looksLikeProcess && !hasBpmnStart) {
        actions.push({
            kind: 'convert-to-bpmn',
            label: 'Convertir a BPMN enriquecido',
            description: 'Agrega Start/End events, gateways y swimlanes para cumplir BPMN 2.0.',
        });
    }

    // BPMN visual maturity actions — only surfaced for BPMN-shaped
    // diagrams (explicit metadata, "process / flow / workflow" title or
    // existing BPMN nodes).
    const isBpmnDiagram = dtype === 'bpmn-process' || looksLikeProcess || hasBpmnStart || hasBpmnEnd;
    if (isBpmnDiagram) {
        // Start/End event healing.
        if (!hasBpmnStart || !hasBpmnEnd) {
            actions.push({
                kind: 'add-bpmn-start-end-events',
                label: 'Agregar eventos BPMN faltantes (Inicio/Fin)',
                description: 'Inserta los eventos canónicos para cerrar el proceso según BPMN 2.0.',
            });
        }

        // Swimlane creation from owners.
        const ownerCount = new Set(
            ir.nodes
                .map((n) => (n.owner ?? n.domain ?? '').trim().toLowerCase())
                .filter(Boolean)
        ).size;
        const swimlaneCount = ir.groups.filter((g) => g.kind === 'swimlane').length;
        if (ownerCount >= 2 && swimlaneCount < 2) {
            actions.push({
                kind: 'create-swimlanes-from-owners',
                label: `Crear ${ownerCount} swimlane(s) a partir de los owners`,
                description: 'Convierte los owners/domain en carriles BPMN para que la asignación por participante sea visible.',
            });
        }

        // Message vs sequence flow re-typing.
        if (swimlaneCount >= 2) {
            const laneByNode = new Map<string, string>();
            for (const group of ir.groups) {
                if (group.kind !== 'swimlane') continue;
                for (const id of group.nodeIds) laneByNode.set(id, group.id);
            }
            const crossLaneSequence = ir.edges.filter((e) => {
                const sLane = laneByNode.get(e.source);
                const tLane = laneByNode.get(e.target);
                if (!sLane || !tLane || sLane === tLane) return false;
                const sem = (e.semanticType ?? '').toLowerCase();
                const rel = (e.relation ?? '').toLowerCase();
                const looksAsync = sem === 'async-messaging' || sem === 'event' || sem === 'publish' || sem === 'subscribe' || rel === 'async';
                return !looksAsync;
            }).length;
            if (crossLaneSequence > 0) {
                actions.push({
                    kind: 'mark-edges-as-message-flow',
                    label: `Convertir ${crossLaneSequence} cruce(s) a message flow`,
                    description: 'BPMN 2.0 reserva sequence flow para dentro de una lane; los cruces deben ser message flow.',
                });
            }
            const inLaneMessage = ir.edges.filter((e) => {
                const sLane = laneByNode.get(e.source);
                const tLane = laneByNode.get(e.target);
                if (!sLane || !tLane || sLane !== tLane) return false;
                const sem = (e.semanticType ?? '').toLowerCase();
                const rel = (e.relation ?? '').toLowerCase();
                return sem === 'async-messaging' || sem === 'event' || sem === 'publish' || sem === 'subscribe' || rel === 'async';
            }).length;
            if (inLaneMessage > 0) {
                actions.push({
                    kind: 'mark-edges-as-sequence-flow',
                    label: `Restaurar ${inLaneMessage} flujo(s) within-lane como sequence flow`,
                    description: 'Dentro de la misma lane el flujo correcto es sequence flow.',
                });
            }
        }

        // Layout repair — only when the current plan is suboptimal for BPMN.
        const plan = ir.metadata?.layoutPlan;
        const planLooksWrongForBpmn = !plan || plan.direction !== 'LR' || plan.backend !== 'elk' || plan.algorithm !== 'layered';
        if (planLooksWrongForBpmn) {
            actions.push({
                kind: 'repair-bpmn-layout',
                label: 'Reparar layout BPMN (LR + ELK layered)',
                description: 'BPMN se lee mejor de izquierda a derecha; ajustamos backend, dirección y densidad.',
            });
        }
    }

    // Assign group.kind when groups exist but lack kind.
    const groupsWithoutKind = ir.groups.filter((g) => !g.kind);
    if (groupsWithoutKind.length > 0) {
        actions.push({
            kind: 'assign-group-kind',
            label: `Asignar tipo a ${groupsWithoutKind.length} boundary/grupo(s)`,
            description: 'Clasifica cada grupo (swimlane / system-boundary / security / data / cloud) para colorear el boundary correctamente.',
            params: { count: String(groupsWithoutKind.length) },
        });
    }

    // Protocols missing on critical edges.
    const missingProtocol = ir.edges.filter((e) => !e.protocol && (e.criticality === 'critical' || e.criticality === 'high'));
    if (missingProtocol.length > 0) {
        actions.push({
            kind: 'add-missing-protocols',
            label: `Agregar protocolo a ${missingProtocol.length} relación(es) críticas`,
            description: 'Las relaciones críticas deben declarar REST/HTTPS, Kafka, JDBC, etc.',
            params: { count: String(missingProtocol.length) },
        });
    }

    // Security controls on critical async edges.
    const missingSecurity = ir.edges.filter((e) =>
        (e.criticality === 'critical' || e.criticality === 'high')
        && !e.security
        && !/oauth|jwt|mtls|api[\s-]?key|saml|hmac/i.test(`${e.label ?? ''} ${e.protocol ?? ''}`),
    );
    if (missingSecurity.length > 0) {
        actions.push({
            kind: 'add-security-controls',
            label: `Documentar seguridad en ${missingSecurity.length} flujo(s) críticos`,
            description: 'Añade el mecanismo (OAuth2 / JWT / mTLS / API Key) en relaciones críticas.',
            params: { count: String(missingSecurity.length) },
        });
    }

    // Healthcare / insurance PHI tagging.
    const looksHealthcare = /(salud|health|insurer|aseguradora|prestador|hipaa|fhir|hl7|ncpdp|x12)/i
        .test(`${ir.metadata?.title ?? ''} ${ir.nodes.map((n) => n.label).join(' ')}`);
    if (looksHealthcare) {
        const untaggedNodes = ir.nodes.filter((n) => !n.dataClassification);
        if (untaggedNodes.length > 0) {
            actions.push({
                kind: 'tag-phi-pii',
                label: 'Etiquetar PHI/PII/PCI en nodos relevantes',
                description: 'Marca nodos con clasificación PHI / PII / PCI para cumplir HIPAA / GDPR / PCI-DSS.',
                params: { scope: 'nodes' },
            });
        }
    }

    // Audience switches.
    const audience = ir.metadata?.audience;
    if (audience !== 'executive') {
        actions.push({
            kind: 'switch-audience',
            label: 'Crear vista ejecutiva simplificada',
            description: 'Genera una proyección de 4–8 nodos sin jerga técnica.',
            params: { audience: 'executive' },
        });
    }
    if (audience !== 'technical') {
        actions.push({
            kind: 'switch-audience',
            label: 'Crear vista técnica detallada',
            description: 'Genera una proyección 8–24 nodos con protocolos y tecnología.',
            params: { audience: 'technical' },
        });
    }

    // C4 separation when the diagram mixes levels.
    if (dtype && dtype.startsWith('c4-')) {
        const groups = new Set(ir.nodes.map((n) => n.group ?? '').filter(Boolean));
        const hasInternals = ir.nodes.some((n) => /(component|class|table|pod|dto|repository|controller)/i.test(`${n.label} ${n.kind ?? ''}`));
        if (dtype === 'c4-context' && (groups.size > 1 || hasInternals)) {
            actions.push({
                kind: 'split-c4-levels',
                label: 'Separar Contexto / Container / Component',
                description: 'Divide el diagrama actual en los 3 niveles C4 para mantener foco por nivel.',
            });
        }
    }

    // Regenerate with IR-direct preserving metadata.
    actions.push({
        kind: 'regenerate-with-ir-direct',
        label: 'Regenerar con IR-direct conservando metadata',
        description: 'Vuelve a llamar al modelo en modo IR-direct manteniendo owner, compliance y trust.',
    });

    // Repair exportability when preflight has failing checks (heuristic
    // using quality score).
    if (quality && (quality.score < 70 || (quality.issues ?? []).some((i) => i.severity === 'critical'))) {
        actions.push({
            kind: 'repair-exportability',
            label: 'Reparar exportabilidad',
            description: 'Auto-mejora el diagrama hasta que pase los checks de preflight.',
        });
    }

    return actions;
}

/**
 * Enrich a suggestion list (typically returned by the AI) with executable
 * actions when the suggestion doesn't already declare them.
 */
export function enrichSuggestionsWithActions(
    suggestions: ArtifactSuggestion[],
    ctx: SuggestionActionContext,
): ArtifactSuggestion[] {
    const catalog = buildDiagramSuggestionActions(ctx);
    return suggestions.map((s) => {
        if (s.actions && s.actions.length > 0) return s;
        // Pick a handful of actions that loosely match the suggestion gap.
        const lower = `${s.title} ${s.description} ${s.recommendedAction}`.toLowerCase();
        const picks: ArtifactSuggestionAction[] = catalog.filter((a) => {
            switch (a.kind) {
                case 'apply-elk-layout':
                case 'set-layout-direction':
                case 'set-layout-density':
                    return /(layout|posición|posicion|orient|densid|cruce|overlap|aspect)/i.test(lower);
                case 'convert-to-bpmn':
                    return /(bpmn|proceso|process|workflow|flow)/i.test(lower);
                case 'assign-group-kind':
                    return /(group|boundary|swimlane|lane|zona|cluster)/i.test(lower);
                case 'add-missing-protocols':
                    return /(protocol|rest|http|integraci|protocolo)/i.test(lower);
                case 'add-security-controls':
                    return /(security|seguridad|oauth|jwt|mtls|cifrad)/i.test(lower);
                case 'tag-phi-pii':
                    return /(phi|pii|pci|hipaa|gdpr|sensibil|salud|health)/i.test(lower);
                case 'switch-audience':
                    return /(audiencia|ejecutiv|c-level|stakeholder|t[eé]cnic)/i.test(lower);
                case 'split-c4-levels':
                    return /(c4|context|container|component)/i.test(lower);
                case 'regenerate-with-ir-direct':
                    return /(regener|reintenta|repetir|mejorar)/i.test(lower);
                case 'repair-exportability':
                    return /(export|preflight|recorte|cropping|recortar)/i.test(lower);
                case 'add-bpmn-start-end-events':
                    return /(bpmn|inicio|start|end|fin|evento)/i.test(lower);
                case 'create-swimlanes-from-owners':
                    return /(swimlane|carril|owner|participante)/i.test(lower);
                case 'mark-edges-as-message-flow':
                    return /(message[\s_-]?flow|mensaje|cross[\s_-]?lane|cruce)/i.test(lower);
                case 'mark-edges-as-sequence-flow':
                    return /(sequence[\s_-]?flow|secuencia|within[\s_-]?lane|dentro)/i.test(lower);
                case 'repair-bpmn-layout':
                    return /(bpmn|layout|carril|swimlane|lr|legibilidad)/i.test(lower);
                default:
                    return false;
            }
        }).slice(0, 3);
        return picks.length > 0 ? { ...s, actions: picks } : s;
    });
}
