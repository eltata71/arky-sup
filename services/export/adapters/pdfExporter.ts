import type { ExportAdapter } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile } from './shared';

/**
 * El adaptador PDF. Está en el arranque —`services/export` lo carga el
 * registro—, así que no contiene el PDF: lo carga con `import()` al exportar.
 *
 * - Un diagrama desde el lienzo se dibuja en vectores (`diagramPdf`, plan de
 *   diagramas 2.4).
 * - Un documento se escribe con fuentes incrustadas, sus diagramas como
 *   imagen, marcadores, metadatos y estructura etiquetada
 *   (`pdf/documentPdf`, plan de clase mundial 9.3). Lo que no pudo
 *   representar viaja en los detalles técnicos del fichero, nunca como «?».
 */
export const pdfExporter: ExportAdapter = {
  format: 'pdf',
  async export(context) {
    if (context.diagramSnapshot?.nodes.length) return (await import('./diagramPdf')).exportDiagramPdf(context);
    const { buildPdfDocument } = await import('./pdf/documentPdf');
    const result = await buildPdfDocument(context);
    const blob = new Blob([result.bytes as BlobPart], { type: EXPORT_DEFINITIONS.pdf.mimeType });
    const details = 'PDF con fuentes incrustadas (texto seleccionable y buscable), marcadores, metadatos, estructura etiquetada y diagramas como imagen.';
    return buildFile(context, 'pdf', blob, result.warnings.length ? `${details} ${result.warnings.join(' ')}` : details, result.receipt);
  },
};
