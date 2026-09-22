/**
 * Lo que el lienzo decidía entre dos ramas de JSX, sin montar el lienzo (F4-05).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';

const ai = vi.hoisted(() => ({
  applyArtifactImprovements: vi.fn(),
  generateTestCases: vi.fn(),
  convertDiagramToDocument: vi.fn(),
}));
vi.mock('../../../services/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  artifactGenerationService: {
    applyArtifactImprovements: ai.applyArtifactImprovements,
    generateTestCases: ai.generateTestCases,
  },
  documentGenerationService: { convertDiagramToDocument: ai.convertDiagramToDocument },
}));

import {
  draftTestCases,
  documentFromDiagramDraft,
  improveWithSuggestions,
  planDiagramAutoImprove,
  replaceMermaidBlock,
  toReviewSuggestions,
} from '../../../services/artifacts/application/artifactImprovement';

const weakIR: DiagramIR = {
  nodes: [
    { id: 'cliente', label: 'cliente', kind: 'person' },
    { id: 'g', label: 'API Gateway', kind: 'gateway' },
    { id: 's1', label: 'Reservas Svc', kind: 'service' },
    { id: 'd', label: 'DB Reservas', kind: 'data' },
  ],
  edges: [
    { id: 'e1', source: 'cliente', target: 'g', label: '' },
    { id: 'e2', source: 'g', target: 's1', label: 'data' },
    { id: 'e3', source: 's1', target: 'd', label: '' },
  ],
  groups: [],
};

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'a1',
  versionGroupId: 'a1',
  version: 1,
  createdAt: '2026-09-22T00:00:00.000Z',
  name: 'Flujo de reservas',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'graph TD; A-->B',
  objective: 'Explicar el flujo',
  keyConcepts: [{ term: 'Reserva', definition: 'x' }],
  representation: 'diagram',
  ...overrides,
});

describe('planDiagramAutoImprove', () => {
  it('guarda el IR reparado con su revisión de calidad y regenera el Mermaid', () => {
    const plan = planDiagramAutoImprove({ artifact: artifact(), ir: weakIR, audience: 'technical', beforeScore: 0 });
    expect(plan.kind).toBe('patch');
    if (plan.kind !== 'patch') throw new Error('unreachable');
    expect(plan.afterScore).toBeGreaterThan(0);
    expect(plan.patch.ir?.metadata).toHaveProperty('qualityReview.score', plan.afterScore);
    expect(typeof plan.patch.content).toBe('string');
  });

  it('en C4 no regenera el texto: su código no sale del IR', () => {
    const plan = planDiagramAutoImprove({ artifact: artifact({ type: 'mermaid-c4-container' as Artifact['type'] }), ir: weakIR, audience: 'technical', beforeScore: 0 });
    if (plan.kind !== 'patch') throw new Error('unreachable');
    expect(plan.patch).not.toHaveProperty('content');
  });

  it('dice «sin cambios» en vez de guardar una versión idéntica', () => {
    const first = planDiagramAutoImprove({ artifact: artifact(), ir: weakIR, audience: 'technical', beforeScore: 0 });
    if (first.kind !== 'patch' || !first.patch.ir) throw new Error('unreachable');
    const again = planDiagramAutoImprove({ artifact: artifact(), ir: first.patch.ir, audience: 'technical', beforeScore: 100 });
    // La invariante: nunca se propone guardar sin un cambio o una nota mejor.
    // Con la nota máxima como punto de partida sólo un cambio real lo justifica.
    if (again.kind === 'patch') expect(again.changes > 0 || again.afterScore > again.beforeScore).toBe(true);
    else expect(again).toMatchObject({ kind: 'no-change', beforeScore: 100 });
  });

  it('sustituye sólo el bloque mermaid de un artefacto híbrido', () => {
    expect(replaceMermaidBlock('# Título\n```mermaid\ngraph TD; A-->B\n```\nFin', 'graph LR; X-->Y'))
      .toBe('# Título\n```mermaid\ngraph LR; X-->Y\n```\nFin');
  });
});

describe('artefactos derivados', () => {
  it('un documento derivado hereda la vista y la fase del diagrama', () => {
    const draft = documentFromDiagramDraft(artifact(), '# Documento');
    expect(draft).toMatchObject({ type: 'markdown', representation: 'document', phase: 'Diseño', content: '# Documento' });
    expect(draft).not.toHaveProperty('id');
  });

  it('los casos de prueba se generan y se devuelven como borrador, sin escribir nada', async () => {
    ai.generateTestCases.mockResolvedValueOnce('## Casos');
    const draft = await draftTestCases(artifact(), {} as never, {} as never);
    expect(draft).toMatchObject({ name: 'Casos de Prueba: Flujo de reservas', phase: 'Validación y Pruebas', content: '## Casos' });
  });
});

describe('mejorar con sugerencias', () => {
  const suggestion = { id: 's1', title: 'Cifrar', description: 'Falta TLS.', recommendedAction: 'Añadir TLS.', gapType: 'security' as const };

  it('traduce cada hueco a la categoría de la revisión', () => {
    expect(toReviewSuggestions([suggestion])).toEqual([
      { id: 's1', title: 'Cifrar', description: 'Falta TLS. Acción recomendada: Añadir TLS.', category: 'Security' },
    ]);
  });

  it('no propone una versión cuando el modelo devuelve lo mismo o nada', async () => {
    ai.applyArtifactImprovements.mockResolvedValueOnce('  graph TD; A-->B  ');
    expect(await improveWithSuggestions(artifact(), [suggestion], {} as never, {} as never)).toBeNull();
    ai.applyArtifactImprovements.mockResolvedValueOnce('');
    expect(await improveWithSuggestions(artifact(), [suggestion], {} as never, {} as never)).toBeNull();
    ai.applyArtifactImprovements.mockResolvedValueOnce('graph TD; A-->C');
    expect(await improveWithSuggestions(artifact(), [suggestion], {} as never, {} as never)).toBe('graph TD; A-->C');
  });
});
