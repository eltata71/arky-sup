/**
 * Canonical diagram pipeline entry point.
 *
 * Call sites should prefer these functions over the AI-powered Gemini ones
 * (`parseMermaidToReactFlow`, `convertToExcalidrawJSON`) because they are:
 *   - deterministic
 *   - offline
 *   - free from LLM rate limits
 *   - idempotent (same Mermaid always yields the same layout)
 *
 * A feature flag (`VITE_DIAGRAM_PIPELINE=canonical|ai`) controls which path
 * is used; the default is `canonical` for new generations.  The AI fallback
 * remains reachable for migration/debugging.
 */

import type { Artifact } from '../../types';
import type { DiagramIR, NodeShape } from '../../lib/diagram';
import { mermaidToIR, mermaidToIRWithDiagnostics } from './mermaidToIR';
import { irToReactFlow, IRToReactFlowResult } from './irToReactFlow';
import { irToExcalidraw, ExcalidrawBundle } from './irToExcalidraw';
import { irToMermaid } from './irToMermaid';
import { extractMermaid } from '../../utils/diagram/extractMermaid';
import { repairDiagramIRSemantics } from '../../lib/semanticRoleResolver';

export type DiagramPipelineMode = 'canonical' | 'ai';

export function getPipelineMode(): DiagramPipelineMode {
    const flag = (import.meta.env.VITE_DIAGRAM_PIPELINE ?? 'canonical').toString().trim().toLowerCase();
    return flag === 'ai' ? 'ai' : 'canonical';
}

/**
 * Optional safety valve:
 * - false (default): avoid dual generation passes (deterministic + AI fallback)
 * - true: allow AI fallback when deterministic parsing yields no usable output
 */
