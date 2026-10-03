/**
 * Lector y subconjuntador de fuentes TrueType (plan de clase mundial, 9.3).
 *
 * El PDF dejó de escribir con Helvetica WinAnsi —un byte por carácter, y todo
 * lo que no es Latin-1 convertido en «?»— y pasó a incrustar una fuente real
 * con codificación Identity-H. Para eso hacen falta dos cosas que no traía
 * ninguna dependencia del proyecto, y que no justifican una:
 *
 * - **Leer** una fuente: qué glifo dibuja cada carácter (`cmap` 4 y 12), cuánto
 *   avanza cada glifo (`hmtx`) y las métricas que pide el `FontDescriptor`.
 * - **Recortarla**: un PDF que incrusta la fuente entera pesa 400 KB por estilo.
 *   `subsetTrueType` conserva sólo los glifos pedidos —y los componentes de los
 *   glifos compuestos que los forman— con las tablas que un lector de PDF usa,
 *   que son las que conserva cualquier subconjuntador de PDF (head, hhea, maxp,
 *   hmtx, loca, glyf, cvt, fpgm, prep).
 *
 * Dos modos. `renumber: false` deja cada glifo en su número y vacía los demás:
 * así el identificador de glifo es el CID y el PDF usa `CIDToGIDMap /Identity`,
 * que es lo que hace el exportador en cada documento. `renumber: true` compacta
 * la fuente y le escribe un `cmap` nuevo: es lo que usa el script que prepara
 * los activos (`scripts/buildPdfFonts.mjs`) a partir de las fuentes originales.
 */

export interface TrueTypeFont {
  readonly bytes: Uint8Array;
  readonly tables: ReadonlyMap<string, { offset: number; length: number }>;
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly bbox: readonly [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly fixedPitch: boolean;
  readonly postScriptName: string;
  /** Punto de código → glifo. */
  readonly cmap: ReadonlyMap<number, number>;
  /** Avance de cada glifo, en unidades de la fuente. */
  readonly advances: Uint16Array;
}

const tag = (bytes: Uint8Array, at: number): string => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

const readCmap = (view: DataView, start: number): Map<number, number> => {
  const map = new Map<number, number>();
  const count = view.getUint16(start + 2);
  let format4 = -1;
  let format12 = -1;
  for (let i = 0; i < count; i += 1) {
    const platform = view.getUint16(start + 4 + i * 8);
    const encoding = view.getUint16(start + 6 + i * 8);
    const offset = start + view.getUint32(start + 8 + i * 8);
    const format = view.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12) format12 = offset;
    else if (format === 4 && format4 < 0) format4 = offset;
  }
  if (format12 >= 0) {
    const groups = view.getUint32(format12 + 12);
    for (let g = 0; g < groups; g += 1) {
      const at = format12 + 16 + g * 12;
      const first = view.getUint32(at);
      const last = view.getUint32(at + 4);
      const glyph = view.getUint32(at + 8);
      for (let cp = first; cp <= last; cp += 1) map.set(cp, glyph + (cp - first));
    }
    return map;
  }
  if (format4 >= 0) {
    const segments = view.getUint16(format4 + 6) / 2;
    const ends = format4 + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let s = 0; s < segments; s += 1) {
      const end = view.getUint16(ends + s * 2);
      const first = view.getUint16(starts + s * 2);
      const delta = view.getInt16(deltas + s * 2);
      const rangeOffset = view.getUint16(rangeOffsets + s * 2);
      for (let cp = first; cp <= end && cp !== 0xffff; cp += 1) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
        else {
          const at = rangeOffsets + s * 2 + rangeOffset + (cp - first) * 2;
          glyph = view.getUint16(at);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) map.set(cp, glyph);
      }
    }
  }
  return map;
};

const readPostScriptName = (bytes: Uint8Array, view: DataView, start: number): string => {
  const count = view.getUint16(start + 2);
  const strings = start + view.getUint16(start + 4);
  for (let i = 0; i < count; i += 1) {
    const at = start + 6 + i * 12;
    if (view.getUint16(at + 6) !== 6) continue;
    const platform = view.getUint16(at);
    const length = view.getUint16(at + 8);
    const offset = strings + view.getUint16(at + 10);
    let name = '';
    if (platform === 3 || platform === 0) {
      for (let k = 0; k + 1 < length; k += 2) name += String.fromCharCode(view.getUint16(offset + k));
    } else {
      for (let k = 0; k < length; k += 1) name += String.fromCharCode(bytes[offset + k]);
    }
    if (name) return name.replace(/[^\w-]/g, '');
  }
  return 'Font';
};

