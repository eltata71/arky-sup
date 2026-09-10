import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { createStoredZip } from '../utils/zip';
import { escapeHtml, stripMarkdown } from '../utils/text';
import { buildFile, artifactTables, buildMetadata, publicationMarkdown, shouldExportPublication } from './shared';
import { buildArtifactQualityReport } from '../../quality/artifactQualityService';
import { renderQualityReportMarkdown } from '../../quality/qualityReportRenderer';

const wText = (text: string): string => `<w:r><w:t xml:space="preserve">${escapeHtml(text)}</w:t></w:r>`;
const paragraph = (text: string, style?: string): string => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${wText(text)}</w:p>`;
const cell = (text: string): string => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
const tableXml = (headers: string[], rows: string[][]): string => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tr>${headers.map(cell).join('')}</w:tr>${rows.map((row) => `<w:tr>${headers.map((_, i) => cell(row[i] ?? '')).join('')}</w:tr>`).join('')}</w:tbl>`;

const markdownToWordXml = (content: string): string => {
  const lines = content.split(/\r?\n/);
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}:?/.test(lines[index + 1] ?? '')) {
      const headers = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cellText) => cellText.trim());
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        const row = (lines[index] ?? '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cellText) => cellText.trim());
        if (row.length === headers.length) rows.push(row);
        index += 1;
      }
      blocks.push(tableXml(headers, rows));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) blocks.push(paragraph(heading[2] ?? '', heading[1]?.length === 1 ? 'Heading1' : heading[1]?.length === 2 ? 'Heading2' : 'Heading3'));
    else if (/^\s*[-*+]\s+/.test(line)) blocks.push(paragraph(`• ${line.replace(/^\s*[-*+]\s+/, '')}`));
    else if (line.trim()) blocks.push(paragraph(line.replace(/[*_`]/g, '')));
    else blocks.push(paragraph(''));
    index += 1;
  }
  return blocks.join('');
};

export function buildDocxBlob(context: ExportContext): Blob {
  const metadata = buildMetadata(context);
  const isPublication = shouldExportPublication(context);
  // Publication markdown already embeds its tables exactly once; the legacy
  // appendix is kept only for the original export to avoid duplication.
  const tables = isPublication ? [] : artifactTables(context.artifact);
  const qualityReportMarkdown = context.includeQualityReport
    ? renderQualityReportMarkdown(buildArtifactQualityReport(context.artifact))
    : '';
  const exportContent = isPublication ? publicationMarkdown(context) : context.artifact.content;
  const documentBody = [
    paragraph(context.presentationModel?.title || context.artifact.name, 'Title'),
    paragraph(context.presentationModel?.purpose || context.artifact.objective || 'Documento arquitectónico generado por Arky Pro.'),
    paragraph('Metadatos', 'Heading1'),
    tableXml(['Campo', 'Valor'], metadata),
    paragraph('Contenido', 'Heading1'),
    markdownToWordXml(exportContent),
    ...tables.flatMap((table) => [paragraph(table.title, 'Heading2'), tableXml(table.headers, table.rows)]),
    ...(qualityReportMarkdown ? [markdownToWordXml(qualityReportMarkdown)] : []),
  ].join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${documentBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr></w:body></w:document>`;
  const zip = createStoredZip([
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeHtml(context.artifact.name)}</dc:title><dc:creator>Arky Pro</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>` },
    { path: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Arky Pro</Application></Properties>` },
  ]);
  if (stripMarkdown(exportContent).trim().length === 0) throw new Error('No hay contenido textual para DOCX.');
  return new Blob([zip], { type: EXPORT_DEFINITIONS.docx.mimeType });
}

export const docxExporter: ExportAdapter = {
  format: 'docx',
  async export(context) {
    return buildFile(context, 'docx', buildDocxBlob(context), 'DOCX OOXML generado como ZIP con word/document.xml.');
  },
};