export function isDiagramAIFallbackEnabled(): boolean {
    const flag = (import.meta.env.VITE_DIAGRAM_AI_FALLBACK ?? 'false').toString().trim().toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * Diagram generator strategy:
 *  - `ir-direct`  (default since Phase 2): ask Gemini for canonical
 *                  DiagramIR JSON in one shot (responseSchema-validated).
 *                  Falls back to legacy if the structured call fails.
 *  - `legacy`               : generate Mermaid via Gemini, then parse to IR.
 *                             Kept as an explicit override to roll back if
 *                             the structured call is unavailable in a given
 *                             environment.
 *
 * Wired through `VITE_DIAGRAM_GENERATOR=legacy` so the legacy path can be
 * re-engaged per environment without redeploying. Any other value (including
 * unset) resolves to `ir-direct`.
 */
export type DiagramGeneratorMode = 'legacy' | 'ir-direct';
export function getGeneratorMode(): DiagramGeneratorMode {
    const flag = (import.meta.env.VITE_DIAGRAM_GENERATOR ?? 'ir-direct').toString().trim().toLowerCase();
    return flag === 'legacy' ? 'legacy' : 'ir-direct';
}

export function parseMermaidDeterministic(code: string): DiagramIR {
    return mermaidToIR(code);
}

export function renderIRToReactFlow(ir: DiagramIR): IRToReactFlowResult {
    return irToReactFlow(ir);
}

export function renderIRToExcalidraw(ir: DiagramIR, isDark = false): ExcalidrawBundle {
    return irToExcalidraw(ir, isDark);
}

export function serializeIRToMermaid(ir: DiagramIR): string {
    return irToMermaid(ir);
}

/** Convenience: Mermaid → ReactFlow without any LLM call. */
export function mermaidToReactFlow(code: string): IRToReactFlowResult {
    return renderIRToReactFlow(parseMermaidDeterministic(code));
}

export function mermaidToExcalidraw(code: string, isDark = false): ExcalidrawBundle {
    return renderIRToExcalidraw(parseMermaidDeterministic(code), isDark);
}

export { mermaidToIR, irToReactFlow, irToExcalidraw, irToMermaid };

/**
 * Discriminated result returned by {@link extractIRDiagnostic}. The caller
 * must switch on `status` to render an appropriate UI:
 *  - `ok`            → render the diagram.
 *  - `no-diagram`    → artifact has no diagram-bearing content (clean empty
 *                       state, no error).
 *  - `parse-failed`  → content was present but the extractor or the Mermaid
 *                       parser threw / could not pull a usable code block.
 *  - `empty-ir`      → Mermaid extracted and parsed, but yielded zero nodes
 *                       (typical of `C4Container` without any `Container()`
 *                       calls). Surface a precise message + corrective retry.
 */
export type ExtractIRResult =
    | { status: 'ok'; ir: DiagramIR }
    | { status: 'no-diagram' }
    | {
          status: 'parse-failed';
          reason: 'extract' | 'mermaid-to-ir' | 'json';
          extractReason?: string;
          sample?: string;
          error?: string;
      }
    | { status: 'empty-ir'; sample?: string; mermaidLength?: number; kind?: string };

/**
 * Diagnostic-rich variant of {@link extractIRFromArtifact}. Returns a
 * discriminated union so callers (UI banners, persisted `lastDiagramError`)
 * can show a precise reason instead of collapsing every failure into
 * `null`.
 */
export function extractIRDiagnostic(partial: Pick<Artifact, 'content' | 'representation' | 'type'>): ExtractIRResult {
    const { content, representation, type } = partial;
    if (!content || !content.trim()) return { status: 'no-diagram' };

    let jsonParseError: string | undefined;
    if (type === 'react-flow-graph') {
        try {
            const parsed = JSON.parse(content) as { nodes?: unknown[]; edges?: unknown[] };
            if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
                return { status: 'ok', ir: reactFlowJsonToIR(parsed) };
            }
        } catch (err) {
            jsonParseError = err instanceof Error ? err.message : String(err);
        }
    }

    const extracted = extractMermaid(content, representation);
    if (!extracted.ok) {
        const failure = extracted as { ok: false; reason: string; sample?: string };
        if (type === 'react-flow-graph' && jsonParseError) {
            return { status: 'parse-failed', reason: 'json', error: jsonParseError, sample: failure.sample };
        }
        if (failure.reason === 'no-fence' || failure.reason === 'empty') {
            return { status: 'no-diagram' };
        }
        return { status: 'parse-failed', reason: 'extract', extractReason: failure.reason, sample: failure.sample };
    }

    const success = extracted as { ok: true; code: string };
    try {
        const { ir, diagnostics } = mermaidToIRWithDiagnostics(success.code);
        if (ir.nodes.length > 0) return { status: 'ok', ir };
        return {
            status: 'empty-ir',
            sample: success.code.slice(0, 240),
            mermaidLength: success.code.length,
            kind: diagnostics.kind,
        };
    } catch (err) {
        return {
            status: 'parse-failed',
            reason: 'mermaid-to-ir',
            error: err instanceof Error ? err.message : String(err),
            sample: success.code.slice(0, 240),
        };
    }
}

/**
 * Best-effort extraction of a `DiagramIR` from any diagram-bearing artifact.
 *
 * Supports:
 *  - Raw Mermaid strings (representation === 'diagram' with mermaid content).
 *  - Markdown/hybrid with an embedded ```mermaid fence.
 *  - React-flow JSON (`nodes` / `edges`) for `react-flow-graph` artifacts.
 *
 * Returns `null` when nothing usable is found — callers should not treat this
 * as a hard error; the artifact simply has no persisted IR yet. Use
 * {@link extractIRDiagnostic} when you need a precise failure reason.
 */
export function extractIRFromArtifact(partial: Pick<Artifact, 'content' | 'representation' | 'type'>): DiagramIR | null {
    const result = extractIRDiagnostic(partial);
    return result.status === 'ok' ? result.ir : null;
}

