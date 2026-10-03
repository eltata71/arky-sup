import { LAYOUT_ORDER, LAYOUT_SPECS, PPTX_PALETTE, SLIDE_HEIGHT_EMU, SLIDE_WIDTH_EMU, type LayoutSpec } from './branding';
import { GROUP_HEADER, NS, XML_DECL, relationships } from './xml';

const rect = (id: number, name: string, x: number, y: number, cx: number, cy: number, color: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></p:txBody></p:sp>`;

const decoration = (spec: LayoutSpec): string => {
  if (spec.decoration === 'bar') return rect(20, 'Barra', 0, 0, 120_000, SLIDE_HEIGHT_EMU, PPTX_PALETTE.primary);
  if (spec.decoration === 'band') return rect(20, 'Banda', 0, SLIDE_HEIGHT_EMU - 220_000, SLIDE_WIDTH_EMU, 220_000, PPTX_PALETTE.primary);
  return '';
};

const background = (spec: LayoutSpec): string =>
  spec.hero ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${PPTX_PALETTE.darkSurface}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : '';

export const buildSlideLayoutXml = (layoutId: string): string => {
  const spec = LAYOUT_SPECS[layoutId as keyof typeof LAYOUT_SPECS];
  return `${XML_DECL}
<p:sldLayout ${NS} preserve="1" userDrawn="1"><p:cSld name="${layoutId}">${background(spec)}<p:spTree>${GROUP_HEADER}${decoration(spec)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
};

export const buildSlideLayoutRels = (): string =>
  relationships([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]);

export const buildSlideMasterXml = (): string => {
  const ids = LAYOUT_ORDER.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('');
  return `${XML_DECL}
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${PPTX_PALETTE.surface}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP_HEADER}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${ids}</p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`;
};

export const buildSlideMasterRels = (): string =>
  relationships([
    ...LAYOUT_ORDER.map((_, i) => ({ id: `rId${i + 1}`, type: 'slideLayout', target: `../slideLayouts/slideLayout${i + 1}.xml` })),
    { id: `rId${LAYOUT_ORDER.length + 1}`, type: 'theme', target: '../theme/theme1.xml' },
  ]);
