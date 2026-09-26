import { describe, expect, it } from 'vitest';
import {
    buildArtifactRenderState,
    buildArtifactViewModel,
    deriveDiagramRenderStatus,
    deriveDocumentRenderStatus,
    getArtifactViewCapabilities,
    resolveSafeArtifactView,
} from '../../services/artifacts/application/viewController';
import type { Artifact } from '../../lib/artifacts';

const baseDocumentArtifact: Artifact = {
    id: 'a-doc',
    versionGroupId: 'vg',
    version: 1,
    createdAt: '2026-05-11T00:00:00.000Z',
    name: 'SRS — Sistema Demo',
    type: 'markdown',
    phase: 'Especificación',
    architecturalView: 'Vista Lógica y de Diseño',
    content: '# SRS\n\n## Alcance\n\nEl sistema permite gestionar arquitecturas.\n',
    objective: 'Documentar requisitos',
    keyConcepts: [],
    representation: 'document',
};

const baseDiagramArtifact: Artifact = {
    ...baseDocumentArtifact,
    id: 'a-diag',
    name: 'Diagrama de integración',
    type: 'mermaid-graph',
    content: 'flowchart LR\n  A --> B\n  B --> C',
    representation: 'diagram',
};

describe('viewController.buildArtifactViewModel', () => {
    it('detects documents without diagrams', () => {
        const vm = buildArtifactViewModel(baseDocumentArtifact);
        expect(vm.hasDocument).toBe(true);
        expect(vm.hasDiagram).toBe(false);
        expect(vm.hasMermaid).toBe(false);
        expect(vm.audience).toBe('technical');
        expect(vm.theme).toBe('editorial');
    });

    it('detects mermaid content in diagram artifacts', () => {
        const vm = buildArtifactViewModel(baseDiagramArtifact);
        expect(vm.hasDiagram).toBe(true);
        expect(vm.hasMermaid).toBe(true);
    });

    it('handles hybrid artifacts with mermaid blocks', () => {
        const vm = buildArtifactViewModel({
            ...baseDocumentArtifact,
            representation: 'hybrid',
            type: 'hybrid-text-diagram',
            content: '# Title\n\nIntro\n\n```mermaid\nflowchart TD\nA-->B\n```\n\nAfter',
        });
        expect(vm.hasDiagram).toBe(true);
        expect(vm.hasDocument).toBe(true);
        expect(vm.hasMermaid).toBe(true);
    });
});

describe('viewController.resolveSafeArtifactView', () => {
    it('falls back to preferred view when the requested mode is impossible', () => {
        const safe = resolveSafeArtifactView(baseDocumentArtifact, 'diagram');
        // document-only artifact cannot honour a diagram request.
        expect(['document', 'markdown']).toContain(safe);
    });

    it('respects the request when the artifact supports it', () => {
        const safe = resolveSafeArtifactView(baseDiagramArtifact, 'diagram');
        expect(safe).toBe('diagram');
    });

    it('uses preferredView for documents without diagrams when split is requested', () => {
        const safe = resolveSafeArtifactView(baseDocumentArtifact, 'split');
        // baseDocumentArtifact has no diagram so split must degrade.
        expect(['document', 'markdown']).toContain(safe);
    });

    it('keeps split when both surfaces exist', () => {
        const capabilities = getArtifactViewCapabilities({
            ...baseDocumentArtifact,
            representation: 'hybrid',
            type: 'hybrid-text-diagram',
            content: '# Mix\n\nDescripción\n\n```mermaid\nflowchart TD\nA-->B\n```',
        });
        expect(capabilities.hasRenderableDiagram).toBe(true);
        expect(capabilities.hasRenderableDocument).toBe(true);
        expect(capabilities.availableViews).toEqual(expect.arrayContaining(['split', 'diagram', 'document']));
    });
});

describe('viewController.derive*', () => {
    it('classifies an idle diagram with no nodes as empty', () => {
        expect(deriveDiagramRenderStatus({ isLoading: false, error: null, nodeCount: 0, edgeCount: 0, fallbackUsed: false })).toBe('empty');
    });

    it('classifies a populated diagram as rendered', () => {
        expect(deriveDiagramRenderStatus({ isLoading: false, error: null, nodeCount: 4, edgeCount: 3, fallbackUsed: false })).toBe('rendered');
    });

    it('classifies a populated fallback as rendered-with-fallback', () => {
        expect(deriveDiagramRenderStatus({ isLoading: false, error: null, nodeCount: 2, edgeCount: 1, fallbackUsed: true })).toBe('rendered-with-fallback');
    });

    it('classifies an errored empty diagram as invalid', () => {
        expect(deriveDiagramRenderStatus({ isLoading: false, error: 'boom', nodeCount: 0, edgeCount: 0, fallbackUsed: false })).toBe('invalid');
    });

    it('classifies an empty document as empty regardless of html length', () => {
        expect(deriveDocumentRenderStatus({ htmlLength: 0, contentLength: 0 })).toBe('empty');
    });

    it('classifies a rendered document', () => {
        expect(deriveDocumentRenderStatus({ htmlLength: 42, contentLength: 12 })).toBe('rendered');
    });
});

describe('viewController.buildArtifactRenderState', () => {
    it('combines diagram + document state into a single record with empty diagnostics by default', () => {
        const state = buildArtifactRenderState({
            viewMode: 'document',
            diagram: { isLoading: false, error: null, nodeCount: 0, edgeCount: 0, fallbackUsed: false, source: 'unknown' },
            document: { htmlLength: 32, contentLength: 100 },
            hasMarkdownSource: true,
        });
        expect(state.diagram.status).toBe('empty');
        expect(state.document.status).toBe('rendered');
        expect(state.diagnostics).toEqual([]);
    });

    it('preserves a passed-in fallback flag', () => {
        const state = buildArtifactRenderState({
            viewMode: 'diagram',
            diagram: { isLoading: false, error: null, nodeCount: 4, edgeCount: 4, fallbackUsed: true, source: 'fallback' },
            document: { htmlLength: 0, contentLength: 0 },
            hasMarkdownSource: false,
        });
        expect(state.diagram.fallbackUsed).toBe(true);
        expect(state.diagram.status).toBe('rendered-with-fallback');
    });
});
