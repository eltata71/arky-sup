import { PPTX_FONT, PPTX_PALETTE } from './branding';
import { NS, XML_DECL } from './xml';

const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const line = `<a:ln w="9525">${fill}</a:ln>`;

export const buildThemeXml = (name: string): string => `${XML_DECL}
<a:theme ${NS.split(' ')[0]} name="${name}"><a:themeElements>
<a:clrScheme name="${name}">
<a:dk1><a:srgbClr val="${PPTX_PALETTE.ink}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="${PPTX_PALETTE.primaryDark}"/></a:dk2><a:lt2><a:srgbClr val="${PPTX_PALETTE.surface}"/></a:lt2>
<a:accent1><a:srgbClr val="${PPTX_PALETTE.primary}"/></a:accent1><a:accent2><a:srgbClr val="06B6D4"/></a:accent2>
<a:accent3><a:srgbClr val="${PPTX_PALETTE.tone.success.solid}"/></a:accent3><a:accent4><a:srgbClr val="${PPTX_PALETTE.tone.warning.solid}"/></a:accent4>
<a:accent5><a:srgbClr val="${PPTX_PALETTE.tone.risk.solid}"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6>
<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="${name}"><a:majorFont><a:latin typeface="${PPTX_FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${PPTX_FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="${name}">
<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>
<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;
