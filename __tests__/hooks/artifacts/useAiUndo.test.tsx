import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Artifact } from '../../../lib/artifacts';
import { aiUndoStore } from '../../../services/artifacts/application/aiUndo';

const addToast = vi.fn();
const announce = vi.fn();
const restoreArtifactVersion = vi.fn((_projectId: string, draft: Artifact) => ({ ...draft, id: `${draft.id}-r`, version: 3 }));

const artifact = (id: string, version: number): Artifact =>
  ({ id, version, versionGroupId: 'g1', name: 'A', content: `v${version}` }) as unknown as Artifact;

const projects = [{ id: 'p1', artifacts: [artifact('a1', 1), artifact('a2', 2)] }];

vi.mock('../../../context/AppContext', () => ({
  useAppContext: () => ({ projects, restoreArtifactVersion }),
}));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../../hooks/useAriaAnnouncer', () => ({ useAriaAnnouncer: () => ({ announce }) }));

import { useAiUndo, useAiUndoShortcut } from '../../../hooks/artifacts/useAiUndo';

describe('useAiUndo', () => {
  afterEach(() => { aiUndoStore.clear(); vi.clearAllMocks(); });

  it('ofrece deshacer con un toast y restaura la versión anterior', () => {
    const onUndone = vi.fn();
    const { result } = renderHook(() => useAiUndo());
    act(() => {
      result.current.offerUndo({ projectId: 'p1', label: 'prueba', steps: [{ before: artifact('a1', 1), producedId: 'a2' }], onUndone }, 'Hecho');
    });
    expect(result.current.canUndo).toBe(true);
    const options = addToast.mock.calls[0][2] as { action: { onClick: () => void } };
    act(() => options.action.onClick());
    expect(restoreArtifactVersion).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a1' }));
    expect(onUndone).toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
  });

  it('el atajo Mod+Alt+Z deshace lo último', () => {
    const { result } = renderHook(() => { useAiUndoShortcut(); return useAiUndo(); });
    act(() => {
      result.current.offerUndo({ projectId: 'p1', label: 'x', steps: [{ before: artifact('a1', 1), producedId: 'a2' }] }, 'Hecho');
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, altKey: true }));
    });
    expect(restoreArtifactVersion).toHaveBeenCalledTimes(1);
  });

  it('avisa y no restaura si hubo cambios posteriores', () => {
    const { result } = renderHook(() => useAiUndo());
    act(() => {
      result.current.offerUndo({ projectId: 'p1', label: 'x', steps: [{ before: artifact('a0', 0), producedId: 'a1' }] }, 'Hecho');
    });
    act(() => { result.current.undoLast(); });
    expect(restoreArtifactVersion).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenLastCalledWith(expect.stringContaining('cambios posteriores'), 'warning');
  });
  it('cambio sobre la versión actual (asistente update-current): restaura su contenido previo', () => {
    const { result } = renderHook(() => useAiUndo());
    const before = { ...artifact('a2', 2), content: 'antes' } as Artifact;
    act(() => {
      result.current.offerUndo({ projectId: 'p1', label: 'cambio del asistente', steps: [{ before, producedId: 'a2' }] }, 'El asistente modificó el artefacto.');
    });
    act(() => { result.current.undoLast(); });
    expect(restoreArtifactVersion).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a2', content: 'antes' }));
    expect(announce).toHaveBeenCalled();
  });

  it('versión nueva (asistente, agente y copiloto): offerVersionUndo restaura la anterior y avisa', () => {
    const onUndone = vi.fn();
    const { result } = renderHook(() => useAiUndo());
    act(() => {
      result.current.offerVersionUndo(artifact('a1', 1), { id: 'a2' }, 'acción del agente', 'El agente creó una versión nueva.', onUndone);
    });
    expect(addToast).toHaveBeenCalledWith('El agente creó una versión nueva.', expect.anything(), expect.anything());
    act(() => { result.current.undoLast(); });
    expect(restoreArtifactVersion).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a1' }));
    expect(onUndone).toHaveBeenCalled();
  });
});
