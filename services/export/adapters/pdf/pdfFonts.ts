/**
 * Las fuentes del PDF: qué glifo dibuja cada carácter, cuánto mide, y cómo se
 * incrusta (plan de clase mundial, 9.3).
 *
 * Cada estilo tiene una **pila**: la fuente de texto primero y, detrás, la que
 * cubre lo que a la primera le falta. Inter dibuja el latín, el griego, las
 * flechas, los comparadores y las marcas; Noto Sans Symbols 2 dibuja los
 * pictogramas y el emoji básico. Un carácter que ninguna dibuja **no se
 * sustituye**: se cuenta en `missing` y el exportador lo informa. Escribir «?»
 * en su lugar era exactamente el defecto (H5) que esto corrige —un «≤» que se
 * lee «?» en una regla de suscripción cambia la regla.
 *
 * Las fuentes se incrustan como `Type0` / `CIDFontType2` con `Identity-H`: el
 * CID es el número de glifo, el flujo de contenido escribe dos bytes por
 * glifo, y un `ToUnicode` por fuente devuelve el texto al copiarlo o buscarlo.
 * Cada fuente se recorta a los glifos que el documento usó.
 */
import { parseTrueType, subsetTrueType, type TrueTypeFont } from './trueType';
import { ascii, type PdfWriter } from './pdfWriter';

export type FontStyle = 'reg' | 'bold' | 'ital' | 'mono';

type FaceId = 'inter-regular' | 'inter-bold' | 'inter-italic' | 'noto-sans-mono' | 'noto-sans-symbols2';

/** Cada fuente es un chunk propio: un documento sin cursiva no descarga la cursiva. */
const LOADERS: Record<FaceId, () => Promise<{ default: string }>> = {
  'inter-regular': () => import('./fonts/inter-regular.b64?raw'),
  'inter-bold': () => import('./fonts/inter-bold.b64?raw'),
  'inter-italic': () => import('./fonts/inter-italic.b64?raw'),
  'noto-sans-mono': () => import('./fonts/noto-sans-mono.b64?raw'),
  'noto-sans-symbols2': () => import('./fonts/noto-sans-symbols2.b64?raw'),
};

const STACKS: Record<FontStyle, readonly FaceId[]> = {
  reg: ['inter-regular', 'noto-sans-symbols2'],
  bold: ['inter-bold', 'noto-sans-symbols2'],
  ital: ['inter-italic', 'noto-sans-symbols2'],
  mono: ['noto-sans-mono', 'inter-regular', 'noto-sans-symbols2'],
};

/** Selectores de variación, uniones y separadores de ancho cero: modifican, no se dibujan. */
const IGNORABLE = /[\uFE00-\uFE0F\u200B-\u200D\u2060\uFEFF\u00AD]/u;

const parsed = new Map<FaceId, Promise<TrueTypeFont>>();

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const loadFace = (id: FaceId): Promise<TrueTypeFont> => {
  let pending = parsed.get(id);
  if (!pending) {
    pending = LOADERS[id]().then((module) => parseTrueType(decodeBase64(module.default)));
    parsed.set(id, pending);
  }
  return pending;
};

interface Face {
  readonly id: FaceId;
  readonly font: TrueTypeFont;
  readonly resource: string;
  /** Glifo → el texto que lo produjo, para el `ToUnicode`. */
  readonly used: Map<number, string>;
}

export interface GlyphSegment {
  readonly face: Face;
  readonly text: string;
  readonly glyphs: readonly number[];
  /** Avance total, en milésimas de em. */
  readonly width: number;
}

export class PdfFontSet {
  private readonly faces = new Map<FaceId, Face>();
  /** Caracteres que ninguna fuente de su pila dibuja, con cuántas veces aparecieron. */
  readonly missing = new Map<string, number>();

  private constructor() {}

