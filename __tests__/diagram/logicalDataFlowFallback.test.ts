import { describe, expect, it } from 'vitest';
import { buildDeterministicArtifactFallback } from '../../services/artifacts/deterministicArtifactFallbacks';
import { buildHeuristicCustomArtifactRecommendation } from '../../services/ai/generation/recommendation/customArtifactHeuristics';
import { resolveRenderableDiagram } from '../../services/diagram/resolveRenderableDiagram';
import type { ArtifactTemplate } from '../../types';
import type { Project } from '../../services/architectureProjects';

const project: Project = {
  id: 'claims-project',
  name: 'WeeCompany PBM',
  description: 'Modernización del pago de reclamos farmacéuticos.',
  projectContext: [
    'La farmacia captura reclamos NCPDP desde el POS.',
    'El PBM valida elegibilidad, cobertura, acumuladores y adjudicación.',
    'La aseguradora autoriza cobertura y el banco liquida pagos a farmacia.',
  ],
  artifacts: [],
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
};

const dfdTemplate: ArtifactTemplate = {
  name: 'Diagrama de Flujo de Datos Lógico',
  type: 'hybrid-text-diagram',
  phase: 'Fase 2: Diseño Conceptual y Lógico',
  architecturalView: 'Vista de Datos',
  objective: 'Mostrar actores externos, procesos, almacenes y flujos de datos del pago de reclamos farmacéuticos.',
  keyConcepts: [],
  representation: 'hybrid',
  requestContext: {
    userRequest: 'Necesito un Diagrama de Flujo de Datos Lógico para el proceso de pago de reclamos de farmacia.',
    rationale: 'Regresión de canvas en blanco reportada por usuario.',
    constructionPlan: ['Normalizar contrato DFD', 'Generar Mermaid flowchart LR', 'Validar render'],
    audience: 'mixed',
    matchedCatalogTemplateName: 'Diagrama de Flujo de Datos Lógico',
  },
};

describe('Logical Data Flow Diagram fallback', () => {
  it('builds a hybrid DFD with a Mermaid block and a visible ReactFlow render', () => {
    const content = buildDeterministicArtifactFallback(project, dfdTemplate);

    expect(content).toContain('Contrato del DFD lógico');
    expect(content).toContain('```mermaid');
    expect(content).toMatch(/flowchart LR/);
    expect(content).toMatch(/Límite lógico/);

    const resolution = resolveRenderableDiagram({
      id: 'dfd-regression',
      type: 'hybrid-text-diagram',
      representation: 'hybrid',
      content,
    }, { audience: 'technical' });

    expect(resolution.status).toBe('ready');
    expect(resolution.counters.baseNodes).toBeGreaterThanOrEqual(8);
    expect(resolution.reactFlow.nodes.length).toBeGreaterThan(0);
    expect(resolution.reactFlow.edges.length).toBeGreaterThan(0);
  });

  it('ranks an explicit DFD request toward the catalog DFD template instead of BPMN', () => {
    const recommendation = buildHeuristicCustomArtifactRecommendation(
      project,
      'Diagrama de Flujo de Datos Lógico del proceso de pago de reclamos farmacéuticos con almacenes de datos y actores externos',
    );

    expect(recommendation.matchedCatalogTemplateName).toBe('Diagrama de Flujo de Datos Lógico');
    expect(recommendation.template.type).toBe('mermaid-graph');
    expect(recommendation.template.representation).toBe('diagram');
  });
});
