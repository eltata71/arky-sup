import { describe, expect, it } from 'vitest';
import { announceExportReceipt, describeExportReceipt, type ExportReceipt } from '../../../lib/artifacts';

const receipt = (overrides: Partial<ExportReceipt> = {}): ExportReceipt => ({ tables: 0, diagrams: 0, losses: [], ...overrides });

describe('describeExportReceipt', () => {
  it('un documento: páginas, tablas y diagramas, con singular y plural', () => {
    expect(describeExportReceipt(receipt({ pages: 3, tables: 12, diagrams: 1 }))).toBe('3 páginas, 12 tablas, 1 diagrama');
    expect(describeExportReceipt(receipt({ pages: 1, tables: 1, diagrams: 0 }))).toBe('1 página, 1 tabla, 0 diagramas');
  });

  it('un deck: diapositivas y cuántas llevan notas', () => {
    expect(describeExportReceipt(receipt({ slides: 14, slidesWithNotes: 14, tables: 2, diagrams: 3 })))
      .toBe('14 diapositivas, todas con notas del orador, 2 tablas, 3 diagramas');
    expect(describeExportReceipt(receipt({ slides: 14, slidesWithNotes: 5, tables: 0, diagrams: 0 })))
      .toBe('14 diapositivas, 5 con notas del orador, 0 tablas, 0 diagramas');
    expect(describeExportReceipt(receipt({ slides: 3, slidesWithNotes: 0 }))).toBe('3 diapositivas, 0 tablas, 0 diagramas');
  });
});

describe('announceExportReceipt', () => {
  it('sin pérdidas lo dice', () => {
    expect(announceExportReceipt('PDF', receipt({ pages: 2 }))).toBe('PDF listo: 2 páginas, 0 tablas, 0 diagramas. Sin pérdidas.');
  });

  it('con pérdidas pide revisarlas antes de descargar', () => {
    expect(announceExportReceipt('PDF', receipt({ pages: 2, losses: ['a', 'b'] }))).toMatch(/2 avisos de pérdida: revísalos antes de descargar\.$/);
  });

  it('un formato sin recibo sólo dice que está listo', () => {
    expect(announceExportReceipt('Markdown', undefined)).toBe('Markdown listo para descargar.');
  });
});
