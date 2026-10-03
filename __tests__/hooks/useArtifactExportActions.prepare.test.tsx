/**
 * Preparar no es descargar (plan de clase mundial 9.4): `prepareExport` genera
 * el fichero y lo devuelve con su recibo; sólo `downloadExport` lo descarga.
 * `exportFormat` sigue haciendo las dos cosas, para quien no pasa por el modal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Artifact, ExportedFile } from '../../lib/artifacts';
import type { Settings } from '../../types';

const mocks = vi.hoisted(() => ({ exportArtifact: vi.fn(), downloadFile: vi.fn() }));
vi.mock('../../services/export/exportService', async (importOriginal) => ({ ...(await importOriginal<object>()), exportArtifact: mocks.exportArtifact }));
vi.mock('../../services/export/downloadService', () => ({ downloadFile: mocks.downloadFile }));

import { useArtifactExportActions } from '../../hooks/artifacts/useArtifactExportActions';

const artifact: Artifact = {
  id: 'a1', versionGroupId: 'a1', version: 1, createdAt: '2026-10-03T00:00:00.000Z',
  name: 'Plan', type: 'markdown', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
  content: '# Plan\n\nContenido suficiente para exportar el documento sin advertencias de longitud.', objective: 'x',
  keyConcepts: [], representation: 'document',
};

const FILE: ExportedFile = {
  blob: new Blob(['%PDF']), filename: 'plan.pdf', mimeType: 'application/pdf', extension: 'pdf', format: 'pdf',
  receipt: { pages: 2, tables: 0, diagrams: 0, losses: [] },
};

const setup = () => {
  const addToast = vi.fn();
  const { result } = renderHook(() => useArtifactExportActions({
    artifact, activeView: 'document', settings: {} as Settings, preflightReport: null,
    reactFlowRef: { current: null }, addToast,
  }));
  return { result, addToast };
};

describe('useArtifactExportActions — preparar y descargar', () => {
  beforeEach(() => {
    mocks.exportArtifact.mockReset().mockResolvedValue({ file: FILE, trace: {} });
    mocks.downloadFile.mockReset().mockResolvedValue({ filename: 'plan.pdf', size: 2048 });
  });

  it('prepareExport devuelve el fichero con su recibo y no descarga', async () => {
    const { result } = setup();
    let file: ExportedFile | null = null;
    await act(async () => { file = await result.current.prepareExport('pdf'); });
    expect(file).toBe(FILE);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('downloadExport descarga el fichero preparado y lo confirma', async () => {
    const { result, addToast } = setup();
    await act(() => result.current.downloadExport(FILE));
    expect(mocks.downloadFile).toHaveBeenCalledWith(FILE);
    expect(addToast).toHaveBeenCalledWith('Archivo descargado: plan.pdf (2 KB)', 'success');
  });

  it('un fallo al generar se avisa y devuelve null', async () => {
    mocks.exportArtifact.mockRejectedValue(new Error('No hay contenido para PDF.'));
    const { result, addToast } = setup();
    let file: ExportedFile | null = FILE;
    await act(async () => { file = await result.current.prepareExport('pdf'); });
    expect(file).toBeNull();
    expect(addToast).toHaveBeenCalledWith('No hay contenido para PDF.', 'error');
  });

  it('exportFormat prepara y descarga en un paso, y el modal recibe los tres manejadores', async () => {
    const { result } = setup();
    await act(() => result.current.exportFormat('pdf'));
    expect(mocks.downloadFile).toHaveBeenCalledWith(FILE);
    expect(Object.keys(result.current.modalHandlers).sort()).toEqual(['onDownloadExport', 'onExportFormat', 'onPrepareExport']);
  });
});
