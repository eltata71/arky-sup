import { describe, it, expect } from 'vitest';
import {
    buildGenerationTrace,
    createTraceLog,
    makeTraceStep,
    mapRequestAudienceToDiagramAudience,
    replaceMermaidBlock,
    resolveRefinementMode,
} from '../../../services/artifacts/domain/artifactGenerationTrace';
import type { ArtifactTemplate } from '../../../types';

const template = (overrides: Partial<ArtifactTemplate> = {}): ArtifactTemplate => ({
    name: 'Contexto',
    type: 'mermaid-c4-context',
    phase: 'F2',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'o',
    keyConcepts: [],
    representation: 'diagram',
    ...overrides,
});

const buildTrace = (overrides: Partial<Parameters<typeof buildGenerationTrace>[0]> = {}) =>
    buildGenerationTrace({
        log: createTraceLog(),
        template: template(),
        action: 'create',
        operationId: 'op-1',
        startedAt: new Date().toISOString(),
        startedMs: Date.now() - 1200,
        persistedContent: 'graph TD\n  A --> B\n',
        ir: null,
        skeletonFallbackError: null,
        refinementFallbackDetected: false,
        quality: undefined,
        generationModel: { id: 'gemini-2.5-flash', source: 'global', tier: 'default', requested: undefined } as never,
        architectureGraph: { used: false } as never,
        ...overrides,
    });

describe('buildGenerationTrace — status precedence', () => {
    it('is clean when nothing went wrong', () => {
        expect(buildTrace().status).toBe('clean');
    });

    it('is warning when a stage warned', () => {
        const log = createTraceLog();
        log.errors.push(makeTraceStep('quality-gate', 'warning', 'bajo objetivo'));
        expect(buildTrace({ log }).status).toBe('warning');
    });

    it('is failed when a stage errored', () => {
        const log = createTraceLog();
        log.errors.push(makeTraceStep('quality-gate', 'warning', 'bajo objetivo'));
        log.errors.push(makeTraceStep('render', 'error', 'sin nodos visibles'));
        expect(buildTrace({ log }).status).toBe('failed');
    });

    it('is fallback whenever a skeleton stood in, outranking an error', () => {
        const log = createTraceLog();
        log.errors.push(makeTraceStep('render', 'error', 'sin nodos visibles'));
        const trace = buildTrace({
            log,
            skeletonFallbackError: { reason: 'skeleton-fallback', attempt: 1, at: new Date().toISOString(), sample: '', message: 'm' },
        });
        expect(trace.status).toBe('fallback');
    });

    it('is fallback when the refinement orchestrator detected a document fallback', () => {
        expect(buildTrace({ refinementFallbackDetected: true }).status).toBe('fallback');
    });

    it('appends a persistence decision that names the status it is about to persist', () => {
        const trace = buildTrace({ refinementFallbackDetected: true });
        const last = trace.decisions[trace.decisions.length - 1];
        expect(last.stage).toBe('persistence');
        expect(last.detail).toContain('fallback');
    });

    it('reports render-fallback in the lifecycle when nothing rendered', () => {
        expect(buildTrace().lifecycle).toContain('render-fallback');
        expect(buildTrace({ renderCounters: { nodes: 3, edges: 2 } }).lifecycle).toContain('render-ready');
    });

    it('collects only warnings into the human-readable warning list', () => {
        const log = createTraceLog();
        log.errors.push(makeTraceStep('quality-gate', 'warning', 'bajo objetivo'));
        log.errors.push(makeTraceStep('render', 'error', 'sin nodos'));
        expect(buildTrace({ log }).warnings).toEqual(['bajo objetivo']);
    });

    it('records the source the run came from', () => {
        expect(buildTrace().source).toBe('catalog');
        expect(buildTrace({ action: 'new_version' }).source).toBe('regeneration');
        expect(buildTrace({ template: template({ requestContext: { userRequest: 'x' } as never }) }).source).toBe('on-demand');
    });
});

describe('mapRequestAudienceToDiagramAudience', () => {
    it('keeps executive, and biases mixed and unset towards technical', () => {
        expect(mapRequestAudienceToDiagramAudience('executive')).toBe('executive');
        expect(mapRequestAudienceToDiagramAudience('mixed')).toBe('technical');
        expect(mapRequestAudienceToDiagramAudience('technical')).toBe('technical');
        expect(mapRequestAudienceToDiagramAudience(undefined)).toBe('technical');
    });
});

describe('resolveRefinementMode', () => {
    it('picks the mode from the template shape', () => {
        expect(resolveRefinementMode(template({ type: 'hybrid-text-diagram' }))).toBe('hybrid');
        expect(resolveRefinementMode(template({ type: 'mermaid-c4-context' }))).toBe('diagram');
        expect(resolveRefinementMode(template({ type: 'react-flow-graph' }))).toBe('diagram');
        expect(resolveRefinementMode(template({ type: 'sdd-traceability', representation: 'document' }))).toBe('table');
        expect(resolveRefinementMode(template({ type: 'markdown', representation: 'document' }))).toBe('document');
    });
});

describe('replaceMermaidBlock', () => {
    it('replaces the fenced block and keeps the prose around it', () => {
        const hybrid = '# Título\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nTexto final.';
        const next = replaceMermaidBlock(hybrid, 'graph LR\n  C --> D');
        expect(next).toContain('# Título');
        expect(next).toContain('Texto final.');
        expect(next).toContain('graph LR');
        expect(next).not.toContain('A --> B');
    });

    it('returns the diagram itself when there is no prose to keep', () => {
        expect(replaceMermaidBlock('graph TD\n  A --> B', 'graph LR\n  C --> D')).toBe('graph LR\n  C --> D');
    });
});
