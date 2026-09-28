/**
 * La marca de la organización viaja del proyecto al marco de la imagen
 * exportada (plan de diagramas, 2.3), y un color rechazado se avisa.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Artifact } from '../../lib/artifacts';
import type { PublicationPackage } from '../../services/publicationPipeline';
import type { Settings } from '../../types';
import { useArtifactExportActions } from '../../hooks/artifacts/useArtifactExportActions';

const artifact: Artifact = {
  id: 'a1',
  versionGroupId: 'a1',
  version: 1,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Contexto',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'graph TD\n  A[Web] --> B[API]',
  objective: 'Mostrar el contexto',
  keyConcepts: [],
  representation: 'diagram',
  ir: {
    nodes: [{ id: 'A', label: 'Web', kind: 'service' }, { id: 'B', label: 'API', kind: 'service' }],
    edges: [{ id: 'e1', source: 'A', target: 'B', label: 'llama' }],
    groups: [],
  },
};

const pkg = (accentColor: string): PublicationPackage => ({
  artifactRefs: [{ artifactId: 'a1', versionGroupId: 'a1', version: 1, name: 'Contexto', type: 'mermaid-graph' }],
  branding: { organizationName: 'Seguros Andinos', productName: 'Arky', confidentiality: 'Uso interno', accentColor, footerText: 'x' },
  updatedAt: '2026-09-28',
} as unknown as PublicationPackage);

const setup = (packages?: PublicationPackage[]) => {
  const exportImage = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
  const addToast = vi.fn();
  const { result } = renderHook(() => useArtifactExportActions({
    artifact,
    activeView: 'diagram',
    settings: {} as Settings,
    preflightReport: null,
    reactFlowRef: { current: { exportImage } } as never,
    addToast,
    publicationPackages: packages,
  }));
  return { result, exportImage, addToast };
};

describe('useArtifactExportActions — marca', () => {
  it('pasa al lienzo la organización, la clasificación y el color', async () => {
    const { result, exportImage } = setup([pkg('#1d4ed8')]);
    await act(() => result.current.exportFormat('png'));
    expect(exportImage).toHaveBeenCalledWith('png', expect.objectContaining({
      branding: { owner: 'Seguros Andinos', confidentiality: 'Uso interno', accentColor: '#1d4ed8' },
    }));
  });

  it('sin marca configurada, la llamada es la de siempre', async () => {
    const { result, exportImage } = setup(undefined);
    await act(() => result.current.exportFormat('png'));
    expect(exportImage.mock.calls[0][1]).not.toHaveProperty('branding');
  });

  it('un color sin contraste se exporta sin franja y se avisa por qué', async () => {
    const { result, exportImage, addToast } = setup([pkg('#fafafa')]);
    await act(() => result.current.exportFormat('png'));
    expect(exportImage.mock.calls[0][1].branding.accentColor).toBeUndefined();
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('no se distingue del fondo'), 'warning');
  });
});
