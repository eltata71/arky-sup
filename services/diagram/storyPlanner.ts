/**
 * The story planner — authored first, derived second, and always marked.
 *
 * `buildStoryPlan` answers one question about a diagram: in what order should
 * this be read, and what must not be missed. It answers it from the IR's own
 * narrative when the architect (or the model) wrote one, and from the graph
 * when nobody did — and the two answers are never dressed the same, because
 * `StoryPlan.source` says which one you are holding.
 *
 * Four rules, and they are the ones the rest of the portfolio already lives by:
 *
 *  - **Authored wins.** A written scene is the story; a BFS level is a guess
 *    about it. The derivation runs only when there is nothing to honour.
 *  - **Derived is distinguishable from declared.** `source: 'derived'` travels
 *    with the plan, and the two fields a derivation cannot honestly fill —
 *    the primary message and the conclusion — stay `null` instead of being
 *    composed. A described topology presented as an argument is a sentence the
 *    architect never wrote appearing over their signature.
 *  - **Broken references are reported, never dropped.** An authored scene that
 *    points at a node the IR no longer has still plays, and plays a different
 *    story. `unresolvedReferences` is how the quality engine gets to say so.
 *  - **Nothing to tell returns `null`.** An empty diagram gets no plan, not an
 *    empty one — the same reason `attentionProgress` returns `null` rather
 *    than 0 %.
 *
 * Pure and synchronous. No model call: an order of reading is derivable from
 * the graph, and spending a call on something an algorithm decides reliably is
 * the trade this repository already refuses everywhere else. The derivation
 * itself lives in `storyDerivation` — this module's job is deciding which of
 * the two answers the caller is getting, and saying which one it was.
 */

import type { DiagramIR, DiagramNarrative } from '../../lib/diagram';
import { narrativeIsAuthored } from '../../lib/diagram';
import type {
    StoryFocus,
    StoryHotspot,
    StoryPlan,
    StoryStep,
} from '../../lib/diagram/storyPlan';
import {
    buildTopology,
    collectHotspots,
    deriveEntryPoints,
    deriveLevels,
    derivePrimaryPath,
    stepsFromLevels,
    MAX_STORY_HOTSPOTS,
    MAX_STORY_STEPS,
} from './storyDerivation';

export { MAX_STORY_HOTSPOTS, MAX_STORY_STEPS };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asNarrativeObject = (narrative: string | DiagramNarrative | undefined): DiagramNarrative | null =>
    !narrative || typeof narrative === 'string' ? null : narrative;

/* ------------------------------------------------------------------ *
 * Authored.
 * ------------------------------------------------------------------ */

const stepsFromScenes = (
    narrative: DiagramNarrative,
    knownNodes: Set<string>,
    knownEdges: Set<string>,
    unresolved: string[],
): StoryStep[] => {
    const scenes = narrative.scenes ?? [];
    return scenes.slice(0, MAX_STORY_STEPS).map((scene, position) => {
        const nodeIds = (scene.focusNodeIds ?? []).filter(id => {
            if (knownNodes.has(id)) return true;
            unresolved.push(id);
            return false;
        });
        const edgeIds = (scene.focusEdgeIds ?? []).filter(id => {
            if (knownEdges.has(id)) return true;
            unresolved.push(id);
            return false;
        });
        return {
            id: scene.id || `story-step-${position + 1}`,
            index: position + 1,
            title: text(scene.title) || `Paso ${position + 1}`,
            nodeIds,
            edgeIds,
            ...(text(scene.insight) ? { insight: text(scene.insight) } : {}),
        };
    });
};

const hotspotsFromCallouts = (
    narrative: DiagramNarrative,
    knownNodes: Set<string>,
    knownEdges: Set<string>,
    unresolved: string[],
): StoryHotspot[] => {
    const callouts = narrative.callouts ?? [];
    const resolved: StoryHotspot[] = [];
    for (const callout of callouts) {
        const targetKind: 'node' | 'edge' = callout.targetKind
            ?? (knownEdges.has(callout.targetId) && !knownNodes.has(callout.targetId) ? 'edge' : 'node');
        const known = targetKind === 'edge' ? knownEdges : knownNodes;
        if (!known.has(callout.targetId)) {
            unresolved.push(callout.targetId);
            continue;
        }
        const severity = callout.severity === 'critical' ? 'critical' : callout.severity === 'warning' ? 'warning' : 'info';
        resolved.push({
            id: callout.id || `hotspot-${targetKind}-${callout.targetId}`,
            targetId: callout.targetId,
            targetKind,
            kind: severity === 'critical' ? 'risk' : 'decision',
            severity,
            text: text(callout.text),
        });
    }
    return resolved.slice(0, MAX_STORY_HOTSPOTS);
};

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

