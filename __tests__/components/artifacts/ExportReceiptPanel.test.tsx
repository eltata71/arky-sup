/**
 * La exportación dice lo que hizo (plan de clase mundial 9.4): el fichero se
 * genera, se ve su comienzo y su recibo —pérdidas primero—, el foco va al
 * título, se anuncia una vez, y la descarga es un clic posterior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Artifact, ExportedFile } from '../../../lib/artifacts';
import type { ExportFormatOption } from '../../../services/export/artifactExportValidation';

const announce = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useAriaAnnouncer', () => ({ useAriaAnnouncer: () => ({ announce }) }));

import { ExportReceiptPanel } from '../../../components/artifacts/export/ExportReceiptPanel';
import { ArtifactExportModal } from '../../../components/artifacts/export/ArtifactExportModal';

const file = (receipt?: ExportedFile['receipt']): ExportedFile => ({
  blob: new Blob(['x'.repeat(4096)]),
  filename: 'plan.pdf',
  mimeType: 'application/pdf',
  extension: 'pdf',
  format: 'pdf',
  receipt,
});

const RECEIPT_WITH_LOSS: NonNullable<ExportedFile['receipt']> = {
  pages: 3,
  tables: 2,
  diagrams: 1,
  losses: ['El diagrama 2 no se pudo dibujar en este navegador y se incluye como código Mermaid.'],
  preview: { kind: 'page', title: 'Plan de transición', subtitle: 'Ordenar la migración.', lines: ['Riesgos', 'Hitos'] },
};

describe('ExportReceiptPanel', () => {
  beforeEach(() => announce.mockReset());

  it('enseña el recibo, la primera página y cada pérdida antes del botón de descarga', () => {
    render(<ExportReceiptPanel file={file(RECEIPT_WITH_LOSS)} formatLabel="PDF" onDownload={() => {}} onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: 'PDF listo para descargar' })).toBeInTheDocument();
    expect(screen.getByText(/3 páginas, 2 tablas, 1 diagrama/)).toBeInTheDocument();
    const loss = screen.getByText(/El diagrama 2 no se pudo dibujar/);
    const download = screen.getByRole('button', { name: 'Descargar de todos modos' });
    // La pérdida está antes que el botón en el orden de lectura.
    expect(loss.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Así empieza el documento')).toBeInTheDocument();
    expect(screen.getByText('Plan de transición')).toBeInTheDocument();
    expect(screen.getByText('Hitos')).toBeInTheDocument();
  });

  it('lleva el foco al título y lo anuncia una sola vez', () => {
    const prepared = file(RECEIPT_WITH_LOSS);
    const { rerender } = render(<ExportReceiptPanel file={prepared} formatLabel="PDF" onDownload={() => {}} onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: 'PDF listo para descargar' })).toHaveFocus();
    rerender(<ExportReceiptPanel file={prepared} formatLabel="PDF" onDownload={() => {}} onBack={() => {}} downloading />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]?.[0]).toMatch(/^PDF listo: 3 páginas, 2 tablas, 1 diagrama\. 1 aviso de pérdida/);
  });

  it('sin pérdidas lo dice, y una diapositiva se previsualiza como diapositiva', () => {
    render(<ExportReceiptPanel
      file={file({ slides: 4, slidesWithNotes: 4, tables: 1, diagrams: 0, losses: [], preview: { kind: 'slide', title: 'Pago de siniestros', lines: ['Mensaje clave'] } })}
      formatLabel="PowerPoint"
      onDownload={() => {}}
      onBack={() => {}}
    />);
    expect(screen.getByText('El exportador no informó ninguna pérdida.')).toBeInTheDocument();
    expect(screen.getByText('Primera diapositiva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });

  it('un formato sin recibo sólo dice nombre y tamaño', () => {
    render(<ExportReceiptPanel file={file()} formatLabel="Markdown" onDownload={() => {}} onBack={() => {}} />);
    expect(screen.getByText('plan.pdf · 4 KB')).toBeInTheDocument();
    expect(screen.queryByText(/ninguna pérdida/)).not.toBeInTheDocument();
  });
});

const artifact: Artifact = {
  id: 'artifact-receipt', versionGroupId: 'vg', version: 1, createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Arquitectura de referencia', type: 'markdown', phase: 'Diseño', architecturalView: 'Vista SDD',
  content: '# Arquitectura\n\nContenido documental extenso y detallado, suficiente para una exportación profesional sin advertencias de longitud insuficiente para el lector ejecutivo y técnico.',
  objective: 'Publicar el entregable.', keyConcepts: [], representation: 'document',
};
const mdOption: ExportFormatOption = {
  format: 'md', extension: 'md', mimeType: 'text/markdown;charset=utf-8', label: 'Markdown (.md)',
  description: 'Contenido fuente preservado en UTF-8.', group: 'Documento', category: 'Documento', implemented: true, enabled: true,
};
const nextFrame = () => new Promise<void>((resolve) => { window.requestAnimationFrame(() => resolve()); });
const baseProps = { isOpen: true, artifact, activeView: 'document' as const, formatOptions: [mdOption], preflightReport: null };

describe('ArtifactExportModal — recibo antes de descargar', () => {
  beforeEach(() => announce.mockReset());

  it('genera, enseña el recibo y sólo descarga al pulsar; el modal no se cierra antes', async () => {
    const prepared = file(RECEIPT_WITH_LOSS);
    const onPrepareExport = vi.fn().mockResolvedValue(prepared);
    const onDownloadExport = vi.fn().mockResolvedValue(undefined);
    const onExportFormat = vi.fn();
    const onClose = vi.fn();
    render(<ArtifactExportModal {...baseProps} onClose={onClose} onExportFormat={onExportFormat} onPrepareExport={onPrepareExport} onDownloadExport={onDownloadExport} />);
    // El modal pone su foco inicial en el primer fotograma; una persona no pulsa antes.
    await nextFrame();

    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));
    const heading = await screen.findByRole('heading', { name: 'Markdown (.md) listo para descargar' });
    expect(heading).toHaveFocus();
    expect(onPrepareExport).toHaveBeenCalledWith('md', expect.anything());
    expect(onExportFormat).not.toHaveBeenCalled();
    expect(onDownloadExport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/El diagrama 2 no se pudo dibujar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Descargar de todos modos' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDownloadExport).toHaveBeenCalledWith(prepared);
  });

  it('«Volver a los formatos» descarta el fichero y regresa a la lista', async () => {
    const onPrepareExport = vi.fn().mockResolvedValue(file(RECEIPT_WITH_LOSS));
    render(<ArtifactExportModal {...baseProps} onClose={() => {}} onExportFormat={() => {}} onPrepareExport={onPrepareExport} onDownloadExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Volver a los formatos' }));
    expect(screen.getByRole('button', { name: /Exportar como Markdown/ })).toBeInTheDocument();
  });

  it('si no se pudo generar, el modal sigue en la lista (el motivo ya se avisó)', async () => {
    const onPrepareExport = vi.fn().mockResolvedValue(null);
    const onClose = vi.fn();
    render(<ArtifactExportModal {...baseProps} onClose={onClose} onExportFormat={() => {}} onPrepareExport={onPrepareExport} onDownloadExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Exportar como Markdown/ })).toBeEnabled());
    expect(screen.queryByText(/listo para descargar/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sin `onPrepareExport` exporta y se cierra como antes', () => {
    const onExportFormat = vi.fn();
    const onClose = vi.fn();
    render(<ArtifactExportModal {...baseProps} onClose={onClose} onExportFormat={onExportFormat} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar como Markdown/ }));
    expect(onExportFormat).toHaveBeenCalledWith('md', expect.anything());
    expect(onClose).toHaveBeenCalled();
  });
});
