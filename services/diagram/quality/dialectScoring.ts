/**
 * The rubric reads each dialect in its own terms (plan de diagramas, 8.4b).
 *
 * The ten dimensions were written for boxes and arrows. *Jerarquía visual*
 * was a function of how many groups a diagram had, *atractivo visual* paid
 * ten points for having any, and *preparación técnica* counted protocols on
 * edges. A sequence diagram has lifelines, not groups; an ERD has attributes
 * and cardinalities, not protocols; a state diagram nests states instead of
 * drawing boundaries. Judged as graphs, a correct ERD lost points for not
 * being an integration diagram, and adding a meaningless group to a sequence
 * raised its score.
 *
 * Here the three dimensions that measured graph structure measure the
 * dialect's own structure instead, read from `DiagramIR.notation` (8.3b).
 * The rest of the rubric is shared: a label is a label in every dialect.
 */
import type { DiagramIR } from '../../../lib/diagram';
import type { LayoutQualityMetrics } from '../layoutQualityService';
import { clamp, hasText } from './diagramQualityTypes';
import { isActionableEdgeLabel } from './diagramLintRules';

export type ScoringDialect = 'graph' | 'sequence' | 'erd' | 'state';

/** The dialect a diagram is scored as: its notation first, its declared type next. */
export function scoringDialectOf(ir: DiagramIR): ScoringDialect {
    if (ir.notation) return ir.notation.dialect;
    if (ir.metadata?.diagramType === 'sequence') return 'sequence';
    if (ir.metadata?.diagramType === 'erd') return 'erd';
    return 'graph';
}

/**
 * The archetype a notation declares (8.4b). Guessing from a title or a node
 * mix judged sequences, ERDs and state diagrams as processes, integrations or
 * data lineage, and asked for lanes, layers and transformations their
 * notation does not have. ERD and state diagrams take the general rules plus
 * their own rubric here; `null` leaves the heuristics to decide.
 */
export function notationArchetype(ir: DiagramIR): 'sequence' | 'generic' | null {
    const dialect = ir.notation?.dialect;
    if (dialect === 'sequence') return 'sequence';
    return dialect === 'erd' || dialect === 'state' ? 'generic' : null;
}

const ratio = (hits: number, total: number): number => (total === 0 ? 0 : hits / total);

type SequenceSteps = Extract<NonNullable<DiagramIR['notation']>, { dialect: 'sequence' }>['steps'];

const sequenceCounts = (steps: SequenceSteps): { messages: number; fragments: number; notes: number } => {
    let messages = 0;
    let fragments = 0;
    let notes = 0;
    const walk = (list: SequenceSteps) => {
        for (const step of list) {
            if (step.kind === 'message') messages += 1;
            else if (step.kind === 'note') notes += 1;
            else if (step.kind === 'fragment') {
                fragments += 1;
                for (const branch of step.branches) walk(branch.steps);
            }
        }
    };
    walk(steps);
    return { messages, fragments, notes };
};

/**
 * *Jerarquía visual* for a dialect that has no groups: how many lifelines,
 * entities or states one view can carry before it stops reading, and — for a
 * large state diagram — whether it nests.
 */
export function scoreDialectHierarchy(ir: DiagramIR, dialect: Exclude<ScoringDialect, 'graph'>): number {
    const n = ir.nodes.length;
    if (n === 0) return 0;
    if (dialect === 'sequence') {
        const lifelines = n <= 6 ? 100 : n <= 9 ? 85 : n <= 12 ? 65 : 45;
        const notation = ir.notation?.dialect === 'sequence' ? ir.notation : null;
        const messages = notation ? sequenceCounts(notation.steps).messages : ir.edges.length;
        return clamp(lifelines - (messages > 40 ? 15 : 0));
    }
    if (dialect === 'erd') return n <= 12 ? 100 : n <= 18 ? 80 : n <= 25 ? 60 : 40;
    const composites = ir.notation?.dialect === 'state' ? ir.notation.composites.length : 0;
    if (n <= 10) return 100;
    return composites > 0 ? 90 : 60;
}