/**
 * Build the reading plan for a diagram, or `null` when there is nothing to
 * read. Never throws: a malformed narrative degrades to the derivation rather
 * than taking the canvas down with it.
 */
export function buildStoryPlan(ir: DiagramIR): StoryPlan | null {
    if (!ir || ir.nodes.length === 0) return null;

    const topology = buildTopology(ir);
    const entryPointIds = deriveEntryPoints(ir, topology);
    const readingDirection = ir.metadata?.layoutPlan?.direction ?? 'TB';
    const primaryPath = derivePrimaryPath(ir, topology, entryPointIds);
    const onPrimaryPath = new Set(primaryPath?.nodeIds ?? []);
    const secondaryContextIds = ir.nodes
        .filter(node => !onPrimaryPath.has(node.id))
        .map(node => node.id);

    const narrative = asNarrativeObject(ir.metadata?.narrative);
    const knownNodes = new Set(ir.nodes.map(node => node.id));
    const knownEdges = new Set(topology.validEdges.map(edge => edge.id));
    const unresolvedReferences: string[] = [];

    const authoredSteps = narrative ? stepsFromScenes(narrative, knownNodes, knownEdges, unresolvedReferences) : [];
    const authoredHotspots = narrative ? hotspotsFromCallouts(narrative, knownNodes, knownEdges, unresolvedReferences) : [];
    // `narrativeIsAuthored` is the single definition of "somebody wrote this":
    // an empty object left behind by a repair is not a story, and neither is
    // the topology description the repair composes — treating either as one
    // would suppress the derivation that is honest about being one.
    const isAuthored = narrativeIsAuthored(ir.metadata?.narrative)
        && (authoredSteps.length > 0 || authoredHotspots.length > 0 || text(narrative?.summary).length > 0);
    const authoredSummary = isAuthored ? text(narrative?.summary) : '';

    if (isAuthored) {
        return {
            source: 'authored',
            primaryMessage: authoredSummary || null,
            entryPointIds: authoredSteps[0]?.nodeIds.length ? authoredSteps[0].nodeIds : entryPointIds,
            readingDirection,
            steps: authoredSteps.length > 0 ? authoredSteps : stepsFromLevels(ir, topology, deriveLevels(ir, topology, entryPointIds)),
            primaryPath,
            secondaryContextIds,
            hotspots: authoredHotspots.length > 0 ? authoredHotspots : collectHotspots(ir),
            // `DiagramNarrative` has no conclusion field yet, and inventing
            // one from the summary would put words in the architect's mouth.
            conclusion: null,
            unresolvedReferences: Array.from(new Set(unresolvedReferences)),
        };
    }

    return {
        source: 'derived',
        // A derivation can describe a topology; it cannot know an argument.
        primaryMessage: null,
        entryPointIds,
        readingDirection,
        steps: stepsFromLevels(ir, topology, deriveLevels(ir, topology, entryPointIds)),
        primaryPath,
        secondaryContextIds,
        hotspots: collectHotspots(ir),
        conclusion: null,
        // A derived plan normally has none. It reports any it did find rather
        // than an empty list: a narrative marked `derived` that still carries
        // stale scenes is a real state, and hiding it here would make the lint
        // rule the only thing that knows.
        unresolvedReferences: Array.from(new Set(unresolvedReferences)),
    };
}

/**
 * The ids one step brings into focus. The step already carries the edges that
 * belong to it — resolved against the IR when the story was authored, derived
 * with the level when it was not — so this is a lookup, not a second decision
 * about what a step contains.
 */
export function resolveStoryFocus(plan: StoryPlan, stepId: string): StoryFocus | null {
    const step = plan.steps.find(candidate => candidate.id === stepId);
    if (!step) return null;
    return { nodeIds: new Set(step.nodeIds), edgeIds: new Set(step.edgeIds) };
}

/**
 * The primary path as a focus, for "resalta únicamente el flujo principal".
 * `null` when the graph has no route worth calling primary — a highlight of
 * everything highlights nothing.
 */
export function resolvePrimaryPathFocus(plan: StoryPlan): StoryFocus | null {
    if (!plan.primaryPath) return null;
    return {
        nodeIds: new Set(plan.primaryPath.nodeIds),
        edgeIds: new Set(plan.primaryPath.edgeIds),
    };
}
