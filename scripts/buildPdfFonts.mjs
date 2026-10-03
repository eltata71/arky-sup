#!/usr/bin/env node
/**
 * buildPdfFonts — prepara las fuentes que incrusta el PDF (plan de clase mundial, 9.3).
 *
 * Las fuentes originales pesan entre 400 y 700 KB cada una; el exportador sólo
 * necesita los alfabetos y símbolos que escribe un documento de arquitectura.
 * Este script las recorta a esos rangos con el mismo subconjuntador que usa el
 * exportador (`services/export/adapters/pdf/trueType.ts`) y las escribe en
 * base64 junto al exportador, de donde se cargan con `import()` sólo al
 * exportar un PDF.
 *
 * No corre en el build: los ficheros generados se versionan, y este script se
 * ejecuta a mano cuando cambia una fuente o un rango. Uso:
 *
 *   node scripts/buildPdfFonts.mjs <carpeta con los .ttf originales>
 *
 * Origen de cada fuente, todas bajo SIL Open Font License 1.1 (el texto está
 * en `services/export/adapters/pdf/fonts/LICENSES.txt`):
 *
 * - Inter 4.1, estáticas de `extras/ttf/` — https://github.com/rsms/inter/releases/tag/v4.1
 * - Noto Sans Mono y Noto Sans Symbols 2, `unhinted/ttf/` — https://github.com/notofonts/notofonts.github.io
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrueType, subsetTrueType } from '../services/export/adapters/pdf/trueType.ts';

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Lo que escribe un documento: latín, griego, puntuación, monedas, flechas, operadores y símbolos. */
const TEXT = [
  ...range(0x20, 0x7e), ...range(0xa0, 0x17f), ...range(0x218, 0x21b), ...range(0x2c6, 0x2dd),
  ...range(0x370, 0x3ff), ...range(0x2000, 0x206f), ...range(0x20a0, 0x20cf), ...range(0x2100, 0x214f),
  ...range(0x2190, 0x21ff), ...range(0x2200, 0x22ff), ...range(0x2300, 0x23ff), ...range(0x2460, 0x24ff),
  ...range(0x2500, 0x27bf), ...range(0x2b00, 0x2bff), 0xfffd,
];

/** El código: lo mismo sin pictogramas, más los trazos de caja con que se dibujan árboles y tablas. */
const CODE = [
  ...range(0x20, 0x7e), ...range(0xa0, 0x17f), ...range(0x370, 0x3ff), ...range(0x2000, 0x206f),
  ...range(0x20a0, 0x20cf), ...range(0x2190, 0x21ff), ...range(0x2200, 0x22ff), ...range(0x2500, 0x259f), 0xfffd,
];

/** El respaldo: marcas, pictogramas y el emoji básico que no tiene la fuente de texto. */
const SYMBOLS = [
  ...range(0x2600, 0x27bf), ...range(0x2b00, 0x2bff), ...range(0x1f300, 0x1f5ff), ...range(0x1f680, 0x1f6ff),
];

const FONTS = [
  { file: 'Inter-Regular.ttf', out: 'inter-regular', points: TEXT },
  { file: 'Inter-Bold.ttf', out: 'inter-bold', points: TEXT },
  { file: 'Inter-Italic.ttf', out: 'inter-italic', points: TEXT },
  { file: 'NotoSansMono-Regular.ttf', out: 'noto-sans-mono', points: CODE },
  { file: 'NotoSansSymbols2-Regular.ttf', out: 'noto-sans-symbols2', points: SYMBOLS },
];

const source = process.argv[2];
if (!source) {
  console.error('Uso: node scripts/buildPdfFonts.mjs <carpeta con los .ttf originales>');
  process.exit(1);
}
const outDir = join(import.meta.dirname, '..', 'services', 'export', 'adapters', 'pdf', 'fonts');
for (const { file, out, points } of FONTS) {
  const font = parseTrueType(new Uint8Array(readFileSync(join(source, file))));
  const covered = points.filter((cp) => font.cmap.has(cp));
  const subset = subsetTrueType(font, covered.map((cp) => font.cmap.get(cp)), { renumber: true, codePoints: covered });
  const base64 = Buffer.from(subset).toString('base64').replace(/.{1,100}/g, '$&\n');
  writeFileSync(join(outDir, `${out}.b64`), base64);
  console.log(`${out}: ${covered.length} caracteres, ${(subset.length / 1024).toFixed(1)} KB`);
}
