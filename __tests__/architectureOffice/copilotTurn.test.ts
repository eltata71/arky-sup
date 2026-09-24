/**
 * Where a copilot turn goes (F5-02). The routing lived in the send handler of
 * `ProjectCopilotChatModal`; it is `routeCopilotTurn` now, in the Office's
 * application layer, and each branch is checked here without rendering.
 */
import { describe, expect, it } from 'vitest';
import { copilotAnchorFor, routeCopilotTurn } from '../../services/architectureOffice';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

const artifact = (id: string, name: string): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: '2026-05-01T00:00:00.000Z',
  name,
  type: 'mermaid-c4-context',
  phase: 'Análisis',
  architecturalView: 'Vista de Contexto y Negocio',
  content: 'flowchart LR\n  a --> b',
  objective: 'Mostrar el sistema',
  keyConcepts: [],
  representation: 'diagram',
});

const project = (artifacts: Artifact[]): Project => ({
  id: 'prj-1',
  name: 'Reclamos',
  description: 'Modernización',
  artifacts,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  projectContext: [],
} as unknown as Project);

describe('routeCopilotTurn', () => {
  it('an explicit coordination command runs the Office orchestration', () => {
    expect(routeCopilotTurn('Lucía, coordina la revisión de seguridad del core', project([]), []))
      .toEqual({ kind: 'office-orchestration' });
  });

  it('a creation intent becomes a plan with no anchor', () => {
    const route = routeCopilotTurn('Crea un diagrama de integración entre WeeCompany PBM, SIMASEC y GMD', project([]), []);
    expect(route).toEqual({ kind: 'plan', anchor: null });
  });

  it('a modification that names one artifact is anchored to it', () => {
    const context = artifact('a1', 'Diagrama de Contexto');
    const route = routeCopilotTurn(
      'mejora el diagrama de contexto',
      project([context, artifact('b1', 'Mapa de Capacidades de Negocio')]),
      [],
    );
    expect(route).toEqual({ kind: 'plan', anchor: context });
  });

  it('a modification with several close candidates asks the person to pick', () => {
    const route = routeCopilotTurn(
      'mejora el diagrama de integración',
      project([artifact('a1', 'Diagrama de Integración A'), artifact('b1', 'Diagrama de Integración B')]),
      [],
    );
    expect(route.kind).toBe('disambiguate');
    expect(route.kind === 'disambiguate' && route.candidates.map((item) => item.id)).toEqual(
      expect.arrayContaining(['a1', 'b1']),
    );
  });

  it('a question with nothing to execute goes to the Office team', () => {
    expect(routeCopilotTurn('¿Qué riesgos ves en la integración con el broker?', project([]), []))
      .toEqual({ kind: 'consult' });
  });
});

describe('copilotAnchorFor', () => {
  it('is a synthetic anchor named after the project, never a real artifact', () => {
    const anchor = copilotAnchorFor({ name: 'Reclamos' });
    expect(anchor.id).toBe('copilot-anchor');
    expect(anchor.name).toBe('Reclamos');
    expect(anchor.content).toBe('');
  });
});
