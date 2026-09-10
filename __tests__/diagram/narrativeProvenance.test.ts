/**
 * Provenance of the story, and what the rubric pays for.
 *
 * Two defects these specs exist to keep closed. The repair pass fills
 * `metadata.narrative` on every diagram it touches, and the *narrativa*
 * dimension used to award a flat ten points for that field being non-empty —
 * so the rubric paid for its own repair, and every repaired diagram looked
 * like it had a story. And a synthesised topology description was written into
 * the same shape as an authored one, so nothing downstream could tell them
 * apart: not the score, not the presentation walk, not the reader.
 */

import { describe, expect, it } from 'vitest';

import type { DiagramIR, DiagramNarrative } from '../../lib/diagram';
import { autoRepairDiagramIR } from '../../services/diagram/qualityRepair';
import { collectIssues } from '../../services/diagram/quality/diagramLintRules';
import { scoreNarrativa } from '../../services/diagram/quality/diagramScoring';
import { buildStoryPlan } from '../../services/diagram/storyPlanner';

const base = (narrative?: DiagramNarrative | string): DiagramIR => ({
    nodes: [
        { id: 'a', label: 'Portal', kind: 'service', description: 'Entrada.' },
        { id: 'b', label: 'Núcleo', kind: 'service', description: 'Proceso.' },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', label: 'envía la solicitud' }],
    groups: [],
    metadata: narrative === undefined ? {} : { narrative },
});

describe('the repair marks what it composed', () => {
    it('writes a structured narrative flagged as derived', () => {
        const repaired = autoRepairDiagramIR(base(), {}).ir;
        expect(repaired.metadata?.narrative).toMatchObject({ source: 'derived' });
    });

    it('does not overwrite a story somebody wrote', () => {
        const authored: DiagramNarrative = { summary: 'La mía.', scenes: [] };
        const repaired = autoRepairDiagramIR(base(authored), {}).ir;
        expect(repaired.metadata?.narrative).toMatchObject({ summary: 'La mía.' });
        expect((repaired.metadata?.narrative as DiagramNarrative).source).toBeUndefined();
    });

    it('replaces an empty narrative object rather than counting it as a story', () => {
        const repaired = autoRepairDiagramIR(base({ scenes: [], callouts: [] }), {}).ir;
        expect(repaired.metadata?.narrative).toMatchObject({ source: 'derived' });
    });
});

describe('the planner refuses to present a synthesis as an authored story', () => {
    it('reads a repaired diagram as derived', () => {
        const repaired = autoRepairDiagramIR(base(), {}).ir;
        const plan = buildStoryPlan(repaired);
        expect(plan?.source).toBe('derived');
        expect(plan?.primaryMessage).toBeNull();
    });

    it('reads an authored one as authored', () => {
        const plan = buildStoryPlan(base({ summary: 'El cobro es el cuello de botella.' }));
        expect(plan?.source).toBe('authored');
        expect(plan?.primaryMessage).toBe('El cobro es el cuello de botella.');
    });
});

describe('the rubric grades the story, not the presence of the field', () => {
    it('pays a written walk more than a written summary, and both more than a synthesis', () => {
        const walk = scoreNarrativa(base({
            summary: 'Resumen.',
            scenes: [{ id: 's1', title: 'Paso', focusNodeIds: ['a'], focusEdgeIds: [] }],
        }));
        const summary = scoreNarrativa(base({ summary: 'Resumen.' }));
        const synthesised = scoreNarrativa(base({ summary: 'Resumen.', source: 'derived' }));
        const nothing = scoreNarrativa(base());
        expect(walk).toBeGreaterThan(summary);
        expect(summary).toBeGreaterThan(synthesised);
        expect(synthesised).toBeGreaterThan(nothing);
    });

    it('no longer awards a repaired diagram the same credit as an authored one', () => {
        const repaired = autoRepairDiagramIR(base(), {}).ir;
        const authored = base({
            summary: 'Resumen.',
            scenes: [{ id: 's1', title: 'Paso', focusNodeIds: ['a'], focusEdgeIds: [] }],
        });
        expect(scoreNarrativa(repaired)).toBeLessThan(scoreNarrativa(authored));
    });
});

describe('a story that no longer resolves is reported', () => {
    it('flags scenes and callouts pointing at deleted elements', () => {
        const issue = collectIssues(base({
            summary: 'Escrita contra un diagrama anterior.',
            scenes: [{ id: 's1', title: 'Paso', focusNodeIds: ['a', 'borrado'], focusEdgeIds: ['e-fantasma'] }],
            callouts: [{ id: 'c1', targetId: 'tambien-borrado', targetKind: 'node', text: 'Ojo.' }],
        })).find(candidate => candidate.code === 'NARRATIVE_STALE_REFERENCE');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('high');
        expect(issue?.message).toContain('3');
    });

    it('stays quiet when every reference resolves', () => {
        const issues = collectIssues(base({
            summary: 'Al día.',
            scenes: [{ id: 's1', title: 'Paso', focusNodeIds: ['a', 'b'], focusEdgeIds: ['e1'] }],
        }));
        expect(issues.some(issue => issue.code === 'NARRATIVE_STALE_REFERENCE')).toBe(false);
    });

    it('does not grade a synthesis for references it never made', () => {
        const repaired = autoRepairDiagramIR(base(), {}).ir;
        expect(collectIssues(repaired).some(issue => issue.code === 'NARRATIVE_STALE_REFERENCE')).toBe(false);
    });
});
