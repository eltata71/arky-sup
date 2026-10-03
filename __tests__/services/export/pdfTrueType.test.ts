/**
 * El lector y el subconjuntador TrueType del PDF (plan de clase mundial, 9.3),
 * contra las fuentes reales que el exportador incrusta.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glyphClosure, parseTrueType, subsetTrueType } from '../../../services/export/adapters/pdf/trueType';

const FONTS = join(process.cwd(), 'services', 'export', 'adapters', 'pdf', 'fonts');
const load = (name: string) => parseTrueType(new Uint8Array(Buffer.from(readFileSync(join(FONTS, `${name}.b64`), 'utf8'), 'base64')));

describe('parseTrueType', () => {
  it('lee métricas, nombre y cmap de Inter', () => {
    const inter = load('inter-regular');
    expect(inter.postScriptName).toBe('Inter-Regular');
    expect(inter.unitsPerEm).toBe(2048);
    for (const ch of 'Aáñ→⇒≤≥✓✗αβΔ⚠') expect(inter.cmap.has(ch.codePointAt(0)!), ch).toBe(true);
    expect(inter.advances[inter.cmap.get(0x41)!]).toBeGreaterThan(0);
    expect(load('inter-italic').italicAngle).toBeLessThan(0);
  });

  it('el respaldo de símbolos cubre el emoji básico que Inter no tiene', () => {
    expect(load('inter-regular').cmap.has(0x1f5d3)).toBe(false);
    expect(load('noto-sans-symbols2').cmap.has(0x1f5d3)).toBe(true);
  });

  it('rechaza lo que no es una fuente TrueType', () => {
    expect(() => parseTrueType(new Uint8Array(16))).toThrow(/TrueType/);
  });
});

describe('subsetTrueType', () => {
  const inter = load('inter-regular');
  const glyphs = [...'Hola→'].map((ch) => inter.cmap.get(ch.codePointAt(0)!)!);

  it('sin renumerar conserva cada glifo en su número y vacía los demás', () => {
    const subset = parseTrueType(subsetTrueType(inter, glyphs, { renumber: false }));
    expect(subset.numGlyphs).toBe(inter.numGlyphs);
    for (const glyph of glyphs) expect(subset.advances[glyph]).toBe(inter.advances[glyph]);
    expect(subsetTrueType(inter, glyphs, { renumber: false }).length).toBeLessThan(inter.bytes.length / 5);
  });

  it('renumerando escribe un cmap nuevo que apunta a los mismos dibujos', () => {
    const points = [...'Hola→'].map((ch) => ch.codePointAt(0)!);
    const subset = parseTrueType(subsetTrueType(inter, glyphs, { renumber: true, codePoints: points }));
    expect(subset.numGlyphs).toBe(glyphClosure(inter, glyphs).length);
    for (const cp of points) expect(subset.advances[subset.cmap.get(cp)!]).toBe(inter.advances[inter.cmap.get(cp)!]);
  });

  it('un glifo compuesto arrastra sus componentes', () => {
    // «á» se compone de «a» y el acento en Inter.
    const aacute = inter.cmap.get(0xe1)!;
    const closure = glyphClosure(inter, [aacute]);
    expect(closure).toContain(0);
    expect(closure).toContain(aacute);
    expect(closure.length).toBeGreaterThan(2);
  });

  it('la suma de comprobación del fichero cuadra (checkSumAdjustment)', () => {
    const bytes = subsetTrueType(inter, glyphs, { renumber: false });
    const padded = new Uint8Array((bytes.length + 3) & ~3);
    padded.set(bytes);
    const view = new DataView(padded.buffer);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });
});
