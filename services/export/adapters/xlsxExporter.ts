import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { createStoredZip } from '../utils/zip';
import { escapeHtml } from '../utils/text';
import { artifactTables, buildFile, buildMetadata, publicationTables, shouldExportPublication } from './shared';

const cellRef = (column: number, row: number): string => {
  let n = column + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row}`;
};
const xCell = (value: string, column: number, row: number): string => `<c r="${cellRef(column, row)}" t="inlineStr"><is><t xml:space="preserve">${escapeHtml(value)}</t></is></c>`;
const sheetData = (rows: string[][]): string => rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => xCell(value, c, r + 1)).join('')}</row>`).join('');

export function buildXlsxBlob(context: ExportContext): Blob {
  const table = (shouldExportPublication(context) ? publicationTables(context) : artifactTables(context.artifact))[0];
  if (!table) throw new Error('No se detectó tabla Markdown para exportar XLSX.');
  const rows = [table.headers, ...table.rows];
  const metadata = buildMetadata(context);
  const zip = createStoredZip([
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { path: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Matriz" sheetId="1" r:id="rId1"/><sheet name="Metadatos" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { path: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>` },
    { path: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData(rows)}</sheetData></worksheet>` },
    { path: 'xl/worksheets/sheet2.xml', content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData([['Campo', 'Valor'], ...metadata])}</sheetData></worksheet>` },
  ]);
  return new Blob([zip], { type: EXPORT_DEFINITIONS.xlsx.mimeType });
}

export const xlsxExporter: ExportAdapter = {
  format: 'xlsx',
  async export(context) {
    return buildFile(context, 'xlsx', buildXlsxBlob(context), 'XLSX OOXML generado como ZIP con worksheets XML.');
  },
};