/** Lee una fuente TrueType (contornos `glyf`). Lanza si no lo es. */
export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) throw new Error('No es una fuente TrueType con contornos glyf.');
  const tables = new Map<string, { offset: number; length: number }>();
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i += 1) {
    const at = 12 + i * 16;
    tables.set(tag(bytes, at), { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  const need = (name: string) => {
    const table = tables.get(name);
    if (!table) throw new Error(`La fuente no tiene la tabla ${name}.`);
    return table.offset;
  };
  const head = need('head');
  const hhea = need('hhea');
  const unitsPerEm = view.getUint16(head + 18);
  const numGlyphs = view.getUint16(need('maxp') + 4);
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const hmtx = need('hmtx');
  const advances = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g += 1) {
    advances[g] = view.getUint16(hmtx + Math.min(g, numberOfHMetrics - 1) * 4);
  }
  const os2 = tables.get('OS/2');
  const post = tables.get('post');
  const name = tables.get('name');
  const ascent = view.getInt16(hhea + 4);
  return {
    bytes,
    tables,
    unitsPerEm,
    numGlyphs,
    bbox: [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)],
    ascent,
    descent: view.getInt16(hhea + 6),
    capHeight: os2 && os2.length >= 90 && view.getUint16(os2.offset) >= 2 ? view.getInt16(os2.offset + 88) : Math.round(ascent * 0.7),
    italicAngle: post ? view.getInt32(post.offset + 4) / 65536 : 0,
    fixedPitch: post ? view.getUint32(post.offset + 12) !== 0 : false,
    postScriptName: name ? readPostScriptName(bytes, view, name.offset) : 'Font',
    cmap: tables.has('cmap') ? readCmap(view, tables.get('cmap')!.offset) : new Map(),
    advances,
  };
}

// ─── Glifos ─────────────────────────────────────────────────────────────────

const glyphRange = (font: TrueTypeFont, view: DataView, glyph: number): [number, number] => {
  const loca = font.tables.get('loca')!.offset;
  const long = view.getInt16(font.tables.get('head')!.offset + 50) === 1;
  const glyf = font.tables.get('glyf')!.offset;
  const at = (i: number) => (long ? view.getUint32(loca + i * 4) : view.getUint16(loca + i * 2) * 2);
  return [glyf + at(glyph), glyf + at(glyph + 1)];
};

const MORE_COMPONENTS = 0x0020;
const ARGS_ARE_WORDS = 0x0001;
const HAS_SCALE = 0x0008;
const HAS_XY_SCALE = 0x0040;
const HAS_2X2 = 0x0080;

/** Los desplazamientos (dentro del glifo) de cada índice de componente de un glifo compuesto. */
const componentSlots = (view: DataView, start: number, end: number): number[] => {
  if (end - start < 10 || view.getInt16(start) >= 0) return [];
  const slots: number[] = [];
  let at = start + 10;
  for (;;) {
    const flags = view.getUint16(at);
    slots.push(at + 2 - start);
    at += 4 + (flags & ARGS_ARE_WORDS ? 4 : 2);
    if (flags & HAS_SCALE) at += 2;
    else if (flags & HAS_XY_SCALE) at += 4;
    else if (flags & HAS_2X2) at += 8;
    if (!(flags & MORE_COMPONENTS) || at >= end) break;
  }
  return slots;
};

