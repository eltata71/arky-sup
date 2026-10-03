/**
 * El recibo de una exportación, en palabras (plan de clase mundial 9.4).
 *
 * «12 tablas, 3 diagramas, 14 diapositivas con notas» es lo que permite a
 * quien exporta saber, antes de la reunión, si el fichero lleva lo que
 * esperaba. La frase sale del recibo que escribió el exportador
 * (`ExportReceipt`); esto sólo la redacta.
 */
import type { ExportReceipt } from './exportContracts';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Lo que contiene el fichero, en una frase: «3 páginas, 2 tablas, 1 diagrama». */
export function describeExportReceipt(receipt: ExportReceipt): string {
  const parts: string[] = [];
  if (receipt.pages !== undefined) parts.push(plural(receipt.pages, 'página', 'páginas'));
  if (receipt.slides !== undefined) {
    const notes = receipt.slidesWithNotes ?? 0;
    parts.push(plural(receipt.slides, 'diapositiva', 'diapositivas'));
    if (notes > 0) parts.push(`${notes === receipt.slides ? 'todas' : notes} con notas del orador`);
  }
  parts.push(plural(receipt.tables, 'tabla', 'tablas'));
  parts.push(plural(receipt.diagrams, 'diagrama', 'diagramas'));
  return parts.join(', ');
}

/** La frase que se anuncia al lector de pantalla cuando el fichero está listo. */
export function announceExportReceipt(formatLabel: string, receipt: ExportReceipt | undefined): string {
  if (!receipt) return `${formatLabel} listo para descargar.`;
  const losses = receipt.losses.length;
  const tail = losses === 0
    ? 'Sin pérdidas.'
    : `${plural(losses, 'aviso', 'avisos')} de pérdida: revísalos antes de descargar.`;
  return `${formatLabel} listo: ${describeExportReceipt(receipt)}. ${tail}`;
}
