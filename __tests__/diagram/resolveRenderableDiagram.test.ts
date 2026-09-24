import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRenderableDiagram } from '../../services/diagram/resolveRenderableDiagram';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';
import type { Artifact } from '../../lib/artifacts';

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', name), 'utf-8');

function makeArtifact(content: string, extra?: Partial<Artifact>): Artifact {
  return {
    id: 'a1',
    versionGroupId: 'vg1',
    name: 'Diagrama',
    type: 'mermaid-c4-context',
    content,
    phase: 'Fase 1',
    architecturalView: 'Vista de Contexto y Negocio',
    objective: 'Test',
    keyConcepts: [],
    representation: 'diagram',
    createdAt: new Date().toISOString(),
    version: 1,
    ...extra,
  };
}

describe('resolveRenderableDiagram', () => {
  it('renders C4 context fixture with visible nodes and edges', () => {
    const artifact = makeArtifact(fixture('c4-context-basic.mmd'));
    const resolved = resolveRenderableDiagram(artifact, { audience: 'technical' });

    expect(resolved.status).toBe('ready');
    expect(resolved.counters.renderNodes).toBeGreaterThanOrEqual(3);
    expect(resolved.counters.validEdges).toBeGreaterThanOrEqual(2);
  });

  it('uses generated flow as canonical base when projection source is weak', () => {
    const generated = {
      nodes: [{ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'A', type: 'System', description: '' } }],
      edges: [],
    };
    const artifact = makeArtifact('texto no mermaid');
    const resolved = resolveRenderableDiagram(artifact, { audience: 'executive', generatedFlow: generated });

    expect(resolved.source).toBe('generated.ir');
    expect(resolved.counters.baseNodes).toBe(1);
    expect(resolved.status).toBe('ready');
  });

  it('returns a placeholder (status repairable) when no IR can be produced', () => {
    // Previously returned status 'invalid' with an empty canvas. The new
    // safety net replaces empty content with a placeholder IR so the user
    // sees a clear "Diagrama no disponible" hint plus repair actions.
    const artifact = makeArtifact('sin diagrama utilizable');
    const resolved = resolveRenderableDiagram(artifact, { audience: 'technical' });

    expect(resolved.status).toBe('repairable');
    expect(resolved.reactFlow.nodes.length).toBeGreaterThanOrEqual(2);
    expect(resolved.repairActions.length).toBeGreaterThan(0);
    expect(resolved.quality).not.toBeNull();
  });
});

describe('quality caps', () => {
  it('forces score 0 when no nodes exist', () => {
    const report = analyzeDiagramQuality({ nodes: [], edges: [], groups: [] });
    expect(report.score).toBe(0);
  });

  it('caps score at 40 when edges reference missing nodes', () => {
    const ir = mermaidToIR(`flowchart LR\nA[Svc] --> B[API]`);
    ir.edges.push({ id: 'broken', source: 'A', target: 'missing', label: 'Broken' });
    const report = analyzeDiagramQuality(ir);
    expect(report.score).toBeLessThanOrEqual(40);
  });
});

describe('resolveRenderableDiagram — on-demand resilience', () => {
    it('returns a repairable placeholder with visible nodes for invalid hybrid content', () => {
        const resolution = resolveRenderableDiagram({
            id: 'bad-hybrid',
            type: 'hybrid-text-diagram',
            representation: 'hybrid',
            content: '# Bad artifact\n\nNo mermaid here',
        }, { audience: 'technical' });

        expect(resolution.status).toBe('repairable');
        expect(resolution.reactFlow.nodes.length).toBeGreaterThan(0);
        expect(resolution.repairActions.join(' ')).toMatch(/Regenerar|Editar|Copiar reporte/i);
    });
});

describe('resolveRenderableDiagram — pharmacy claim BPMN fallback regression', () => {
    // The empty-canvas regression reported on iPad/Safari fired when the
    // on-demand BPMN flow degraded to the deterministic local skeleton. This
    // test wires the actual fallback content through the same render pipeline
    // the canvas uses to make sure we never ship a state where the artifact
    // exists but the canvas can't materialise nodes.
    it('produces a ready render with visible ReactFlow nodes for the deterministic BPMN fallback for any audience', async () => {
        const { buildDeterministicArtifactFallback } = await import('../../services/artifacts/deterministicArtifactFallbacks');
        const { buildHeuristicCustomArtifactRecommendation } = await import('../../services/ai/generation/recommendation/customArtifactHeuristics');
        const project: Parameters<typeof buildHeuristicCustomArtifactRecommendation>[0] = {
            id: 'test-project',
            name: 'Modernización del flujo de farmacia',
            description: 'Pipeline de pagos de reclamos de farmacia para una EPS regional.',
            projectContext: [
                'La farmacia dispensa la receta y captura el reclamo NCPDP en el POS.',
                'El switch/PBM enruta el reclamo a la aseguradora.',
                'La aseguradora adjudica el monto cubierto y autoriza el pago.',
            ],
            artifacts: [],
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
        };
        const idea = 'Se requiere ilustrar mediante un diagrama el proceso de pago de reclamos de farmacia, desde el momento en que se dispensa la receta hasta cuando finalmente la farmacia recibe el pago por parte de la compañía de seguros.';
        const recommendation = buildHeuristicCustomArtifactRecommendation(project, idea);
        const content = buildDeterministicArtifactFallback(project, recommendation.template);

        const audiences = ['executive', 'technical', 'operations'] as const;
        for (const audience of audiences) {
            const resolution = resolveRenderableDiagram({
                id: `bpmn-${audience}`,
                type: 'hybrid-text-diagram',
                representation: 'hybrid',
                content,
            }, { audience });

            expect(resolution.status).toBe('ready');
            expect(resolution.reactFlow.nodes.length).toBeGreaterThanOrEqual(2);
            // The fallback is built from the project's signal context — every
            // audience projection must keep at least the actor + system pair so
            // the canvas never appears blank for the user that asked for the
            // pharmacy claim flow.
            expect(resolution.counters.baseNodes).toBeGreaterThan(0);
        }
    });
});
