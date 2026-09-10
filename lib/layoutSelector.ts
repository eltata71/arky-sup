/**
 * Layout selector — picks the right layout algorithm for a given diagram
 * shape and artifact type.
 *
 * The selector is heuristic-based and conservative:
 *   - Sequence/state diagrams stay on dagre (the canonical pipeline already
 *     ships excellent results).
 *   - C4 Context with a clear "central system" surrounded by people/external
 *     systems → ELK radial.
 *   - ERD / domain models → ELK force (organic, no spurious hierarchy).
 *   - Microservice meshes (≥ 12 nodes, several services) → ELK mrtree.
 *   - Anything else → ELK layered when ELK is available, dagre as fallback.
 *
 * The selector returns *intent*: a tuple of `(backend, algorithm, options)`
 * that the rendering pipeline maps to the matching engine.  Callers are
 * expected to invoke `layoutIR()` (dagre) or `layoutIRWithELK()` (ELK)
 * accordingly.
 */

import type { ArtifactType } from '../types';
import type { DiagramIR } from './diagram';
import { detectSemanticRole } from './diagramTokens';
import type { LayoutDirection } from './layoutEngine';
import type { ElkAlgorithm } from './elkLayoutEngine';
import { resolveSemanticLayoutPolicy } from './semanticLayoutPolicy';

export type LayoutBackend = 'dagre' | 'elk';
export type LayoutDensity = 'compact' | 'normal' | 'spacious';

export interface LayoutPlan {
    backend: LayoutBackend;
    /** Only used when backend === 'elk'. */
    algorithm: ElkAlgorithm;
    direction: LayoutDirection;
    /** Whether ELK should route edges orthogonally. */
    orthogonal: boolean;
    /**
     * Density preset applied to the layout (spacing multiplier).
     * `compact` = 0.85, `normal` = 1, `spacious` = 1.25.
     * Persisted on `metadata.layoutPlan` and honoured by both the dagre
     * and ELK engines via `densityScale`.
     */
    density: LayoutDensity;
    /** Human-readable rationale, surfaced in dev logs and the toolbar tooltip. */
    rationale: string;
    /**
     * Gap 3: true when the plan was forced by a deterministic suggestion
     * action (set-layout-direction / set-layout-density / apply-elk-layout).
     * The selector treats this as a sticky preference so subsequent ELK
     * passes don't silently revert the user's choice.
     */
    userOverride?: boolean;
}

/** Scaling factor used by the layout engines (1.0 = canonical spacing). */
export const DENSITY_SCALE: Record<LayoutDensity, number> = {
    compact: 0.85,
    normal: 1,
    spacious: 1.25,
};

export interface LayoutSelectionInput {
    ir: DiagramIR;
    artifactType?: ArtifactType;
}

const ROOT_LIKE_THRESHOLD = 4; // peripheral nodes around a single hub

/**
 * Returns true when the IR has a clear "hub" topology: one node with many
 * incident edges and the rest of the graph orbiting around it.
 */
function hasRadialTopology(ir: DiagramIR): boolean {
    if (ir.nodes.length < 5 || ir.nodes.length > 14) return false;
    const incident = new Map<string, number>();
    for (const edge of ir.edges) {
        incident.set(edge.source, (incident.get(edge.source) ?? 0) + 1);
        incident.set(edge.target, (incident.get(edge.target) ?? 0) + 1);
    }
    let maxDegree = 0;
    for (const value of incident.values()) {
        if (value > maxDegree) maxDegree = value;
    }
    const others = ir.nodes.length - 1;
    return maxDegree >= others - 1 && others >= ROOT_LIKE_THRESHOLD;
}

/**
 * Returns true when the IR looks like a service mesh / microservice graph:
 * many service-kind nodes, gateway-style entry points and a moderate amount
 * of edges per node.
 */
function looksLikeServiceMesh(ir: DiagramIR): boolean {
    if (ir.nodes.length < 12) return false;
    const services = ir.nodes.filter((n) => detectSemanticRole(n.label, n.kind) === 'service');
    return services.length / ir.nodes.length >= 0.4;
}

/**
 * Returns true when the diagram is dense (≥ 1.7 edges per node on average) —
 * typical of ERDs, event storms and other organic graphs that benefit from a
 * force-directed layout.
 */
function isDenseGraph(ir: DiagramIR): boolean {
    if (ir.nodes.length === 0) return false;
    return ir.edges.length / ir.nodes.length >= 1.7;
}

/**
 * Apply the persisted user override (set by deterministic suggestion
 * actions) on top of a computed plan. Returns the plan unchanged when
 * there is no override or the persisted plan is missing the
 * `userOverride` marker. Pure / synchronous.
 */
function applyUserOverride(plan: LayoutPlan, ir: DiagramIR): LayoutPlan {
    const persisted = ir.metadata?.layoutPlan;
    if (!persisted?.userOverride) return plan;
    const direction = persisted.direction === 'TB' || persisted.direction === 'LR' ? persisted.direction : plan.direction;
    const density = persisted.density === 'compact' || persisted.density === 'normal' || persisted.density === 'spacious'
        ? persisted.density
        : plan.density;
    if (direction === plan.direction && density === plan.density) return { ...plan, userOverride: true };
    return {
        ...plan,
        direction,
        density,
        userOverride: true,
        rationale: `${plan.rationale} (override del usuario: dirección ${direction}, densidad ${density}).`,
    };
}

