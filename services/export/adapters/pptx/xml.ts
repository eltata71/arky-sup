import { escapeHtml } from '../../utils/text';

export const xmlEscape = (value: string): string => escapeHtml(value).replace(/'/g, '&apos;');

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
export const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const CT_BASE = 'application/vnd.openxmlformats-officedocument';

export const GROUP_HEADER = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

export const relationships = (items: Array<{ id: string; type: string; target: string }>): string =>
  `${XML_DECL}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map((item) => `<Relationship Id="${item.id}" Type="${REL_BASE}/${item.type}" Target="${item.target}"/>`)
    .join('')}</Relationships>`;
