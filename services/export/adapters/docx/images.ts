import { rasterizeMermaidToPng } from '../../utils/mermaidRaster';

export interface DocxImage {
  number: number;
  bytes: Uint8Array;
  width: number;
  height: number;
}

const MAX_WIDTH_EMU = 5_943_600; // 6.5 in, the document's content width.
const MAX_HEIGHT_EMU = 6_400_800; // 7 in; leave room for a caption.
const EMU_PER_PX = 9_525;

export async function rasterizeDocumentDiagram(code: string, number: number): Promise<DocxImage | null> {
  const raster = await rasterizeMermaidToPng(code, { background: '#ffffff' });
  if (!raster) return null;
  return { number, bytes: raster.pngBytes, width: raster.width, height: raster.height };
}

export function drawingXml(image: DocxImage): string {
  const scale = Math.min(
    MAX_WIDTH_EMU / Math.max(image.width * EMU_PER_PX, 1),
    MAX_HEIGHT_EMU / Math.max(image.height * EMU_PER_PX, 1),
    1,
  );
  const cx = Math.max(1, Math.round(image.width * EMU_PER_PX * scale));
  const cy = Math.max(1, Math.round(image.height * EMU_PER_PX * scale));
  const relationId = image.number + 2;
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${image.number}" name="Diagrama ${image.number}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${image.number}" name="Diagrama ${image.number}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
