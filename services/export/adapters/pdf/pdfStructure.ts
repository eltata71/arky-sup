/**
 * La estructura etiquetada del PDF (plan de clase mundial, 9.3; ver
 * `docs/publication-accessibility.md`).
 *
 * Un PDF sin etiquetas es, para un lector de pantalla, una lista de trozos de
 * texto en el orden en que se pintaron: no sabe qué es un título, dónde
 * empieza una tabla ni qué celda es cabecera. Cada página registra aquí su
 * contenido marcado (`BDC … EMC` con un MCID) y el elemento al que pertenece;
 * `writeStructTree` escribe el árbol (`/StructTreeRoot`), su `ParentTree` y lo
 * que el catálogo necesita para declararse etiquetado. Lo que no es contenido
 * —cabeceras, pies, fondos, filetes— se marca como `/Artifact`.
 */
import { pdfTextString, type PdfWriter } from './pdfWriter';

export interface MarkedRef { readonly page: number; readonly mcid: number }

export interface StructElem {
  readonly type: string;
  readonly children: Array<StructElem | MarkedRef>;
  /** Texto alternativo, para figuras. */
  alt?: string;
}

export const structElem = (type: string, parent?: StructElem, alt?: string): StructElem => {
  const elem: StructElem = { type, children: [], alt };
  parent?.children.push(elem);
  return elem;
};

const isElem = (node: StructElem | MarkedRef): node is StructElem => 'type' in node;

/**
 * Escribe el árbol y devuelve el número de objeto del `StructTreeRoot`.
 * `pageMarks[p][mcid]` es el elemento dueño de cada contenido marcado de la
 * página `p`; `pageObjects[p]`, el objeto de esa página.
 */
export function writeStructTree(
  writer: PdfWriter,
  root: StructElem,
  pageMarks: ReadonlyArray<ReadonlyArray<StructElem>>,
  pageObjects: readonly number[],
): number {
  const treeRoot = writer.reserve();
  const ids = new Map<StructElem, number>();
  const assign = (elem: StructElem) => {
    ids.set(elem, writer.reserve());
    elem.children.forEach((child) => { if (isElem(child)) assign(child); });
  };
  assign(root);
  const write = (elem: StructElem, parent: number) => {
    const kids = elem.children.map((child) => (isElem(child)
      ? `${ids.get(child)} 0 R`
      : `<< /Type /MCR /Pg ${pageObjects[child.page]} 0 R /MCID ${child.mcid} >>`));
    const alt = elem.alt ? ` /Alt ${pdfTextString(elem.alt)}` : '';
    writer.set(ids.get(elem)!, `<< /Type /StructElem /S /${elem.type} /P ${parent} 0 R /K [${kids.join(' ')}]${alt} >>`);
    elem.children.forEach((child) => { if (isElem(child)) write(child, ids.get(elem)!); });
  };
  write(root, treeRoot);
  const nums = pageMarks.map((marks, page) => `${page} [${marks.map((elem) => `${ids.get(elem) ?? ids.get(root)} 0 R`).join(' ')}]`);
  const parentTree = writer.add(`<< /Nums [${nums.join(' ')}] >>`);
  writer.set(treeRoot, `<< /Type /StructTreeRoot /K [${ids.get(root)} 0 R] /ParentTree ${parentTree} 0 R /ParentTreeNextKey ${pageMarks.length} >>`);
  return treeRoot;
}