  /**
   * Carga lo que el texto necesita: regular y negrita siempre, cursiva y
   * monoespaciada si el documento las usa, y los símbolos sólo si algún
   * carácter no lo dibuja su fuente de texto.
   */
  static async load(styles: ReadonlySet<FontStyle>, text: string): Promise<PdfFontSet> {
    const set = new PdfFontSet();
    const wanted = new Set<FaceId>(['inter-regular', 'inter-bold']);
    if (styles.has('ital')) wanted.add('inter-italic');
    if (styles.has('mono')) wanted.add('noto-sans-mono');
    const ids = [...wanted];
    const fonts = await Promise.all(ids.map(loadFace));
    ids.forEach((id, i) => set.register(id, fonts[i]));
    const regular = set.faces.get('inter-regular')!.font;
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp > 0xff && !IGNORABLE.test(ch) && !regular.cmap.has(cp)) {
        set.register('noto-sans-symbols2', await loadFace('noto-sans-symbols2'));
        break;
      }
    }
    return set;
  }

  private register(id: FaceId, font: TrueTypeFont): void {
    if (!this.faces.has(id)) this.faces.set(id, { id, font, resource: `F${this.faces.size + 1}`, used: new Map() });
  }

  /** Vuelve a contar los caracteres perdidos: el documento se pagina dos veces. */
  resetMissing(): void {
    this.missing.clear();
  }

  /** Parte un texto en tramos de una sola fuente. Lo que ninguna dibuja queda en `missing`. */
  shape(text: string, style: FontStyle): GlyphSegment[] {
    const stack = STACKS[style].map((id) => this.faces.get(id)).filter((face): face is Face => Boolean(face));
    const segments: Array<{ face: Face; text: string; glyphs: number[]; width: number }> = [];
    for (const ch of text.replace(/\t/g, '    ')) {
      if (IGNORABLE.test(ch) || ch === '\r' || ch === '\n') continue;
      const cp = ch.codePointAt(0) ?? 0;
      const face = stack.find((candidate) => candidate.font.cmap.has(cp));
      if (!face) {
        this.missing.set(ch, (this.missing.get(ch) ?? 0) + 1);
        continue;
      }
      const glyph = face.font.cmap.get(cp)!;
      const width = (face.font.advances[glyph] * 1000) / face.font.unitsPerEm;
      const last = segments[segments.length - 1];
      if (last && last.face === face) {
        last.text += ch;
        last.glyphs.push(glyph);
        last.width += width;
      } else {
        segments.push({ face, text: ch, glyphs: [glyph], width });
      }
    }
    return segments;
  }

  /** Ancho de un texto en puntos. Medir no cuenta pérdidas: sólo dibujar. */
  measure(text: string, size: number, style: FontStyle): number {
    let width = 0;
    const stack = STACKS[style].map((id) => this.faces.get(id)).filter((face): face is Face => Boolean(face));
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      const face = stack.find((candidate) => candidate.font.cmap.has(cp));
      if (face) width += (face.font.advances[face.font.cmap.get(cp)!] * 1000) / face.font.unitsPerEm;
    }
    return (width / 1000) * size;
  }

  /** Los operadores que pintan `text` en la posición actual del objeto de texto. */
  showText(text: string, size: number, style: FontStyle): string {
    return this.shape(text, style).map((segment) => {
      segment.glyphs.forEach((glyph, i) => {
        if (!segment.face.used.has(glyph)) segment.face.used.set(glyph, Array.from(segment.text)[i] ?? '');
      });
      const hex = segment.glyphs.map((glyph) => glyph.toString(16).padStart(4, '0')).join('').toUpperCase();
      return `/${segment.face.resource} ${size} Tf <${hex}> Tj`;
    }).join(' ');
  }

  /** Escribe las fuentes usadas y devuelve el diccionario `/Font` de los recursos de página. */
  writeFonts(writer: PdfWriter): string {
    const entries: string[] = [];
    for (const face of this.faces.values()) {
      if (face.used.size === 0) continue;
      entries.push(`/${face.resource} ${writeFace(writer, face)} 0 R`);
    }
    return `<< ${entries.join(' ')} >>`;
  }
}

/** Un prefijo de subconjunto estable: seis mayúsculas derivadas de los glifos usados. */
const subsetTag = (face: Face): string => {
  let hash = 2166136261;
  for (const ch of `${face.id}:${[...face.used.keys()].sort((a, b) => a - b).join(',')}`) {
    hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  let tag = '';
  for (let i = 0; i < 6; i += 1) { tag += String.fromCharCode(65 + (hash % 26)); hash = Math.floor(hash / 26) + i * 7919; }
  return tag;
};

const utf16Hex = (text: string): string => {
  let hex = '';
  for (let i = 0; i < text.length; i += 1) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return hex;
};

const toUnicodeCMap = (used: ReadonlyMap<number, string>): string => {
  const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.map(([glyph, text]) => `<${glyph.toString(16).padStart(4, '0').toUpperCase()}> <${utf16Hex(text)}>`).join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange',
    ...blocks,
    'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
  ].join('\n');
};

const writeFace = (writer: PdfWriter, face: Face): number => {
  const { font } = face;
  const scale = (value: number) => Math.round((value * 1000) / font.unitsPerEm);
  const name = `${subsetTag(face)}+${font.postScriptName}`;
  const glyphs = [...face.used.keys()].sort((a, b) => a - b);
  const subset = subsetTrueType(font, glyphs, { renumber: false });
  const file = writer.addStream(`<< /Length1 ${subset.length} >>`, subset);
  const symbolic = face.id === 'noto-sans-symbols2';
  const flags = (font.fixedPitch ? 1 : 0) | (symbolic ? 4 : 32) | (font.italicAngle !== 0 ? 64 : 0);
  const descriptor = writer.add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${flags} /FontBBox [${font.bbox.map(scale).join(' ')}] /ItalicAngle ${Math.round(font.italicAngle * 10) / 10} /Ascent ${scale(font.ascent)} /Descent ${scale(font.descent)} /CapHeight ${scale(font.capHeight)} /StemV ${face.id === 'inter-bold' ? 140 : 80} /FontFile2 ${file} 0 R >>`);
  const widths: string[] = [];
  for (const glyph of glyphs) widths.push(`${glyph} [${scale(font.advances[glyph])}]`);
  const cidFont = writer.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW ${scale(font.advances[0] ?? font.unitsPerEm)} /W [${widths.join(' ')}] /CIDToGIDMap /Identity >>`);
  const toUnicode = writer.addStream('<< >>', ascii(toUnicodeCMap(face.used)));
  return writer.add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
};
