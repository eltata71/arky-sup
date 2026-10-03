import type { PresentationDeck } from '../../../presentation';
import { LAYOUT_ORDER } from './branding';
import { CT_BASE, NS, XML_DECL, relationships, xmlEscape } from './xml';

export const buildContentTypes = (slideCount: number, notesSlides: number[]): string => {
  const o = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;
  return `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${[
    o('/ppt/presentation.xml', `${CT_BASE}.presentationml.presentation.main+xml`),
    o('/ppt/slideMasters/slideMaster1.xml', `${CT_BASE}.presentationml.slideMaster+xml`),
    ...LAYOUT_ORDER.map((_, i) => o(`/ppt/slideLayouts/slideLayout${i + 1}.xml`, `${CT_BASE}.presentationml.slideLayout+xml`)),
    o('/ppt/theme/theme1.xml', `${CT_BASE}.theme+xml`),
    o('/ppt/theme/theme2.xml', `${CT_BASE}.theme+xml`),
    o('/ppt/notesMasters/notesMaster1.xml', `${CT_BASE}.presentationml.notesMaster+xml`),
    ...Array.from({ length: slideCount }, (_, i) => o(`/ppt/slides/slide${i + 1}.xml`, `${CT_BASE}.presentationml.slide+xml`)),
    ...notesSlides.map((n) => o(`/ppt/notesSlides/notesSlide${n}.xml`, `${CT_BASE}.presentationml.notesSlide+xml`)),
    o('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'),
  ].join('')}</Types>`;
};

export const ROOT_RELS = `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

export const buildCoreProps = (deck: PresentationDeck): string => `${XML_DECL}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(deck.title)}</dc:title><dc:creator>Arky</dc:creator></cp:coreProperties>`;

export const buildPresentationXml = (slideCount: number): string => {
  const ids = Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('');
  return `${XML_DECL}
<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
};

export const buildPresentationRels = (slideCount: number): string =>
  relationships([
    { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' },
    ...Array.from({ length: slideCount }, (_, i) => ({ id: `rId${i + 3}`, type: 'slide', target: `slides/slide${i + 1}.xml` })),
    { id: `rId${slideCount + 3}`, type: 'theme', target: 'theme/theme1.xml' },
  ]);
