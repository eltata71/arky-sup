import { describe, it, expect } from 'vitest';
import { buildDiagramSuggestionActions, enrichSuggestionsWithActions } from '../../services/diagram/suggestionActions';
import type { ArtifactSuggestion } from '../../services/ai/artifactSuggestionService';
import type { DiagramIR } from '../../lib/diagram';

const makeIR = (over: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: over.nodes ?? [
        { id: 'a', label: 'Front', kind: 'service' },
        { id: 'b', label: 'API', kind: 'service' },
        { id: 'c', label: 'DB', kind: 'data' },
    ],
    edges: over.edges ?? [
        { id: 'e1', source: 'a', target: 'b', label: 'invoca', criticality: 'critical' },
        { id: 'e2', source: 'b', target: 'c', label: 'lee' },
    ],
    groups: over.groups ?? [{ id: 'g', label: 'Domain', nodeIds: ['a', 'b', 'c'] }],
    metadata: over.metadata,
});

describe('buildDiagramSuggestionActions (Gap 13)', () => {
    it('always offers apply-elk-layout and toggle direction', () => {
        const actions = buildDiagramSuggestionActions({ ir: makeIR() });
        const kinds = actions.map((a) => a.kind);
        expect(kinds).toContain('apply-elk-layout');
        expect(kinds).toContain('set-layout-direction');
    });

    it('offers density triplet excluding the active density', () => {
        const actions = buildDiagramSuggestionActions({ ir: makeIR(), currentDensity: 'normal' });
        const densities = actions
            .filter((a) => a.kind === 'set-layout-density')
            .map((a) => a.params?.density);
        expect(densities).toEqual(expect.arrayContaining(['compact', 'spacious']));
        expect(densities).not.toContain('normal');
    });

    it('suggests add-missing-protocols when critical edges lack a protocol', () => {
        const actions = buildDiagramSuggestionActions({ ir: makeIR() });
        expect(actions.some((a) => a.kind === 'add-missing-protocols')).toBe(true);
    });

    it('suggests tag-phi-pii on healthcare diagrams missing dataClassification', () => {
        const ir = makeIR({
            metadata: { title: 'HIPAA / FHIR Integration' },
            nodes: [
                { id: 'p', label: 'Patient Portal', kind: 'system' },
                { id: 'fhir', label: 'FHIR API', kind: 'service' },
                { id: 'ehr', label: 'EHR', kind: 'data' },
            ],
        });
        const actions = buildDiagramSuggestionActions({ ir });
        expect(actions.some((a) => a.kind === 'tag-phi-pii')).toBe(true);
    });

    it('always includes regenerate-with-ir-direct as a last-resort action', () => {
        const actions = buildDiagramSuggestionActions({ ir: makeIR() });
        expect(actions.some((a) => a.kind === 'regenerate-with-ir-direct')).toBe(true);
    });
});

describe('enrichSuggestionsWithActions (Gap 13)', () => {
    const baseSuggestion = (over: Partial<ArtifactSuggestion> = {}): ArtifactSuggestion => ({
        id: 'sug-1',
        title: 'Mejorar diagrama',
        description: 'desc',
        gapType: 'architecture',
        impact: 'medium',
        effort: 'medium',
        recommendedAction: 'rec',
        evidence: 'ev',
        expectedQualityGain: 10,
        ...over,
    });

    it('attaches layout actions to layout-flavoured suggestions', () => {
        const enriched = enrichSuggestionsWithActions(
            [baseSuggestion({ title: 'Layout con cruces', description: 'demasiados cruces de aristas' })],
            { ir: makeIR() },
        );
        const actions = enriched[0].actions ?? [];
        expect(actions.some((a) => a.kind === 'apply-elk-layout')).toBe(true);
    });

    it('does not overwrite existing actions on a suggestion', () => {
        const original = baseSuggestion({
            actions: [{ kind: 'switch-audience', label: 'Vista exec', params: { audience: 'executive' } }],
        });
        const enriched = enrichSuggestionsWithActions([original], { ir: makeIR() });
        expect(enriched[0].actions?.length).toBe(1);
        expect(enriched[0].actions?.[0].kind).toBe('switch-audience');
    });

    it('attaches PHI tagging actions to healthcare-flavoured suggestions', () => {
        const enriched = enrichSuggestionsWithActions(
            [baseSuggestion({ title: 'Falta clasificación PHI', description: 'datos sensibles sin marcar' })],
            { ir: makeIR({ metadata: { title: 'HIPAA' } }) },
        );
        const actions = enriched[0].actions ?? [];
        expect(actions.some((a) => a.kind === 'tag-phi-pii')).toBe(true);
    });
});