function reactFlowJsonToIR(payload: { nodes?: unknown[]; edges?: unknown[] }): DiagramIR {
    const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const rawEdges = Array.isArray(payload.edges) ? payload.edges : [];

    const optString = (obj: Record<string, unknown>, key: string): string | undefined => {
        const value = obj[key];
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    };
    const optArray = (obj: Record<string, unknown>, key: string): string[] | undefined => {
        const value = obj[key];
        if (!Array.isArray(value)) return undefined;
        const cleaned = value
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
        return cleaned.length > 0 ? cleaned : undefined;
    };

    const nodes = rawNodes
        .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object')
        .map((n, idx) => {
            const data = ((n as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
            const id = String((n as { id?: unknown }).id ?? `node-${idx + 1}`);
            const rawLabel = String(data.label ?? '').trim();
            const rawKind = data.kind;
            const rawType = data.type;
            const rawShape = data.shape;
            // `Component` is the legacy placeholder used when neither `kind`
            // nor `type` was set. Treat it as missing so the semantic
            // resolver can derive a meaningful role from the label / shape
            // instead of inheriting the placeholder verbatim.
            const candidateKind = typeof rawKind === 'string' && rawKind.trim()
                ? rawKind
                : typeof rawType === 'string' && rawType.trim()
                    ? rawType
                    : '';
            const kind = candidateKind && candidateKind.toLowerCase() !== 'component'
                ? candidateKind
                : 'Component';
            const node: DiagramIR['nodes'][number] = {
                id,
                label: rawLabel.length > 0 ? rawLabel : id,
                kind,
            };
            const description = optString(data, 'description');
            if (description) node.description = description;
            const group = optString(data, 'group');
            if (group) node.group = group;
            if (typeof rawShape === 'string') node.shape = rawShape as NodeShape;
            const technology = optString(data, 'technology');
            if (technology) node.technology = technology;
            const semanticRole = data.semanticRole;
            if (typeof semanticRole === 'string') node.semanticRole = semanticRole as DiagramIR['nodes'][number]['semanticRole'];
            const semanticType = data.semanticType;
            if (typeof semanticType === 'string') node.semanticType = semanticType as DiagramIR['nodes'][number]['semanticType'];
            // Phase 2 governance fields. Each is read defensively; we only
            // emit values that the canvas actually carried so legacy JSON
            // continues to parse without spurious metadata.
            const owner = optString(data, 'owner');
            if (owner) node.owner = owner;
            const domain = optString(data, 'domain');
            if (domain) node.domain = domain;
            if (typeof data.dataClassification === 'string') {
                node.dataClassification = data.dataClassification as DiagramIR['nodes'][number]['dataClassification'];
            }
            if (typeof data.securityLevel === 'string') {
                node.securityLevel = data.securityLevel as DiagramIR['nodes'][number]['securityLevel'];
            }
            const compliance = optArray(data, 'compliance');
            if (compliance) node.compliance = compliance;
            if (typeof data.criticality === 'string') {
                node.criticality = data.criticality as DiagramIR['nodes'][number]['criticality'];
            }
            if (typeof data.trust === 'string') {
                node.trust = data.trust as DiagramIR['nodes'][number]['trust'];
            }
            const businessMeaning = optString(data, 'businessMeaning');
            if (businessMeaning) node.businessMeaning = businessMeaning;
            const technicalMeaning = optString(data, 'technicalMeaning');
            if (technicalMeaning) node.technicalMeaning = technicalMeaning;
            return node;
        })
        .filter((n) => n.id);

    const edges = rawEdges
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e, idx) => {
            const data = ((e as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
            const edge: DiagramIR['edges'][number] = {
                id: String((e as { id?: unknown }).id ?? `e${idx + 1}`),
                source: String((e as { source?: unknown }).source ?? ''),
                target: String((e as { target?: unknown }).target ?? ''),
                label: typeof (e as { label?: unknown }).label === 'string'
                    ? String((e as { label?: unknown }).label)
                    : 'Relaciona',
                relation: (data.edgeType as DiagramIR['edges'][number]['relation']) ?? 'default',
            };
            const protocol = optString(data, 'protocol');
            if (protocol) edge.protocol = protocol;
            if (typeof data.direction === 'string') edge.direction = data.direction as DiagramIR['edges'][number]['direction'];
            if (typeof data.criticality === 'string') edge.criticality = data.criticality as DiagramIR['edges'][number]['criticality'];
            if (typeof data.dataSensitivity === 'string') edge.dataSensitivity = data.dataSensitivity as DiagramIR['edges'][number]['dataSensitivity'];
            const retryPolicy = optString(data, 'retryPolicy');
            if (retryPolicy) edge.retryPolicy = retryPolicy;
            if (typeof data.semanticType === 'string') edge.semanticType = data.semanticType as DiagramIR['edges'][number]['semanticType'];
            if (typeof data.animated === 'boolean') edge.animated = data.animated;
            if (typeof data.frequency === 'string') edge.frequency = data.frequency as DiagramIR['edges'][number]['frequency'];
            if (typeof data.synchrony === 'string') edge.synchrony = data.synchrony as DiagramIR['edges'][number]['synchrony'];
            const security = optString(data, 'security');
            if (security) edge.security = security;
            const payload = optString(data, 'payload');
            if (payload) edge.payload = payload;
            if (typeof data.trust === 'string') edge.trust = data.trust as DiagramIR['edges'][number]['trust'];
            const businessMeaning = optString(data, 'businessMeaning');
            if (businessMeaning) edge.businessMeaning = businessMeaning;
            const technicalMeaning = optString(data, 'technicalMeaning');
            if (technicalMeaning) edge.technicalMeaning = technicalMeaning;
            const observability = optString(data, 'observability');
            if (observability) edge.observability = observability;
            const sla = optString(data, 'sla');
            if (sla) edge.sla = sla;
            const errorHandling = optString(data, 'errorHandling');
            if (errorHandling) edge.errorHandling = errorHandling;
            return edge;
        })
        .filter((e) => e.source && e.target);

    // Groups reconstructed from node.group when present.
    const groupMap = new Map<string, string[]>();
    nodes.forEach((n) => {
        if (!n.group) return;
        groupMap.set(n.group, [...(groupMap.get(n.group) ?? []), n.id]);
    });
    const groups = Array.from(groupMap.entries()).map(([label, nodeIds], idx) => ({
        id: `group-${idx + 1}`,
        label,
        nodeIds,
    }));

    const baseIR: DiagramIR = {
        nodes,
        edges,
        groups,
        metadata: { sourceFormat: 'react-flow', generatedAt: new Date().toISOString() },
    };

    // Apply the canonical semantic-role repair before returning so that
    // ReactFlow JSON imported from older artifacts (where every node was
    // tagged `kind: 'Component'`) gets a meaningful role and the correct
    // shape for actors, databases, queues, gateways, etc.
    const { ir } = repairDiagramIRSemantics(baseIR, { diagramKind: 'react-flow', fromReactFlowJson: true });
    return ir;
}

export { resolveRenderableDiagram } from './resolveRenderableDiagram';

/**
 * Diagram quality — the ten-dimension score, the lints and the preflight report.
 *
 * `diagramQualityService` sat at the root of `services/` and six UI files
 * imported it directly, past `services/quality/diagramQualityBridge.ts` which
 * exists to mediate it. It depends on ten modules in this directory and on
 * nothing else, so this is where it belongs; `services/quality` keeps the
 * bridge, which is that context's *view* of a diagram's quality rather than a
 * second copy of it.
 */
export {
  analyzeDiagramQuality,
  buildDiagramPreflightReport,
  mergeIRMetadata,
  toDiagramIR,
} from './quality/diagramQualityService';
export type { DiagramPreflightReport, DiagramQualityReport } from './quality/diagramQualityService';

/**
 * Deterministic signal extraction over a project's artifacts.
 *
 * Public because the deterministic fallbacks in `services/artifacts` build a
 * skeleton out of these signals when generation fails; they used to reach the
 * file directly from inside the AI engine.
 */
export {
  extractDiagramSignals,
  renderDiagramSignals,
  type ExtractedDiagramContext,
} from './diagramSignalExtractor';

/**
 * The story a diagram tells, in the order it should be read.
 *
 * Public because three sides need it and none of them is this module: the
 * quality engine scores whether a diagram has a story at all, the canvas walks
 * its steps in presentation mode, and the accessible summary reads it out to
 * whoever cannot see the highlight.
 */
export {
  buildStoryPlan,
  resolvePrimaryPathFocus,
  resolveStoryFocus,
  MAX_STORY_HOTSPOTS,
  MAX_STORY_STEPS,
} from './storyPlanner';

/**
 * Changing a diagram without regenerating it.
 *
 * Public because the change can come from three places — the canvas, an AI
 * proposal the user previews, and a deterministic suggestion action — and all
 * three must go through the same validation. A second applier is a second set
 * of invariants, and only one of them would be the one the lint rules check.
 */
export { applySemanticPatch, describeSemanticPatch } from './semanticPatchEngine';
