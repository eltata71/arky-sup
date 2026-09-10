import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArtifactTemplate, Project, Settings } from '../../../types';

const generateArtifactContent = vi.hoisted(() => vi.fn());
const refineArtifactBeforePersistence = vi.hoisted(() => vi.fn());

vi.mock('../../../services/ai', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../services/ai')>();
    return {
        ...actual,
        artifactGenerationService: { ...actual.artifactGenerationService, generateArtifactContent },
    };
});
vi.mock('../../../services/artifacts/artifactRefinementOrchestrator', () => ({
    refineArtifactBeforePersistence,
}));

const { runArtifactGeneration } = await import('../../../services/artifacts/artifactGenerationRun');

const project: Project = {
    id: 'p1',
    name: 'Plataforma de Pagos',
    description: 'Sistema de prueba',
    projectContext: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const settings = { language: 'es', aiConfig: { model: 'gemini-2.5-flash' } } as unknown as Settings;

const diagramTemplate: ArtifactTemplate = {
    name: 'Contexto',
    type: 'mermaid-c4-context',
    phase: 'F2',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Mostrar el contexto',
    keyConcepts: [],
    representation: 'diagram',
};

const run = (template: ArtifactTemplate, onWarning?: (m: string) => void) =>
    runArtifactGeneration({
        project,
        template,
        settings,
        action: 'create',
        operationId: 'op-1',
        startedAt: new Date().toISOString(),
        startedMs: Date.now(),
        onWarning,
    });

/** The orchestrator declining to refine — the common path when AI refinement is off. */
const declineRefinement = () => {
    refineArtifactBeforePersistence.mockResolvedValue({
        content: '',
        envelope: undefined,
        initialScore: 70,
        finalScore: 70,
        accepted: false,
        acceptanceReason: 'refinement disabled',
        passes: [],
        warnings: [],
        diagnostics: [],
        fallbackDetected: false,
        rejectedCandidates: 0,
        safetyFailures: 0,
        improvedDimensions: [],
        usedAI: false,
    });
};

describe('runArtifactGeneration', () => {
    beforeEach(() => {
        generateArtifactContent.mockReset();
        refineArtifactBeforePersistence.mockReset();
        declineRefinement();
    });

    it('persists the model output untouched when it renders', async () => {
        generateArtifactContent.mockResolvedValue('graph TD\n  A[Cliente] --> B[API]\n');
        const result = await run(diagramTemplate);

        expect(result.skeletonFallbackError).toBeNull();
        expect(result.ir?.nodes.length).toBeGreaterThan(0);
        expect(result.persistedContent).toContain('Cliente');
        expect(result.generationTrace.renderCounters?.nodes).toBeGreaterThan(0);
        // A two-node diagram scores below the gate's target, so the run is
        // allowed to warn — what it must not do is fall back.
        expect(result.generationTrace.status).not.toBe('fallback');
        expect(result.generationTrace.errors.every(step => step.stage === 'quality-gate')).toBe(true);
    });

    it('persists a deterministic fallback — never nothing — when the model returns empty content', async () => {
        generateArtifactContent.mockResolvedValue('');
        const result = await run(diagramTemplate);

        expect(result.persistedContent.trim().length).toBeGreaterThan(0);
        expect(result.ir?.nodes.length).toBeGreaterThan(0);
        expect(result.skeletonFallbackError).not.toBeNull();
        expect(result.generationTrace.status).toBe('fallback');
    });

    it('substitutes a skeleton and warns the user when the output has no parseable IR', async () => {
        generateArtifactContent.mockResolvedValue('Esto no es un diagrama, es prosa suelta.');
        const onWarning = vi.fn();
        const result = await run(diagramTemplate, onWarning);

        expect(result.ir?.nodes.length).toBeGreaterThan(0);
        expect(result.skeletonFallbackError).not.toBeNull();
        expect(result.generationTrace.status).toBe('fallback');
        expect(onWarning).toHaveBeenCalledTimes(1);
        expect(onWarning.mock.calls[0][0]).toContain('esqueleto de respaldo');
    });

    it('never reports a fallback as clean, even when nothing else went wrong', async () => {
        generateArtifactContent.mockResolvedValue('');
        const result = await run(diagramTemplate);
        expect(result.generationTrace.status).not.toBe('clean');
        expect(result.generationTrace.errors.length).toBeGreaterThan(0);
    });

    it('carries the effective model and the run identity into the trace', async () => {
        generateArtifactContent.mockResolvedValue('graph TD\n  A[Cliente] --> B[API]\n');
        const result = await run(diagramTemplate);

        expect(result.generationTrace.operationId).toBe('op-1');
        expect(result.generationTrace.source).toBe('catalog');
        expect(result.generationTrace.modelEffective?.id).toBeTruthy();
        expect(result.generationTrace.contentLength).toBe(result.persistedContent.length);
    });

    it('keeps the raw provider response beside the persisted content', async () => {
        generateArtifactContent.mockResolvedValue('');
        const result = await run(diagramTemplate);
        expect(result.generatedContent).toBe('');
        expect(result.persistedContent).not.toBe('');
    });

    it('propagates a provider failure so the caller can map it to a message', async () => {
        generateArtifactContent.mockRejectedValue(new Error('503 model overloaded'));
        await expect(run(diagramTemplate)).rejects.toThrow('503 model overloaded');
    });

    it('adopts refined content when the orchestrator accepts it', async () => {
        generateArtifactContent.mockResolvedValue('graph TD\n  A[Cliente] --> B[API]\n');
        refineArtifactBeforePersistence.mockResolvedValue({
            content: 'graph TD\n  A[Cliente] --> B[API Gateway]\n  B --> C[Core]\n',
            envelope: undefined,
            initialScore: 70,
            finalScore: 91,
            accepted: true,
            acceptanceReason: 'improved',
            passes: [{ passNumber: 1, afterScore: 91, changed: true }],
            warnings: [],
            diagnostics: [],
            fallbackDetected: false,
            rejectedCandidates: 0,
            safetyFailures: 0,
            improvedDimensions: ['clarity'],
            usedAI: true,
        });
        const result = await run(diagramTemplate);
        expect(result.persistedContent).toContain('Core');
        expect(result.generationTrace.quality?.finalScore).toBe(91);
    });

    it('persists validated content when the refinement throws', async () => {
        generateArtifactContent.mockResolvedValue('graph TD\n  A[Cliente] --> B[API]\n');
        refineArtifactBeforePersistence.mockRejectedValue(new Error('refiner down'));
        const result = await run(diagramTemplate);

        expect(result.persistedContent).toContain('Cliente');
        expect(result.generationTrace.status).toBe('warning');
        expect(result.generationTrace.errors.some(step => step.stage === 'refinement')).toBe(true);
    });
});