/** How much of its own notation the diagram uses, 0–1 — what *atractivo visual* rewards instead of groups. */
export function dialectRichness(ir: DiagramIR, dialect: Exclude<ScoringDialect, 'graph'>): number {
    const notation = ir.notation;
    if (dialect === 'sequence' && notation?.dialect === 'sequence') {
        const { fragments, notes } = sequenceCounts(notation.steps);
        return Math.min(1, (fragments > 0 ? 0.6 : 0) + (notes > 0 ? 0.2 : 0) + (notation.autonumber ? 0.2 : 0));
    }
    if (dialect === 'erd' && notation?.dialect === 'erd') {
        return ratio(ir.nodes.filter((n) => (notation.attributes[n.id] ?? []).length > 0).length, ir.nodes.length);
    }
    if (dialect === 'state' && notation?.dialect === 'state') {
        return Math.min(1, (notation.composites.length > 0 ? 0.5 : 0) + (notation.notes.length > 0 ? 0.25 : 0)
            + (Object.keys(notation.pseudostates).length > 0 ? 0.25 : 0));
    }
    return 0;
}

/**
 * *Preparación técnica* in the dialect's terms: labelled messages and the
 * fragments that carry the alternatives, for a sequence; typed attributes, a
 * primary key and a written cardinality per relation, for an ERD; labelled
 * transitions and an initial and final state, for a state diagram.
 */
export function scoreDialectTechnical(ir: DiagramIR, dialect: Exclude<ScoringDialect, 'graph'>): number {
    if (ir.nodes.length === 0) return 0;
    const notation = ir.notation;
    if (dialect === 'sequence') {
        const labelled = ratio(ir.edges.filter((e) => isActionableEdgeLabel(e.label)).length, ir.edges.length);
        const structured = notation?.dialect === 'sequence' && sequenceCounts(notation.steps).fragments + sequenceCounts(notation.steps).notes > 0;
        return clamp(Math.round(35 + labelled * 45 + (structured ? 20 : 0)));
    }
    if (dialect === 'erd') {
        const attributes = notation?.dialect === 'erd' ? notation.attributes : {};
        const withAttributes = ratio(ir.nodes.filter((n) => (attributes[n.id] ?? []).length > 0).length, ir.nodes.length);
        const withKey = ratio(ir.nodes.filter((n) => (attributes[n.id] ?? []).some((a) => a.keys?.includes('PK'))).length, ir.nodes.length);
        const cardinality = notation?.dialect === 'erd'
            ? ratio(ir.edges.filter((e) => notation.relations[e.id]).length, ir.edges.length)
            : 0;
        return clamp(Math.round(30 + withAttributes * 30 + withKey * 25 + cardinality * 15));
    }
    // Entering or leaving through `[*]` carries no event in any state
    // notation; only the transitions between real states are asked for one.
    const isEnd = (id: string) => id === '[*]' || id.endsWith('::[*]');
    const unlabeled = new Set(notation?.dialect === 'state' ? notation.unlabeledEdges : []);
    const transitions = ir.edges.filter((e) => !isEnd(e.source) && !isEnd(e.target));
    const labelled = transitions.length === 0
        ? 1
        : ratio(transitions.filter((e) => !unlabeled.has(e.id) && hasText(e.label)).length, transitions.length);
    const hasEnds = ir.nodes.some((n) => isEnd(n.id));
    return clamp(Math.round(30 + labelled * 50 + (hasEnds ? 20 : 0)));
}

/**
 * The eleventh dimension, *geometría* (8.4b): what the canvas measured when
 * it drew the diagram. Only scored when the caller supplied the real
 * positions — a rubric that guessed geometry from the IR would be scoring a
 * layout nobody sees.
 */
export function scoreGeometria(metrics: LayoutQualityMetrics): number {
    const breaches = metrics.boundaryContainmentBreaches.reduce((acc, b) => acc + b.nodeIds.length, 0);
    return clamp(Math.round(100
        - metrics.overlappingNodePairs.length * 20
        - metrics.overlappingGroupPairs.length * 15
        - metrics.edgesCrossingNodes.length * 6
        - Math.min(10, metrics.edgeCrossings) * 2
        - breaches * 5));
}
