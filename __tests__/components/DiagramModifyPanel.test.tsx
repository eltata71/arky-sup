/**
 * El panel «Modificar diagrama»: nada se escribe sin un clic, y el clic crea
 * una versión nueva con lo que el motor previsualizó.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Artifact } from '../../lib/artifacts';
import type { DiagramIR, DiagramPatch } from '../../lib/diagram';
import { applySemanticPatch } from '../../services/diagram';

const ai = vi.hoisted(() => ({ proposeEdit: vi.fn() }));
vi.mock('../../services/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  diagramEditService: { proposeEdit: ai.proposeEdit },
}));

const app = vi.hoisted(() => ({ restoreArtifactVersion: vi.fn(), addToast: vi.fn() }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ settings: { aiConfig: { model: 'm' } }, restoreArtifactVersion: app.restoreArtifactVersion, getProject: () => undefined }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: app.addToast }) }));

import { DiagramModifyPanel } from '../../components/artifacts/diagram/DiagramModifyPanel';

const ir: DiagramIR = {
  nodes: [
    { id: 'web', label: 'Web', kind: 'service', position: { x: 0, y: 0 } },
    { id: 'api', label: 'API', kind: 'service', position: { x: 200, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'web', target: 'api', label: 'llama' }],
  groups: [],
};

const artifact: Artifact = {
  id: 'a1',
  versionGroupId: 'a1',
  version: 1,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Diagrama',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'graph TD; web-->api',
  objective: '',
  keyConcepts: [],
  representation: 'diagram',
  ir,
};

const patch: DiagramPatch = {
  id: 'dp',
  source: 'ai',
  rationale: 'Renombrar la API',
  operations: [{ op: 'update-node', nodeId: 'api', changes: { label: 'API Gateway' } }],
};

// El cuerpo del panel es un chunk diferido: se precarga para que la espera de
// `findBy` mida el render y no la primera transformación del módulo.
beforeAll(async () => { await import('../../components/artifacts/diagram/DiagramModifyPanelBody'); }, 60_000);

const renderPanel = async (onVersionCreated = vi.fn(), onClose = vi.fn()) => {
  render(
    <DiagramModifyPanel isOpen onClose={onClose} projectId="p1" artifact={artifact} onVersionCreated={onVersionCreated} />,
  );
  await screen.findByLabelText('¿Qué quieres cambiar?');
  return { onVersionCreated, onClose };
};

beforeEach(() => {
  ai.proposeEdit.mockReset();
  app.restoreArtifactVersion.mockReset().mockImplementation((_p: string, v: Artifact) => ({ ...v, id: 'a1-v2' }));
  app.addToast.mockReset();
});

describe('DiagramModifyPanel', () => {
  it('muestra la vista previa del motor y no escribe nada antes del clic', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch, preview: applySemanticPatch(ir, patch) });
    await renderPanel();

    fireEvent.change(screen.getByLabelText('¿Qué quieres cambiar?'), { target: { value: 'renombra la API' } });
    fireEvent.click(screen.getByRole('button', { name: /Proponer cambio/ }));

    expect(await screen.findByText('Renombrar la API')).toBeInTheDocument();
    expect(screen.getByText(/Lo que hará \(1\)/)).toBeInTheDocument();
    expect(app.restoreArtifactVersion).not.toHaveBeenCalled();
  });

  it('aplicar crea una versión nueva y el lienzo pasa a mostrarla', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch, preview: applySemanticPatch(ir, patch) });
    const { onVersionCreated, onClose } = await renderPanel();

    fireEvent.change(screen.getByLabelText('¿Qué quieres cambiar?'), { target: { value: 'renombra la API' } });
    fireEvent.click(screen.getByRole('button', { name: /Proponer cambio/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar como versión nueva' }));

    expect(app.restoreArtifactVersion).toHaveBeenCalledTimes(1);
    const [, version] = app.restoreArtifactVersion.mock.calls[0];
    expect(version.ir.nodes.find((n: { id: string }) => n.id === 'api').label).toBe('API Gateway');
    expect(version.changeNote).toMatchObject({ basedOnVersion: 1, instruction: 'renombra la API' });
    expect(onVersionCreated).toHaveBeenCalledWith('a1-v2');
    expect(onClose).toHaveBeenCalled();
    expect(app.addToast).toHaveBeenCalledWith(expect.stringContaining('1 cambio'), 'success');
  });

  it('descartar olvida la propuesta sin escribir', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: true, patch, preview: applySemanticPatch(ir, patch) });
    await renderPanel();

    fireEvent.change(screen.getByLabelText('¿Qué quieres cambiar?'), { target: { value: 'renombra la API' } });
    fireEvent.click(screen.getByRole('button', { name: /Proponer cambio/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    await waitFor(() => expect(screen.queryByText('Renombrar la API')).not.toBeInTheDocument());
    expect(app.restoreArtifactVersion).not.toHaveBeenCalled();
  });

  it('un rechazo se explica y no ofrece aplicar', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: false, patch: null, preview: null, reason: 'El asistente no está disponible ahora.' });
    await renderPanel();

    fireEvent.change(screen.getByLabelText('¿Qué quieres cambiar?'), { target: { value: 'algo' } });
    fireEvent.click(screen.getByRole('button', { name: /Proponer cambio/ }));

    expect(await screen.findByText('El asistente no está disponible ahora.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aplicar como versión nueva' })).not.toBeInTheDocument();
  });

  it('sin instrucción no se puede proponer', async () => {
    await renderPanel();
    expect(screen.getByRole('button', { name: /Proponer cambio/ })).toBeDisabled();
  });
});

describe('DiagramModifyPanel cerrado', () => {
  it('no monta nada ni descarga el cuerpo', () => {
    const { container } = render(
      <DiagramModifyPanel isOpen={false} onClose={vi.fn()} projectId="p1" artifact={artifact} onVersionCreated={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
