import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ArtifactExportModal } from '../../../components/artifacts/export/ArtifactExportModal';
import type { ExportFormatOption } from '../../../services/export/artifactExportValidation';
import type { ArtifactPresentationModel } from '../../../lib/artifacts/artifactPresentationModel';
import type { Artifact } from '../../../types';

const artifact: Artifact = {
  id: 'artifact-modal-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Arquitectura de referencia',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  content: '# Arquitectura\n\nContenido documental extenso y detallado, suficiente para una exportación profesional sin advertencias de longitud insuficiente para el lector ejecutivo y técnico.',
  objective: 'Publicar el entregable arquitectónico de referencia.',
  keyConcepts: [],
  representation: 'document',
};

const mdOption: ExportFormatOption = {
  format: 'md',
  extension: 'md',
  mimeType: 'text/markdown;charset=utf-8',
  label: 'Markdown (.md)',
  description: 'Contenido fuente preservado en UTF-8.',
  group: 'Documento',
  category: 'Documento',
  implemented: true,
  enabled: true,
};

const presentationModel = (overrides: Partial<ArtifactPresentationModel> = {}): ArtifactPresentationModel => ({
  id: 'presentation-modal-1',
  artifactId: 'artifact-modal-1',
  artifactName: 'Arquitectura de referencia',
  artifactType: 'markdown',
  compilerVersion: '1.1.0',
  audience: 'mixed',
  mode: 'publication',
  title: 'Arquitectura de referencia',
  executiveSummary: 'Resumen ejecutivo del entregable.',
  purpose: 'Propósito del entregable.',
  scope: 'Alcance del entregable.',
  sections: [{ id: 's1', title: 'Contexto', level: 1, content: 'Contenido de contexto detallado.', type: 'body', order: 1 }],
  diagrams: [],
  tables: [],
  callouts: [],
  decisions: [],
  risks: [],
  assumptions: [],
  nextSteps: [],
  traceability: [],
  exportProfile: {
    recommendedFormats: ['md'],
    availableFormats: ['md', 'html', 'pdf', 'docx', 'txt', 'json'],
    blockedFormats: [],
    defaultFormat: 'md',
    canExportAsPublication: true,
    requiresUserReview: false,
  },
  quality: {
    score: 84,
    readyForPublication: true,
    blockers: [],
    warnings: [],
    recommendations: [],
    dimensions: { structure: 84, readability: 84, visualHierarchy: 80, traceability: 82, exportReadiness: 88, audienceAlignment: 84 },
  },
  theme: { name: 'audit', density: 'comfortable', colorMode: 'adaptive' },
  trace: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const baseProps = {
  isOpen: true,
  onClose: () => {},
  artifact,
  activeView: 'document' as const,
  formatOptions: [mdOption],
  preflightReport: null,
};

describe('ArtifactExportModal — versión publicación', () => {
  it('deshabilita los modos de publicación no aplicables', () => {
    render(<ArtifactExportModal {...baseProps} onExportFormat={() => {}} presentationModel={presentationModel()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Versión publicación/ }));

    expect(screen.getByRole('radio', { name: /Sólo diagrama/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Sólo tabla\/matriz/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Documento \+ diagrama/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Publicación completa/ })).toBeEnabled();
  });

  it('solicita confirmación al exportar una publicación con advertencias', () => {
    const onExportFormat = vi.fn();
    const model = presentationModel({
      quality: { ...presentationModel().quality, warnings: ['Falta trazabilidad explícita.'] },
    });
    render(<ArtifactExportModal {...baseProps} onExportFormat={onExportFormat} presentationModel={model} />);
    fireEvent.click(screen.getByRole('radio', { name: /Versión publicación/ }));
    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onExportFormat).not.toHaveBeenCalled();
  });

  it('exporta la versión publicación tras confirmar las advertencias', () => {
    const onExportFormat = vi.fn();
    const model = presentationModel({
      quality: { ...presentationModel().quality, warnings: ['Falta trazabilidad explícita.'] },
    });
    render(<ArtifactExportModal {...baseProps} onExportFormat={onExportFormat} presentationModel={model} />);
    fireEvent.click(screen.getByRole('radio', { name: /Versión publicación/ }));
    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));
    fireEvent.click(screen.getByRole('button', { name: /Exportar de todos modos/ }));

    expect(onExportFormat).toHaveBeenCalledTimes(1);
    const [, options] = onExportFormat.mock.calls[0];
    expect(options).toMatchObject({ exportAsPublication: true, publicationMode: 'publication', qualityOverride: true });
  });

  it('exporta el contenido original sin metadata de publicación', () => {
    const onExportFormat = vi.fn();
    render(<ArtifactExportModal {...baseProps} onExportFormat={onExportFormat} presentationModel={presentationModel()} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));

    expect(onExportFormat).toHaveBeenCalledTimes(1);
    const [format, options] = onExportFormat.mock.calls[0];
    expect(format).toBe('md');
    expect(options?.exportAsPublication).toBeUndefined();
  });
});

