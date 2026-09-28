/**
 * El panel «Niveles C4» (plan de diagramas, 4.1): el selector sólo ofrece
 * diagramas del proyecto, elegir uno crea una versión nueva, un enlace roto se
 * dice, y abrir el detalle abre la última versión.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Artifact } from '../../lib/artifacts';
import type { DiagramIR } from '../../lib/diagram';

const app = vi.hoisted(() => ({ restoreArtifactVersion: vi.fn(), addToast: vi.fn() }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ restoreArtifactVersion: app.restoreArtifactVersion }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: app.addToast }) }));

import { DiagramDetailLinksPanel } from '../../components/artifacts/diagram/DiagramDetailLinksPanel';

const ir = (detail?: string): DiagramIR => ({
  nodes: [
    { id: 'cliente', label: 'Cliente', kind: 'person' },
    { id: 'core', label: 'Core de pólizas', kind: 'system', ...(detail ? { detailArtifactGroupId: detail } : {}) },
  ],
  edges: [{ id: 'e1', source: 'cliente', target: 'core', label: 'usa' }],
  groups: [],
});

const base: Artifact = {
  id: 'ctx-v1',
  versionGroupId: 'ctx',
  version: 1,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Contexto',
  type: 'mermaid-c4-context',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'C4Context',
  objective: '',
  keyConcepts: [],
  representation: 'diagram',
  ir: ir(),
};

const containers: Artifact = { ...base, id: 'cont-v2', versionGroupId: 'cont', version: 2, name: 'Contenedores', type: 'mermaid-c4-container', ir: undefined };

const renderPanel = (artifact: Artifact, handlers = { onVersionCreated: vi.fn(), onOpenArtifact: vi.fn() }) => {
  render(
    <DiagramDetailLinksPanel
      isOpen
      onClose={() => undefined}
      projectId="p1"
      artifact={artifact}
      projectArtifacts={[artifact, containers]}
      {...handlers}
    />,
  );
  return handlers;
};

describe('DiagramDetailLinksPanel', () => {
  // El cuerpo es diferido: se descarga una vez antes para que las pruebas midan el panel, no la importación.
  beforeAll(async () => {
    await import('../../components/artifacts/diagram/DiagramDetailLinksPanelBody');
  }, 60_000);

  beforeEach(() => {
    app.restoreArtifactVersion.mockReset().mockImplementation((_p: string, draft: Artifact) => ({ ...draft, id: 'ctx-v2' }));
    app.addToast.mockReset();
  });

  it('cerrado no monta nada', () => {
    const { container } = render(
      <DiagramDetailLinksPanel isOpen={false} onClose={() => undefined} projectId="p1" artifact={base} projectArtifacts={[]} onVersionCreated={vi.fn()} onOpenArtifact={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('enlazar un nodo crea una versión nueva con el enlace', async () => {
    const handlers = renderPanel(base);
    const select = await screen.findByLabelText('Core de pólizas');
    expect(screen.getAllByRole('option', { name: /Contenedores — C4 · Contenedores \(nivel siguiente\)/ })).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'cont' } });
    expect(app.restoreArtifactVersion).toHaveBeenCalledTimes(1);
    const draft = app.restoreArtifactVersion.mock.calls[0][1] as Artifact;
    expect(draft.ir?.nodes.find((n) => n.id === 'core')?.detailArtifactGroupId).toBe('cont');
    expect(handlers.onVersionCreated).toHaveBeenCalledWith('ctx-v2');
  });

  it('abre el detalle enlazado y avisa de un enlace roto', async () => {
    const linked = renderPanel({ ...base, ir: ir('cont') });
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir «Contenedores», el detalle de Core de pólizas' }));
    expect(linked.onOpenArtifact).toHaveBeenCalledWith('cont-v2');
  });

  it('un enlace roto se muestra y se conserva', async () => {
    renderPanel({ ...base, ir: ir('borrado') });
    expect(await screen.findByText('1 enlace roto')).toBeInTheDocument();
    expect((screen.getByLabelText('Core de pólizas') as HTMLSelectElement).value).toBe('borrado');
    expect(app.restoreArtifactVersion).not.toHaveBeenCalled();
  });
});
