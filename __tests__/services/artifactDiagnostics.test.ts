import { describe, expect, it } from 'vitest';
import {
    buildArtifactDiagnosticReport,
    buildRenderDiagnosticsSummary,
} from '../../services/artifacts/domain/diagnostics';
import type { Artifact } from '../../lib/artifacts';
import type { RenderableDiagramResolution } from '../../services/diagram/resolveRenderableDiagram';

const makeRenderable = (overrides: Partial<RenderableDiagramResolution> = {}): RenderableDiagramResolution => ({
    status: 'ready',
    source: 'artifact.ir',
    ir: null,
    reactFlow: { nodes: [], edges: [] },
    diagnostics: [],
    quality: null,
    warnings: [],
    repairActions: [],
    counters: { baseNodes: 0, projectedNodes: 0, renderNodes: 0, validEdges: 0 },
    qualityGateChanges: [],
    qualityGateReachedTarget: false,
    ...overrides,
});

const baseArtifact: Artifact = {
    id: 'a-1',
    versionGroupId: 'vg',
    version: 1,
    createdAt: '2026-05-11T00:00:00.000Z',
    name: 'Diagrama',
    type: 'mermaid-graph',
    phase: 'P',
    architecturalView: 'Vista Lógica y de Diseño',
    content: 'flowchart LR\nA-->B',
    objective: 'Diagramar',
    keyConcepts: [],
    representation: 'diagram',
};

describe('buildArtifactDiagnosticReport', () => {
    it('returns null when there is nothing observable', () => {
        const report = buildArtifactDiagnosticReport({
            projectId: 'p',
            projectName: 'Proj',
            artifact: baseArtifact,
            audience: 'technical',
            renderable: makeRenderable(),
        });
        expect(report).toBeNull();
    });

    it('serializes generation trace + render diagnostics into the report', () => {
        const report = buildArtifactDiagnosticReport({
            projectId: 'p',
            projectName: 'Proj',
            artifact: {
                ...baseArtifact,
                generationTrace: {
                    id: 't-1',
                    operationId: 'op-1',
                    source: 'catalog',
                    status: 'fallback',
                    startedAt: '2026-05-11T00:00:00.000Z',
                    decisions: [],
                    errors: [],
                },
            },
            audience: 'executive',
            renderable: makeRenderable({
                diagnostics: [{ stage: 'build-ir', message: 'sin nodos' }],
                warnings: ['skeleton-applied'],
                repairActions: ['regenerate-with-context'],
            }),
        });
        expect(report).toContain('operationId=op-1');
        expect(report).toContain('trace.status=fallback');
        expect(report).toContain('warning[0]=skeleton-applied');
        expect(report).toContain('repairAction[0]=regenerate-with-context');
        expect(report).toContain('diag[0].stage=build-ir');
    });

    it('records lastDiagramError fields when present', () => {
        const report = buildArtifactDiagnosticReport({
            projectId: 'p',
            projectName: 'Proj',
            artifact: {
                ...baseArtifact,
                lastDiagramError: {
                    reason: 'skeleton-fallback',
                    attempt: 2,
                    at: '2026-05-11T00:00:00.000Z',
                    message: 'IA agotada',
                },
            },
            audience: 'technical',
            renderable: makeRenderable(),
        });
        expect(report).toContain('lastDiagramError.reason=skeleton-fallback');
        expect(report).toContain('lastDiagramError.attempt=2');
        expect(report).toContain('lastDiagramError.message=IA agotada');
    });
});

describe('buildRenderDiagnosticsSummary', () => {
    it('returns null when no diagnostics are present', () => {
        const summary = buildRenderDiagnosticsSummary({ renderable: makeRenderable() });
        expect(summary).toBeNull();
    });

    it('summarises the first diagnostic for the banner', () => {
        const summary = buildRenderDiagnosticsSummary({
            renderable: makeRenderable({
                diagnostics: [{
                    stage: 'parse-mermaid',
                    message: 'Mermaid inválido',
                    detail: 'línea 3',
                }],
            }),
        });
        expect(summary).toBe('Etapa parse-mermaid: Mermaid inválido (línea 3)');
    });
});
