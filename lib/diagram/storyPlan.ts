/**
 * StoryPlan — what a diagram argues, in the order it should be read.
 *
 * The IR has always been able to carry a narrative (`DiagramNarrative`, with
 * its `scenes` and its `callouts`), and the canvas has always been able to
 * accept one (`ReactFlowCanvasProps.presentation.scenes`). Neither was ever
 * produced or read: story mode rebuilt its own sequence out of BFS levels and
 * threw the authored one away, and `DiagramCallout` — with its `targetId` and
 * its `severity` — was a declaration nothing implemented. So the product's
 * storytelling existed as types and as motion, and the motion replayed an
 * order nobody had chosen. That is the same defect the coordination panel
 * exists to avoid: an animation that shows a plausible sequence instead of the
 * real one misleads exactly when something matters.
 *
 * This is the contract that closes it. It lives in `lib` because three layers
 * need it — the planner that builds it, the quality engine that scores it and
 * the canvas that walks it — and a declaration with no behaviour belongs in a
 * leaf. Nothing here imports anything, for the same reason `DiagramIRTypes`
 * imports nothing.
 *
 * The one rule the shape itself enforces: **`source` is not decoration.** A
 * plan derived from topology and a plan the architect wrote are different
 * claims about the same diagram, and a reader who cannot tell them apart
 * cannot judge either. Everything a derivation cannot honestly know —
 * `primaryMessage`, `conclusion` — is `null` rather than composed, because a
 * sentence invented about what an architecture *means* is worse than a missing
 * one: it reads as the architect's own.
 */

import type { DiagramNarrative } from './DiagramIRTypes';

/**
 * Does this narrative actually say anything?
 *
 * One definition, because two of them disagreed: the repair pass treated an
 * empty `{ scenes: [], callouts: [] }` as a story and left it alone, while the
 * planner treated it as nothing and derived one. Whichever answer is right,
 * two files answering it differently means a diagram whose walk depends on
 * which one ran last.
 *
 * This one only asks whether the field is populated — `narrativeIsAuthored`
 * below is the one that also asks who populated it.
 */
export const narrativeHasText = (narrative: string | DiagramNarrative | undefined): boolean => {
    if (!narrative) return false;
    if (typeof narrative === 'string') return narrative.trim().length > 0;
    return (narrative.summary ?? '').trim().length > 0
        || (narrative.scenes ?? []).length > 0
        || (narrative.callouts ?? []).length > 0;
};

/**
 * Did somebody write it? Same question minus the repair pass's own synthesis,
 * which is a description of a topology and never stands in for a story.
 */
export const narrativeIsAuthored = (narrative: string | DiagramNarrative | undefined): boolean =>
    narrativeHasText(narrative) && (typeof narrative === 'string' || narrative?.source !== 'derived');

/** Whether the plan was written by a person or computed from the graph. */
export type StoryPlanSource = 'authored' | 'derived';

/** Why an element deserves the reader's attention before the others. */
export type StoryHotspotKind =
    | 'risk'
    | 'decision'
    | 'security'
    | 'failure'
    | 'sensitive-data';

/** One step of the guided reading, in ids the renderer can focus. */
export interface StoryStep {
    id: string;
    /** 1-based position in the reading order. */
    index: number;
    title: string;
    nodeIds: string[];
    edgeIds: string[];
    /** What this step tells the reader. Absent when nobody wrote one. */
    insight?: string;
}

/** A point the reader should not miss, bound to the element it is about. */
export interface StoryHotspot {
    id: string;
    targetId: string;
    targetKind: 'node' | 'edge';
    kind: StoryHotspotKind;
    severity: 'info' | 'warning' | 'critical';
    text: string;
}

/** The end-to-end route the diagram is mainly about. */
export interface StoryPath {
    nodeIds: string[];
    edgeIds: string[];
    /** Why this route and not another — shown next to the highlight. */
    rationale: string;
}

export interface StoryPlan {
    source: StoryPlanSource;
    /**
     * The one sentence the diagram argues. `null` when the architect has not
     * written one — a derivation can describe a topology and cannot know a
     * message, and presenting a description as a message is the failure this
     * field is shaped to prevent.
     */
    primaryMessage: string | null;
    /** Where the eye should land first. */
    entryPointIds: string[];
    readingDirection: 'TB' | 'LR' | 'BT' | 'RL';
    steps: StoryStep[];
    /** `null` when the graph has no route worth calling primary. */
    primaryPath: StoryPath | null;
    /** Everything that is context rather than argument. */
    secondaryContextIds: string[];
    hotspots: StoryHotspot[];
    /** `null` unless authored, for the same reason as `primaryMessage`. */
    conclusion: string | null;
    /**
     * Ids an authored narrative pointed at that the IR no longer contains.
     * Reported, never dropped: a scene that silently loses half its nodes
     * still plays, and plays a different story from the one that was written.
     */
    unresolvedReferences: string[];
}

/** The ids a single step brings into focus. */
export interface StoryFocus {
    nodeIds: ReadonlySet<string>;
    edgeIds: ReadonlySet<string>;
}