/** Los glifos pedidos más el `.notdef` y todos los componentes de los compuestos. */
export function glyphClosure(font: TrueTypeFont, glyphs: Iterable<number>): number[] {
  const view = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength);
  const keep = new Set<number>([0]);
  const stack = [...glyphs].filter((g) => g >= 0 && g < font.numGlyphs);
  while (stack.length > 0) {
    const glyph = stack.pop()!;
    if (keep.has(glyph) && glyph !== 0) continue;
    keep.add(glyph);
    const [start, end] = glyphRange(font, view, glyph);
    for (const slot of componentSlots(view, start, end)) {
      const component = view.getUint16(start + slot);
      if (!keep.has(component)) stack.push(component);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

// ─── Escritura ──────────────────────────────────────────────────────────────

const pad4 = (length: number): number => (length + 3) & ~3;

const checksum = (data: Uint8Array): number => {
  const padded = new Uint8Array(pad4(data.length));
  padded.set(data);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
};

const writeCmap12 = (mapping: ReadonlyMap<number, number>): Uint8Array => {
  const points = [...mapping.keys()].sort((a, b) => a - b);
  const groups: Array<[number, number, number]> = [];
  for (const cp of points) {
    const glyph = mapping.get(cp)!;
    const last = groups[groups.length - 1];
    if (last && cp === last[1] + 1 && glyph === last[2] + (cp - last[0])) last[1] = cp;
    else groups.push([cp, cp, glyph]);
  }
  const out = new Uint8Array(12 + 16 + groups.length * 12);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1);
  view.setUint16(4, 3);
  view.setUint16(6, 10);
  view.setUint32(8, 12);
  view.setUint16(12, 12);
  view.setUint32(16, 16 + groups.length * 12);
  view.setUint32(24, groups.length);
  groups.forEach(([first, last, glyph], i) => {
    view.setUint32(28 + i * 12, first);
    view.setUint32(32 + i * 12, last);
    view.setUint32(36 + i * 12, glyph);
  });
  return out;
};

export interface SubsetOptions {
  /** `true` compacta la numeración y escribe un `cmap` nuevo; `false` conserva cada glifo en su número. */
  readonly renumber: boolean;
  /** Con `renumber`, los puntos de código que el `cmap` nuevo debe conservar. */
  readonly codePoints?: Iterable<number>;
}

/** Una fuente con sólo los glifos de `glyphs` (y su cierre). */
export function subsetTrueType(font: TrueTypeFont, glyphs: Iterable<number>, options: SubsetOptions): Uint8Array {
  const view = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength);
  const kept = glyphClosure(font, glyphs);
  const keptSet = new Set(kept);
  const count = options.renumber ? kept.length : font.numGlyphs;
  const newIndex = new Map<number, number>(kept.map((g, i) => [g, options.renumber ? i : g]));
  const source = (n: number) => (options.renumber ? kept[n] : n);

  const parts: Uint8Array[] = [];
  const offsets = new Uint32Array(count + 1);
  let size = 0;
  for (let n = 0; n < count; n += 1) {
    offsets[n] = size;
    const glyph = source(n);
    if (!keptSet.has(glyph)) continue;
    const [start, end] = glyphRange(font, view, glyph);
    if (end <= start) continue;
    const copy = font.bytes.slice(start, end);
    const copyView = new DataView(copy.buffer);
    for (const slot of componentSlots(view, start, end)) copyView.setUint16(slot, newIndex.get(copyView.getUint16(slot)) ?? 0);
    parts.push(copy);
    const padded = pad4(copy.length);
    if (padded > copy.length) parts.push(new Uint8Array(padded - copy.length));
    size += padded;
  }
  offsets[count] = size;
  const glyf = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) { glyf.set(part, cursor); cursor += part.length; }

  const loca = new Uint8Array((count + 1) * 4);
  const locaView = new DataView(loca.buffer);
  offsets.forEach((offset, i) => locaView.setUint32(i * 4, offset));

  const hmtx = new Uint8Array(count * 4);
  const hmtxView = new DataView(hmtx.buffer);
  const numberOfHMetrics = view.getUint16(font.tables.get('hhea')!.offset + 34);
  const hmtxOffset = font.tables.get('hmtx')!.offset;
  for (let n = 0; n < count; n += 1) {
    const glyph = source(n);
    hmtxView.setUint16(n * 4, font.advances[glyph]);
    const lsb = glyph < numberOfHMetrics
      ? view.getInt16(hmtxOffset + glyph * 4 + 2)
      : view.getInt16(hmtxOffset + numberOfHMetrics * 4 + (glyph - numberOfHMetrics) * 2);
    hmtxView.setInt16(n * 4 + 2, lsb);
  }

  const copyTable = (name: string): Uint8Array | null => {
    const table = font.tables.get(name);
    return table ? font.bytes.slice(table.offset, table.offset + table.length) : null;
  };
  const head = copyTable('head')!;
  new DataView(head.buffer).setUint32(8, 0);
  new DataView(head.buffer).setInt16(50, 1);
  const hhea = copyTable('hhea')!;
  new DataView(hhea.buffer).setUint16(34, count);
  const maxp = copyTable('maxp')!;
  new DataView(maxp.buffer).setUint16(4, count);

  const out: Array<[string, Uint8Array]> = [
    ['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', loca], ['maxp', maxp],
  ];
  for (const name of ['cvt ', 'fpgm', 'prep']) {
    const table = copyTable(name);
    if (table) out.push([name, table]);
  }
  if (options.renumber) {
    const mapping = new Map<number, number>();
    for (const cp of options.codePoints ?? font.cmap.keys()) {
      const glyph = font.cmap.get(cp);
      const index = glyph === undefined ? undefined : newIndex.get(glyph);
      if (index !== undefined) mapping.set(cp, index);
    }
    out.push(['cmap', writeCmap12(mapping)]);
    for (const name of ['OS/2', 'name']) {
      const table = copyTable(name);
      if (table) out.push([name, table]);
    }
    const post = copyTable('post');
    if (post) {
      const header = post.slice(0, 32);
      new DataView(header.buffer).setUint32(0, 0x00030000);
      out.push(['post', header]);
    }
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return assemble(out);
}

const assemble = (tables: Array<[string, Uint8Array]>): Uint8Array => {
  const numTables = tables.length;
  const headerLength = 12 + numTables * 16;
  const total = tables.reduce((sum, [, data]) => sum + pad4(data.length), headerLength);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector += 1;
  const searchRange = 2 ** entrySelector * 16;
  view.setUint32(0, 0x00010000);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, numTables * 16 - searchRange);
  let offset = headerLength;
  let headOffset = -1;
  tables.forEach(([name, data], i) => {
    const at = 12 + i * 16;
    for (let k = 0; k < 4; k += 1) out[at + k] = name.charCodeAt(k);
    view.setUint32(at + 4, checksum(data));
    view.setUint32(at + 8, offset);
    view.setUint32(at + 12, data.length);
    out.set(data, offset);
    if (name === 'head') headOffset = offset;
    offset += pad4(data.length);
  });
  if (headOffset >= 0) view.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
};
