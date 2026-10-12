#!/usr/bin/env node
/**
 * buildDictionarySections — parte el diccionario español en un núcleo eager y
 * secciones por ruta (14.6).
 *
 * El español era el diccionario único y eager (R-16=B): 3 485 claves, ~73 KB gz
 * en la carga inicial, de las que el arranque usa unas 300. Aquí se reparten
 * por quién las usa:
 *
 *   core     claves que el código alcanzable desde `index.tsx` nombra, más las
 *            que ningún código nombra (una clave construida a mano no puede
 *            fallar mostrándose como clave en el arranque)
 *   <ruta>   claves que sólo usa una ruta de `App.tsx` (y lo que ésta carga)
 *   shared   claves usadas por dos o más rutas
 *
 * La propiedad se deriva leyendo literales —cadenas y prefijos de plantillas—
 * del grafo de imports. Sobreestima (un literal que coincide con una clave la
 * cuenta), que es la dirección segura: sobra en el núcleo, nunca falta.
 * Lo que falte aun así lo cubre la carga completa en reposo (`spanishStore`).
 *
 *   node scripts/buildDictionarySections.mjs           regenera
 *   node scripts/buildDictionarySections.mjs --check   falla si hay deriva
 *   node scripts/buildDictionarySections.mjs --report  imprime el reparto
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(root, 'lib/i18n/locales/spanish');
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return /\.tsx?$/.test(base) ? base : null;
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

const STATIC_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const cache = new Map();

function importsOf(file, withDynamic) {
  const key = `${file}|${withDynamic}`;
  if (cache.has(key)) return cache.get(key);
  const source = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of source.matchAll(STATIC_RE)) {
    if (m[1]) continue;
    const resolved = resolveSpec(file, m[2]);
    if (resolved) out.push(resolved);
  }
  if (withDynamic) {
    for (const m of source.matchAll(DYNAMIC_RE)) {
      const resolved = resolveSpec(file, m[1]);
      if (resolved) out.push(resolved);
    }
  }
  cache.set(key, out);
  return out;
}

function closure(entries, { withDynamic = false, stop = new Set() } = {}) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || stop.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file, withDynamic)) queue.push(next);
  }
  return seen;
}

const isDictionaryFile = (file) => file.includes(`${path.sep}lib${path.sep}i18n${path.sep}locales${path.sep}`);

function tokensOf(files) {
  const literals = new Set();
  const prefixes = new Set();
  for (const file of files) {
    if (isDictionaryFile(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const value = m[1] ?? m[2] ?? m[3];
      if (value == null) continue;
      if (m[3] != null && value.includes('${')) {
        const prefix = value.split('${')[0];
        if (prefix.length >= 3) prefixes.add(prefix);
      } else literals.add(value);
    }
  }
  return { literals, prefixes };
}

const uses = (tokens, key) => tokens.literals.has(key) || [...tokens.prefixes].some((p) => key.startsWith(p));

async function loadSpanish() {
  const esbuild = await import('esbuild');
  const outfile = path.join(os.tmpdir(), `arky-es-${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(root, 'lib/i18n/locales/es.ts')],
    bundle: true,
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  try {
    return (await import(pathToFileURL(outfile).href)).es;
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

function appRoutes() {
  const app = path.join(root, 'App.tsx');
  const source = fs.readFileSync(app, 'utf8');
  const routes = [];
  const re = /lazyWithRetry\(\s*\(\)\s*=>\s*import\('([^']+)'\)[\s\S]*?chunkName:\s*'([^']+)'/g;
  for (const m of source.matchAll(re)) {
    const file = resolveSpec(app, m[1]);
    if (file) routes.push({ name: m[2], file });
  }
  return routes;
}

export async function partition() {
  const es = await loadSpanish();
  const keys = Object.keys(es);
  const routes = appRoutes();
  const routeFiles = new Set(routes.map((r) => r.file));

  const eagerFiles = closure([path.join(root, 'index.tsx')]);

  // Lo que el código eager carga con import() y no es una ruta de App.tsx se
  // abre sin pasar por `lazyWithRetry`: sus claves no tienen quién las cargue.
  const eagerDynamic = new Set();
  for (const file of eagerFiles) {
    for (const next of importsOf(file, true)) if (!eagerFiles.has(next) && !routeFiles.has(next)) eagerDynamic.add(next);
  }
  const dynamicFiles = closure([...eagerDynamic], { withDynamic: true, stop: new Set([...eagerFiles, ...routeFiles]) });
  const coreTokens = tokensOf(new Set([...eagerFiles, ...dynamicFiles]));

  const routeTokens = routes.map(({ name, file }) => ({
    name,
    tokens: tokensOf(closure([file], { withDynamic: true, stop: eagerFiles })),
  }));

  const sections = { core: {}, shared: {} };
  for (const { name } of routes) sections[name] = {};

  for (const key of keys) {
    if (uses(coreTokens, key)) {
      sections.core[key] = es[key];
      continue;
    }
    const owners = routeTokens.filter(({ tokens }) => uses(tokens, key)).map(({ name }) => name);
    if (owners.length === 0) sections.core[key] = es[key];
    else if (owners.length === 1) sections[owners[0]][key] = es[key];
    else sections.shared[key] = es[key];
  }
  return { sections, total: keys.length, es };
}

const header = (what) =>
  `// GENERADO por scripts/buildDictionarySections.mjs — no editar a mano (14.6).\n`
  + `// ${what}\n`
  + `// Regenerar: npm run i18n:sections\n`;

function renderSection(name, dictionary) {
  const lines = Object.entries(dictionary).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `${header(`Sección «${name}» del diccionario español.`)}import type { Dictionary } from '../../translations';\n\n`
    + `export const section: Dictionary = {\n${lines.join('\n')}\n};\n`;
}

function renderIndex(names) {
  const loaders = names
    .map((n) => `  ${JSON.stringify(n)}: async () => (await import('./${n}')).section,`)
    .join('\n');
  return `${header('Núcleo eager y cargadores de las secciones diferidas.')}import type { Dictionary } from '../../translations';\n`
    + `export { section as esCore } from './core';\n\n`
    + `export const SPANISH_SECTION_LOADERS: Record<string, () => Promise<Dictionary>> = {\n${loaders}\n};\n`;
}

export function render(sections) {
  const files = new Map();
  const lazyNames = Object.keys(sections).filter((n) => n !== 'core').sort();
  for (const name of ['core', ...lazyNames]) {
    if (name !== 'core' && Object.keys(sections[name]).length === 0) continue;
    files.set(`${name}.ts`, renderSection(name, sections[name]));
  }
  const present = lazyNames.filter((n) => files.has(`${n}.ts`));
  files.set('index.ts', renderIndex(present));
  return files;
}

async function main() {
  const mode = process.argv[2];
  const { sections, total } = await partition();
  const gz = (d) => zlib.gzipSync(JSON.stringify(d)).length;

  if (mode === '--report') {
    for (const [name, d] of Object.entries(sections).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length)) {
      console.log(name.padEnd(26), String(Object.keys(d).length).padStart(5), `${(gz(d) / 1024).toFixed(1)} KB gz`);
    }
    console.log('total'.padEnd(26), String(total).padStart(5));
    return;
  }

  const files = render(sections);

  if (mode === '--check') {
    const stale = [];
    const existing = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : [];
    for (const [file, content] of files) {
      const target = path.join(OUT_DIR, file);
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) stale.push(file);
    }
    for (const file of existing) if (!files.has(file)) stale.push(`${file} (sobra)`);
    if (stale.length) {
      console.error(`[i18n:sections] FALLÓ — el diccionario partido no coincide con es.ts y el código:\n  ${stale.join('\n  ')}\nEjecuta: npm run i18n:sections`);
      process.exit(1);
    }
    console.log(`[i18n:sections] OK — ${files.size} ficheros al día (${Object.keys(sections.core).length} claves en el núcleo de ${total}).`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of fs.readdirSync(OUT_DIR)) if (!files.has(file)) fs.rmSync(path.join(OUT_DIR, file));
  for (const [file, content] of files) fs.writeFileSync(path.join(OUT_DIR, file), content);
  console.log(`[i18n:sections] ${files.size} ficheros escritos; núcleo ${Object.keys(sections.core).length} de ${total} claves (${(gz(sections.core) / 1024).toFixed(1)} KB gz).`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