export function selectLayoutPlan(input: LayoutSelectionInput): LayoutPlan {
    return applyUserOverride(selectLayoutPlanRaw(input), input.ir);
}

function selectLayoutPlanRaw(input: LayoutSelectionInput): LayoutPlan {
    const { ir, artifactType } = input;
    const { policy, warnings } = resolveSemanticLayoutPolicy(ir);

    // Sequence and state diagrams stick with the dagre canonical pipeline —
    // their renderers expect the existing waypoint conventions.
    if (artifactType === 'mermaid-sequence' || artifactType === 'mermaid-state' || artifactType === 'mermaid-gantt') {
        return {
            backend: 'dagre',
            algorithm: 'layered',
            direction: 'LR',
            orthogonal: false,
            density: 'normal',
            rationale: 'Diagramas secuenciales/estado conservan dagre por compatibilidad con waypoints.',
        };
    }

    // Semantic policy is the primary source for diagram-type layout intent.
    if (policy.diagramType !== 'generic') {
        const extraWarnings = warnings.length > 0 ? ` Advertencias: ${warnings.join(' ')}` : '';
        if (policy.diagramType === 'c4-context' && hasRadialTopology(ir)) {
            return {
                backend: 'elk',
                algorithm: 'radial',
                direction: 'LR',
                orthogonal: false,
                density: 'spacious',
                rationale: `C4 Context con sistema central → ELK radial (sistema en el centro, actores orbitando).${extraWarnings}`,
            };
        }
        return {
            backend: policy.backend,
            algorithm: policy.algorithm,
            direction: policy.direction,
            orthogonal: policy.orthogonal,
            density: policy.density,
            rationale: `${policy.rationale}${extraWarnings}`,
        };
    }

    // C4 Context with hub topology ⇒ radial layout for instant impact.
    if (artifactType === 'mermaid-c4-context' && hasRadialTopology(ir)) {
        return {
            backend: 'elk',
            algorithm: 'radial',
            direction: 'LR',
            orthogonal: false,
            density: 'spacious',
            rationale: 'Contexto C4 con sistema central → ELK radial (sistema en el centro, actores orbitando).',
        };
    }

    // ERD / domain models → force layout to avoid spurious hierarchies.
    if (
        artifactType === 'mermaid-erd' ||
        artifactType === 'sdd-domain-model' ||
        artifactType === 'sdd-event-storming'
    ) {
        return {
            backend: 'elk',
            algorithm: 'force',
            direction: 'LR',
            orthogonal: false,
            density: 'normal',
            rationale: 'ERD/Domain Model → ELK force (relaciones n-aria sin jerarquía implícita).',
        };
    }

    // Service meshes → mrtree (clean trees with shallow depth).
    if (looksLikeServiceMesh(ir)) {
        return {
            backend: 'elk',
            algorithm: 'mrtree',
            direction: 'LR',
            orthogonal: true,
            density: 'compact',
            rationale: 'Mesh de microservicios → ELK mrtree (árbol balanceado, pocos cruces, densidad compact).',
        };
    }

    // Dense organic graphs → stress majorization keeps clusters readable.
    if (isDenseGraph(ir) && ir.nodes.length <= 40) {
        return {
            backend: 'elk',
            algorithm: 'stress',
            direction: 'LR',
            orthogonal: false,
            density: 'normal',
            rationale: 'Grafo denso (≥1.7 aristas/nodo) → ELK stress (clusters legibles).',
        };
    }

    // Default: ELK layered (modern hierarchical, fewer crossings than dagre).
    return {
        backend: 'elk',
        algorithm: 'layered',
        direction: ir.nodes.length >= 10 ? 'TB' : 'LR',
        orthogonal: true,
        density: ir.nodes.length > 18 ? 'compact' : 'normal',
        rationale: 'Default: ELK layered con ruteo ortogonal (mejora cruces vs. dagre).',
    };
}

/**
 * Tiny synchronous selector that returns the dagre fallback when ELK is not
 * available (e.g. tests that don't load WASM).  Used by callers that need a
 * blocking decision before resolving the async ELK backend.
 *
 * Important: the dagre fallback must preserve the `userOverride` marker
 * from the original plan so a user-applied density / direction (via the
 * Visual Quality Gate's auto-actions) survives even when ELK fails and
 * the renderer falls back to dagre. Without this the override was
 * silently dropped on the synchronous re-resolve.
 */
export function selectFallbackPlan(input: LayoutSelectionInput): LayoutPlan {
    const plan = selectLayoutPlan(input);
    if (plan.backend === 'elk') {
        return {
            backend: 'dagre',
            algorithm: 'layered',
            direction: plan.direction,
            orthogonal: false,
            density: plan.density,
            rationale: `${plan.rationale} (fallback dagre)`,
            userOverride: plan.userOverride,
        };
    }
    return plan;
}
