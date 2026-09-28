/**
 * El panel «Editar historia» (plan de diagramas, 4.3): los gestos se acumulan
 * en un borrador, ordenar se hace con botones (teclado), y nada se guarda hasta
 * pulsar Guardar, que crea una versión con la historia escrita.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Artifact } from '../../lib/artifacts';

const app = vi.hoisted(() => ({ restoreArtifactVersion: vi.fn(), addToast: vi.fn() }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ restoreArtifactVersion: app.restoreArtifactVersion }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: app.addToast }) }));

import { DiagramStoryEditorPanel } from '../../components/artifacts/diagram/DiagramStoryEditorPanel';

const artifact: Artifact = {
  id: 'a1',
  versionGroupId: 'a1',
  version: 1,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Flujo',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'graph TD; web-->api',
  objective: '',
  keyConcepts: [],
  representation: 'diagram',
  ir: {
    nodes: [
      { id: 'web', label: 'Web', kind: 'service' },
      { id: 'api', label: 'API', kind: 'service' },
    ],
    edges: [{ id: 'e1', source: 'web', target: 'api', label: 'llama' }],
    groups: [],
    metadata: { narrative: { summary: 'Dos nodos.', source: 'derived' } },
  },
};

describe('DiagramStoryEditorPanel', () => {
  beforeAll(async () => {
    await import('../../components/artifacts/diagram/DiagramStoryEditorPanelBody');
  }, 60_000);

  beforeEach(() => {
    app.restoreArtifactVersion.mockReset().mockImplementation((_p: string, draft: Artifact) => ({ ...draft, id: 'a2' }));
    app.addToast.mockReset();
  });

  it('escribe dos escenas, las reordena y guarda una historia escrita', async () => {
    const onVersionCreated = vi.fn();
    render(<DiagramStoryEditorPanel isOpen onClose={() => undefined} projectId="p1" artifact={artifact} onVersionCreated={onVersionCreated} />);

    expect(await screen.findByText('Historia derivada')).toBeInTheDocument();
    const title = screen.getByLabelText('Título de la nueva escena');
    fireEvent.change(title, { target: { value: 'La entrada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    fireEvent.change(title, { target: { value: 'La API' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(screen.getByText('Historia escrita')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Subir la escena 2' }));
    expect((screen.getByLabelText('Título de la escena 1') as HTMLInputElement).value).toBe('La API');
    expect(app.restoreArtifactVersion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar como versión nueva' }));
    const draft = app.restoreArtifactVersion.mock.calls[0][1] as Artifact;
    const narrative = draft.ir?.metadata?.narrative;
    expect(narrative).toMatchObject({ source: 'authored', scenes: [{ title: 'La API' }, { title: 'La entrada' }] });
    expect(onVersionCreated).toHaveBeenCalledWith('a2');
  });

  it('descartar vuelve a la historia guardada sin escribir nada', async () => {
    render(<DiagramStoryEditorPanel isOpen onClose={() => undefined} projectId="p1" artifact={artifact} onVersionCreated={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Título de la nueva escena'), { target: { value: 'Una' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByText('Historia derivada')).toBeInTheDocument();
    expect(app.restoreArtifactVersion).not.toHaveBeenCalled();
  });
});
