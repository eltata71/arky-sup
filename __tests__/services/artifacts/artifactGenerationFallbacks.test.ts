import { describe, it, expect, vi } from 'vitest';
import {
    ensureRenderableDiagram,
    measureRenderCounters,
    substituteEmptyContent,
    type DiagramDraft,
    type DiagramFallbackContext,
} from '../../../services/artifacts/application/artifactGenerationFallbacks';
import { createTraceLog } from '../../../services/artifacts/domain/artifactGenerationTrace';
import type { ArtifactTemplate } from '../../../types';
import type { Project } from '../../../services/architectureProjects';

const project: Project = {
    id: 'p1',
    name: 'Plataforma de Pagos',
    description: 'Sistema de prueba',
    projectContext: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const diagramTemplate: ArtifactTemplate = {
    name: 'Contexto',
    type: 'mermaid-c4-context',
    phase: 'F2',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Mostrar el contexto',
    keyConcepts: [],
    representation: 'diagram',
};

const documentTemplate: ArtifactTemplate = {
    ...diagramTemplate,
    name: 'Decisiones',
    type: 'markdown',
    representation: 'document',
};

const context = (template: ArtifactTemplate, isDiagramTemplate: boolean): DiagramFallbackContext => ({
    project,
    template,
    isDiagramTemplate,
    log: createTraceLog(),
});

const draftOf = (content: string, ir: DiagramDraft['ir'] = null): DiagramDraft => ({
    content,
    resolvedContent: content,
    ir,
    skeletonFallbackError: null,
});

describe('substituteEmptyContent — the first net', () => {
    it('leaves real content alone and records no fallback', () => {
        const ctx = context(diagramTemplate, true);
        const result = substituteEmptyContent(ctx, 'graph TD\n  A --> B\n');
        expect(result.content).toBe('graph TD\n  A --> B\n');
        expect(result.skeletonFallbackError).toBeNull();
        expect(ctx.log.errors).toHaveLength(0);
    });

    it('substitutes a diagram skeleton, and declares it', () => {
        const ctx = context(diagramTemplate, true);
        const result = substituteEmptyContent(ctx, '');
        expect(result.content.trim().length).toBeGreaterThan(0);
        expect(result.skeletonFallbackError?.reason).toBe('skeleton-fallback');
        expect(ctx.log.errors.some(step => step.stage === 'fallback')).toBe(true);
    });

    it('substitutes prose for a document, with no diagram error record', () => {
        const ctx = context(documentTemplate, false);
        const result = substituteEmptyContent(ctx, '   ');
        expect(result.content.trim().length).toBeGreaterThan(0);
        expect(result.skeletonFallbackError).toBeNull();
        expect(ctx.log.errors.some(step => step.stage === 'fallback')).toBe(true);
    });

    it('tells the caller which stage degraded, through onPhase', () => {
        const onPhase = vi.fn();
        substituteEmptyContent(context(diagramTemplate, true), '', onPhase);
        expect(onPhase).toHaveBeenCalledTimes(1);
        expect(onPhase.mock.calls[0][0]).toMatchObject({ stage: 'fallback', status: 'warning' });
    });
});

describe('ensureRenderableDiagram — the second net', () => {
    it('replaces unparseable output with a skeleton and warns the user', () => {
        const ctx = context(diagramTemplate, true);
        const draft = draftOf('Esto es prosa, no un diagrama.');
        const onWarning = vi.fn();

        ensureRenderableDiagram(draft, ctx, onWarning);

        expect(draft.ir?.nodes.length).toBeGreaterThan(0);
        expect(draft.resolvedContent).not.toBe('Esto es prosa, no un diagrama.');
        expect(draft.skeletonFallbackError).not.toBeNull();
        expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it('leaves a document alone — a skeleton is a diagram remedy', () => {
        const ctx = context(documentTemplate, false);
        const draft = draftOf('# Decisiones\n\nTexto.');
        const onWarning = vi.fn();

        ensureRenderableDiagram(draft, ctx, onWarning);

        expect(draft.resolvedContent).toBe('# Decisiones\n\nTexto.');
        expect(draft.skeletonFallbackError).toBeNull();
        expect(onWarning).not.toHaveBeenCalled();
    });

    it('catches a previous fallback that happens to parse cleanly', () => {
        const ctx = context(diagramTemplate, true);
        const skeleton = substituteEmptyContent(context(diagramTemplate, true), '').content;
        const draft = draftOf(skeleton, { nodes: [{ id: 'a' }], edges: [] } as never);

        ensureRenderableDiagram(draft, ctx);

        expect(draft.skeletonFallbackError).not.toBeNull();
        expect(ctx.log.errors.some(step => step.stage === 'fallback')).toBe(true);
    });
});

describe('measureRenderCounters — the third net', () => {
    it('counts what the canvas will actually draw', () => {
        const ctx = context(diagramTemplate, true);
        const draft = draftOf('graph TD\n  A --> B\n');
        ensureRenderableDiagram(draft, ctx);

        const counters = measureRenderCounters(draft, ctx);

        expect(counters?.nodes).toBeGreaterThan(0);
        expect(ctx.log.decisions.some(step => step.stage === 'render')).toBe(true);
    });

    it('returns nothing for a document, which has no canvas to measure', () => {
        const ctx = context(documentTemplate, false);
        expect(measureRenderCounters(draftOf('# Texto'), ctx)).toBeUndefined();
    });
});