describe('ArtifactExportModal — configuración de imagen', () => {
  const pngOption: ExportFormatOption = {
    format: 'png',
    extension: 'png',
    mimeType: 'image/png',
    label: 'PNG (.png)',
    description: 'Imagen del diagrama capturado.',
    group: 'Diagrama',
    category: 'Diagrama',
    implemented: true,
    enabled: true,
  };
  const svgOption: ExportFormatOption = {
    format: 'svg',
    extension: 'svg',
    mimeType: 'image/svg+xml',
    label: 'SVG (.svg)',
    description: 'Imagen vectorial escalable.',
    group: 'Diagrama',
    category: 'Diagrama',
    implemented: true,
    enabled: true,
  };

  const diagramArtifact: Artifact = {
    id: 'artifact-diagram-1',
    versionGroupId: 'vg-diagram-1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    name: 'Diagrama de referencia',
    type: 'reactflow' as Artifact['type'],
    phase: 'Diseño',
    architecturalView: 'Vista SDD' as Artifact['architecturalView'],
    content: JSON.stringify({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { label: 'API' }, type: 'custom' },
        { id: 'b', position: { x: 200, y: 0 }, data: { label: 'DB' }, type: 'custom' },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', label: 'lee' }],
    }),
    objective: 'Diagrama de referencia para tests.',
    keyConcepts: [],
    representation: 'diagram',
    ir: {
      nodes: [
        { id: 'a', label: 'API', kind: 'service' },
        { id: 'b', label: 'DB', kind: 'data' },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', label: 'lee' }],
      groups: [],
    },
  };

  const diagramProps = {
    isOpen: true,
    onClose: () => {},
    artifact: diagramArtifact,
    activeView: 'diagram' as const,
    formatOptions: [mdOption],
    preflightReport: null,
  };

  beforeEach(() => {
    cleanup();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  it('no renderiza la sección cuando no hay formatos PNG/SVG ofrecidos', () => {
    render(<ArtifactExportModal {...baseProps} onExportFormat={() => {}} />);
    expect(screen.queryByTestId('image-export-configuration')).not.toBeInTheDocument();
  });

  it('renderiza la sección cuando se ofrece PNG', () => {
    render(
      <ArtifactExportModal
        {...baseProps}
        formatOptions={[mdOption, pngOption]}
        onExportFormat={() => {}}
      />,
    );
    expect(screen.getByTestId('image-export-configuration')).toBeInTheDocument();
    // The five views must be navigable as a radio group.
    expect(screen.getByTestId('image-export-view-useful')).toBeInTheDocument();
    expect(screen.getByTestId('image-export-view-current')).toBeInTheDocument();
    expect(screen.getByTestId('image-export-view-executive')).toBeInTheDocument();
    expect(screen.getByTestId('image-export-view-technical')).toBeInTheDocument();
    expect(screen.getByTestId('image-export-view-full')).toBeInTheDocument();
  });

  it('propaga la vista y la escala al exportar PNG', () => {
    const onExportFormat = vi.fn();
    render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[pngOption]}
        onExportFormat={onExportFormat}
      />,
    );

    fireEvent.click(screen.getByTestId('image-export-view-executive'));
    fireEvent.click(screen.getByTestId('image-export-scale-3'));
    fireEvent.click(screen.getByRole('button', { name: /Exportar como PNG/ }));

    expect(onExportFormat).toHaveBeenCalledTimes(1);
    const [format, options] = onExportFormat.mock.calls[0];
    expect(format).toBe('png');
    expect(options?.imageExportView).toBe('executive');
    expect(options?.imageExportScale).toBe(3);
    expect(options?.imageExportFrame).toBe(true);
    expect(options?.imageExportLegend).toBe(true);
  });

  it('deshabilita la escala y muestra una explicación accesible para SVG', () => {
    render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[svgOption]}
        onExportFormat={() => {}}
      />,
    );
    expect(screen.queryByTestId('image-export-scale-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-export-scale-na')).toHaveTextContent(/vectorial/i);
  });

  it('no envía escala al exportar SVG aunque haya una preferencia previa', () => {
    const onExportFormat = vi.fn();
    render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[svgOption]}
        onExportFormat={onExportFormat}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Exportar como SVG/ }));
    const [format, options] = onExportFormat.mock.calls[0];
    expect(format).toBe('svg');
    expect(options?.imageExportScale).toBeUndefined();
    expect(options?.imageExportView).toBe('useful');
  });

  it('permite Vista actual como snapshot operativo sin pasar por la confirmación', () => {
    const onExportFormat = vi.fn();
    render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[pngOption]}
        onExportFormat={onExportFormat}
      />,
    );
    fireEvent.click(screen.getByTestId('image-export-view-current'));
    fireEvent.click(screen.getByRole('button', { name: /Exportar como PNG/ }));
    expect(onExportFormat).toHaveBeenCalledTimes(1);
    const [, options] = onExportFormat.mock.calls[0];
    expect(options?.imageExportView).toBe('current');
    expect(options?.qualityOverride).toBeUndefined();
  });

  it('permite desactivar el frame profesional y la leyenda', () => {
    const onExportFormat = vi.fn();
    render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[pngOption]}
        onExportFormat={onExportFormat}
      />,
    );
    // Toggle frame off (legend toggle should then be disabled).
    fireEvent.click(screen.getByTestId('image-export-frame-toggle'));
    expect(screen.getByTestId('image-export-legend-toggle')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Exportar como PNG/ }));
    const [, options] = onExportFormat.mock.calls[0];
    expect(options?.imageExportFrame).toBe(false);
  });

  it('persiste la preferencia de vista entre montajes (localStorage)', () => {
    const onExportFormat = vi.fn();
    const { unmount } = render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[pngOption]}
        onExportFormat={onExportFormat}
      />,
    );
    fireEvent.click(screen.getByTestId('image-export-view-technical'));
    unmount();

    render(
      <ArtifactExportModal
        {...diagramProps}
        formatOptions={[pngOption]}
        onExportFormat={() => {}}
      />,
    );
    expect((screen.getByTestId('image-export-view-technical') as HTMLInputElement).checked).toBe(true);
  });
});
