import { GROUP_HEADER, NS, XML_DECL, relationships, xmlEscape } from './xml';
import { SLIDE_HEIGHT_EMU, SLIDE_WIDTH_EMU } from './branding';

const placeholder = (id: number, name: string, type: string, idx: number | null, x: number, y: number, cx: number, cy: number, body = ''): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"${type === 'sldImg' ? ' noRot="1" noChangeAspect="1"' : ''}/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx === null ? '' : ` idx="${idx}"`}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>${body}</p:sp>`;

export const buildNotesMasterXml = (): string => `${XML_DECL}
<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_HEADER}${placeholder(2, 'Imagen de diapositiva', 'sldImg', 2, 685_800, 1_143_000, 5_486_400, 4_114_800)}${placeholder(3, 'Notas', 'body', 3, 685_800, 5_715_000, 5_486_400, 4_500_000, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></p:txBody>')}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`;

export const buildNotesMasterRels = (): string =>
  relationships([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]);

/** One paragraph, so the notes read back as the author wrote them. */
export const buildNotesSlideXml = (notes: string): string => `${XML_DECL}
<p:notes ${NS}><p:cSld><p:spTree>${GROUP_HEADER}${placeholder(2, 'Imagen de diapositiva', 'sldImg', null, 685_800, 1_143_000, 5_486_400, 4_114_800)}${placeholder(3, 'Notas', 'body', 1, 685_800, 5_715_000, 5_486_400, 4_500_000, `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" dirty="0"/><a:t>${xmlEscape(notes)}</a:t></a:r></a:p></p:txBody>`)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;

export const buildNotesSlideRels = (slideNumber: number): string =>
  relationships([
    { id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
    { id: 'rId2', type: 'slide', target: `../slides/slide${slideNumber}.xml` },
  ]);

export const NOTES_SIZE = { cx: SLIDE_HEIGHT_EMU, cy: SLIDE_WIDTH_EMU };
