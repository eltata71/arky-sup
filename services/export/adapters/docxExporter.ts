import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { createStoredZip, type ZipEntryInput } from '../utils/zip';
import { escapeHtml, stripMarkdown } from '../utils/text';
import { buildFile, buildMetadata, publicationMarkdown, shouldExportPublication } from './shared';
import { buildArtifactQualityReport } from '../../quality/artifactQualityService';
import { renderQualityReportMarkdown } from '../../quality/qualityReportRenderer';
import { createDocxRenderState, paragraphXml, renderMarkdownXml, tableXml } from './docx/markdown';
import { numberingXml } from './docx/numbering';
import { stylesXml } from './docx/styles';

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_BASE = 'http://schemas.openxmlformats.org/package/2006/relationships';

const tableOfContents = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Índice</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Actualice el índice en Word o LibreOffice.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

interface BuiltDocx { blob: Blob; warnings: string[] }

async function buildDocx(context: ExportContext): Promise<BuiltDocx> {
  const exportContent = shouldExportPublication(context) ? publicationMarkdown(context) : context.artifact.content;
  if (!stripMarkdown(exportContent).trim() && !/```mermaid\b/i.test(exportContent)) {
    throw new Error('No hay contenido para DOCX.');
  }

  const state = createDocxRenderState();
  const metadata = buildMetadata(context);
  const qualityReport = context.includeQualityReport
    ? renderQualityReportMarkdown(buildArtifactQualityReport(context.artifact))
    : '';
  const documentBody = [
    paragraphXml(context.presentationModel?.title || context.artifact.name, state, 'Title'),
    paragraphXml(context.presentationModel?.purpose || context.artifact.objective || 'Documento arquitectónico generado por Arky Pro.', state),
    paragraphXml('Metadatos', state, 'Heading1'),
    tableXml(['Campo', 'Valor'], metadata, state, [2600, 7480]),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    tableOfContents,
    paragraphXml('Contenido', state, 'Heading1'),
    await renderMarkdownXml(exportContent, state),
    ...(qualityReport ? [await renderMarkdownXml(qualityReport, state)] : []),
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="${REL_BASE}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${documentBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr></w:body>
</w:document>`;

  const documentRelationships = [
    `<Relationship Id="rId1" Type="${REL_BASE}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${REL_BASE}/numbering" Target="numbering.xml"/>`,
    ...state.images.map((image) => `<Relationship Id="rId${image.number + 2}" Type="${REL_BASE}/image" Target="media/image${image.number}.png"/>`),
    ...state.links.map((link) => `<Relationship Id="rId${link.id}" Type="${REL_BASE}/hyperlink" Target="${escapeHtml(link.target)}" TargetMode="External"/>`),
  ].join('');
  const generatedAt = (context.generatedAt ?? new Date()).toISOString();
  const entries: ZipEntryInput[] = [
    { path: '[Content_Types].xml', content: contentTypesXml },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_BASE}"><Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="${PKG_REL_BASE}/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_BASE}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_BASE}">${documentRelationships}</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: stylesXml },
    { path: 'word/numbering.xml', content: numberingXml },
    { path: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeHtml(context.artifact.name)}</dc:title><dc:creator>Arky Pro</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created></cp:coreProperties>` },
    { path: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Arky Pro</Application></Properties>` },
    ...state.images.map((image) => ({ path: `word/media/image${image.number}.png`, content: image.bytes })),
  ];
  return { blob: new Blob([createStoredZip(entries)], { type: EXPORT_DEFINITIONS.docx.mimeType }), warnings: state.warnings };
}

export async function buildDocxBlob(context: ExportContext): Promise<Blob> {
  return (await buildDocx(context)).blob;
}

export const docxExporter: ExportAdapter = {
  format: 'docx',
  async export(context) {
    const result = await buildDocx(context);
    const details = `DOCX OOXML con estilos, numeración, índice y diagramas incrustados.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`;
    return buildFile(context, 'docx', result.blob, details);
  },
};
