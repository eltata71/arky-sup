import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useSuggestionActionRunner } from '../../../hooks/artifacts/useSuggestionActionRunner';
import type { SuggestionActionRunner, SuggestionActionRunnerOptions } from '../../../hooks/artifacts/useSuggestionActionRunner';
import type { ArtifactSuggestion, ArtifactSuggestionAction } from '../../../services/ai/artifactSuggestionTypes';
import type { DiagramIR } from '../../../lib/diagram';

const executeDiagramSuggestionAction = vi.hoisted(() => vi.fn());
vi.mock('../../../services/diagram/suggestionActionExecutors', () => ({ executeDiagramSuggestionAction }));

const ir = { version: 1, kind: 'flowchart', nodes: [], edges: [] } as unknown as DiagramIR;
const nextIR = { ...(ir as object), nodes: [{ id: 'a' }] } as unknown as DiagramIR;

const suggestion = { id: 'sug-1' } as ArtifactSuggestion;
const action = (kind: string, params?: Record<string, string>): ArtifactSuggestionAction =>
    ({ kind, label: kind, params } as unknown as ArtifactSuggestionAction);

const renderRunner = (overrides: Partial<SuggestionActionRunnerOptions> = {}) => {
    const options: SuggestionActionRunnerOptions = {
        ir,
        addToast: vi.fn(),
        persistIR: vi.fn(),
        retryDiagram: vi.fn(),
        autoImproveDiagram: vi.fn(),
        applyWithAI: vi.fn(),
        changeAudience: vi.fn(),
        ...overrides,
    };
    const captured: { run: SuggestionActionRunner | null } = { run: null };
    const Probe: React.FC = () => {
        captured.run = useSuggestionActionRunner(options);
        return null;
    };
    render(<Probe />);
    return { options, run: (a: ArtifactSuggestionAction) => captured.run!(a, suggestion) };
};

describe('useSuggestionActionRunner', () => {
    beforeEach(() => {
        executeDiagramSuggestionAction.mockReset();
    });

    it('persists the mutated IR and reports success', () => {
        executeDiagramSuggestionAction.mockReturnValue({ ir: nextIR, summary: 'Dirección fijada en LR.' });
        const { options, run } = renderRunner();
        run(action('set-layout-direction', { direction: 'LR' }));
        expect(executeDiagramSuggestionAction).toHaveBeenCalledWith(ir, 'set-layout-direction', { direction: 'LR' });
        expect(options.persistIR).toHaveBeenCalledWith(nextIR);
        expect(options.addToast).toHaveBeenCalledWith('Dirección fijada en LR.', 'success');
    });

    it('reports "no changes" without persisting when the rule found nothing', () => {
        executeDiagramSuggestionAction.mockReturnValue({ ir: null, summary: 'No se aplicaron cambios.' });
        const { options, run } = renderRunner();
        run(action('set-layout-density', { density: 'compact' }));
        expect(options.persistIR).not.toHaveBeenCalled();
        expect(options.addToast).toHaveBeenCalledWith('No se aplicaron cambios.', 'info');
    });

    it('falls through to the canonical retry when there is no IR to mutate', () => {
        const { options, run } = renderRunner({ ir: null });
        run(action('apply-elk-layout'));
        expect(executeDiagramSuggestionAction).not.toHaveBeenCalled();
        expect(options.retryDiagram).toHaveBeenCalledTimes(1);
    });

    it.each([
        'assign-group-kind',
        'tag-phi-pii',
        'add-missing-protocols',
        'add-security-controls',
        'split-c4-levels',
    ])('falls through to auto-improve for %s when there is no IR', kind => {
        const { options, run } = renderRunner({ ir: null });
        run(action(kind));
        expect(options.autoImproveDiagram).toHaveBeenCalledTimes(1);
        expect(options.persistIR).not.toHaveBeenCalled();
    });

    it.each(['convert-to-bpmn', 'repair-exportability'])(
        'always delegates %s to auto-improve, even with an IR in hand',
        kind => {
            const { options, run } = renderRunner();
            run(action(kind));
            expect(executeDiagramSuggestionAction).not.toHaveBeenCalled();
            expect(options.autoImproveDiagram).toHaveBeenCalledTimes(1);
        },
    );

    it('switches audience, defaulting to technical when none is named', () => {
        const { options, run } = renderRunner();
        run(action('switch-audience', { audience: 'executive' }));
        run(action('switch-audience'));
        expect((options.changeAudience as ReturnType<typeof vi.fn>).mock.calls.map(([a]) => a)).toEqual([
            'executive',
            'technical',
        ]);
    });

    it('regenerates through the AI path for regenerate-with-ir-direct', () => {
        const { options, run } = renderRunner();
        run(action('regenerate-with-ir-direct'));
        expect(options.applyWithAI).toHaveBeenCalledTimes(1);
    });

    it('warns instead of throwing on an action kind it does not know', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { options, run } = renderRunner();
        expect(() => run(action('invented-kind'))).not.toThrow();
        expect(warn).toHaveBeenCalled();
        expect(options.persistIR).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
