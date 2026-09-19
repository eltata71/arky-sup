#!/usr/bin/env node
/**
 * checkBundleBudget — the bundle does not grow silently.
 *
 * Vite warned at 1.000 kB per chunk and nothing else was measured, which makes
 * size a thing people notice during an incident rather than during review. The
 * app bundles Firebase, Mermaid, Excalidraw, ReactFlow, ELK and a stack of
 * exporters; each addition is small on its own and the total is not.
 *
 * The number that matters is not the total build output — most of it is lazily
 * loaded and a visitor never sees it. It is the **eager payload**: the entry
 * chunk plus the chunks `index.html` preloads, which every visitor downloads
 * before anything renders. That set is read from the built `index.html` rather
 * than guessed, so it stays accurate when chunking changes.
 *
 * Budgets are gzip, because that is what crosses the wire.
 *
 * Set from a measurement with a little headroom, and monotonic in intent: when
 * the figure drops, lower the budget with it. Raising one is a decision that
 * belongs in a review, not a quick fix to make a build pass.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, basename } from 'node:path';

/**
 * Measured 2026-09-06 after taking the AI layer off the boot path: 430.4 KB
 * gzip eager, of which `index` is 192.0. It was 586.9 / 348.6.
 *
 * The 156 KB came off for one reason, and it is the barrel-vs-bundle rule this
 * repository already had written down. `AppContext` reached
 * `ArchitectureProjectRepository` → `projectWrites`, which imported
 * `chatHistoryRepository` through the **`services/chat` barrel**. That barrel
 * exports `chatCompactor`, which value-imports `aiGateway` from the
 * **`services/ai` barrel**, which re-exports `generation`, which reaches
 * `services/geminiService`. So the entire AI layer and the 5 400-line engine
 * were downloaded before the login screen rendered, to obtain one Firestore
 * repository object.
 *
 * Two changes: `projectWrites` enters `services/chat` by file path, and
 * `deterministicCompactionDigest` — a pure, AI-less function that
 * `chatHistoryCap` needs on the persistence path — moved out of the file that
 * calls a model, into `services/chat/compactionDigest.ts`. Same rule as the
 * deterministic artifact fallbacks living in `services/artifacts` rather than
 * behind `services/ai`.
 *
 * Earlier measurement, 2026-09-03, after moving ReactFlow behind Workspace:
 * 580.3 KB eager, `index` 343.3. The previous shared `vendor-graph` chunk made
 * the lazy ReactFlow runtime eager merely because boot also needs Dagre.
 *
 * ReactFlow is a Workspace concern and must remain outside this set. The
 * explicit forbidden-prefix check below protects that architectural boundary
 * even if unrelated reductions would otherwise leave enough numeric slack.
 */
export const BUDGETS = {
  /**
   * Everything `index.html` loads before first paint, gzipped.
   *
   * **F9 bajó esto de 450 a 340, y el margen se ganó retirando Firebase.**
   * Medido: 439,1 → 323,2 KB gz. El chunk `vendor-firebase` pesaba 110,6 y
   * era **eager**, porque `firebase.ts` se inicializaba en el arranque para
   * que `isFirebaseAvailable` respondiera en la primera línea de cualquier
   * repositorio. El SDK de Supabase que lo sustituye pesa 59,3 gz y no está
   * aquí: se importa dinámicamente en `services/adapters`, así que sólo se
   * descarga cuando algo va a hablar con la base de datos — que nunca es antes
   * de pintar la pantalla de inicio de sesión.
   *
   * El presupuesto baja con la mejora en vez de quedarse holgado, que es la
   * regla de todos los presupuestos de este repositorio: un número que ya no
   * mide nada no impide la siguiente regresión.
   */
  eagerPayloadGzipKb: 340,
  /** The entry chunk alone, gzipped. */
  entryChunkGzipKb: 205,
  /**
   * Any single chunk, raw. Catches a lazy chunk exploding — Excalidraw is
   * already 2.4 MB raw, and this stops it (or a sibling) doubling unnoticed.
   */
  largestChunkRawKb: 2500,
};

/** Route-only runtimes that must never be preloaded by the application shell. */
export const FORBIDDEN_EAGER_ASSET_PREFIXES = ['vendor-reactflow-'];

const KB = 1024;
const toKb = (bytes) => bytes / KB;
const gzipKb = (path) => toKb(gzipSync(readFileSync(path), { level: 9 }).length);

/** The assets `index.html` references directly: the entry plus its preloads. */
export function eagerAssets(distDir) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  return [...new Set(refs)].map((ref) => join(distDir, ref));
}

/** Every emitted JavaScript chunk, largest first. */
export function allChunks(distDir) {
  const assets = join(distDir, 'assets');
  if (!existsSync(assets)) return [];
  return readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, path: join(assets, name), rawKb: toKb(readFileSync(join(assets, name)).length) }))
    .sort((a, b) => b.rawKb - a.rawKb);
}

export function measure(distDir) {
  const eager = eagerAssets(distDir).map((path) => ({
    name: basename(path),
    rawKb: toKb(readFileSync(path).length),
    gzipKb: gzipKb(path),
  }));

  const entry = eager.find((asset) => /^index-.*\.js$/.test(asset.name));
  const chunks = allChunks(distDir);

  return {
    eager,
    eagerGzipKb: eager.reduce((sum, asset) => sum + asset.gzipKb, 0),
    entryGzipKb: entry ? entry.gzipKb : 0,
    largestChunk: chunks[0] ?? { name: '(none)', rawKb: 0 },
    chunks,
  };
}

/** Assets whose presence in `index.html` would break a lazy-route boundary. */
export function forbiddenEagerAssets(eager) {
  return eager.filter(({ name }) =>
    FORBIDDEN_EAGER_ASSET_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
}

const fmt = (kb) => `${kb.toFixed(1)} KB`;

function main() {
  const distDir = process.argv[2] ?? 'dist';
  if (!existsSync(distDir)) {
    console.error(`[check:bundle-budget] "${distDir}" not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const { eager, eagerGzipKb, entryGzipKb, largestChunk, chunks } = measure(distDir);

  console.log('Eager payload — downloaded before anything renders:');
  for (const asset of eager) {
    console.log(`  ${fmt(asset.gzipKb).padStart(10)} gz  ${fmt(asset.rawKb).padStart(11)} raw  ${asset.name}`);
  }
  console.log(`  ${fmt(eagerGzipKb).padStart(10)} gz  ${'—'.padStart(11)}      TOTAL\n`);
  console.log('Largest chunks (raw), lazy included:');
  for (const chunk of chunks.slice(0, 5)) console.log(`  ${fmt(chunk.rawKb).padStart(11)}  ${chunk.name}`);

  const failures = [];
  if (eagerGzipKb > BUDGETS.eagerPayloadGzipKb) {
    failures.push(`eager payload ${fmt(eagerGzipKb)} gz exceeds ${fmt(BUDGETS.eagerPayloadGzipKb)}`);
  }
  if (entryGzipKb > BUDGETS.entryChunkGzipKb) {
    failures.push(`entry chunk ${fmt(entryGzipKb)} gz exceeds ${fmt(BUDGETS.entryChunkGzipKb)}`);
  }
  if (largestChunk.rawKb > BUDGETS.largestChunkRawKb) {
    failures.push(`chunk ${largestChunk.name} ${fmt(largestChunk.rawKb)} raw exceeds ${fmt(BUDGETS.largestChunkRawKb)}`);
  }
  const forbiddenEager = forbiddenEagerAssets(eager);
  if (forbiddenEager.length > 0) {
    failures.push(`route-only asset(s) loaded eagerly: ${forbiddenEager.map(({ name }) => name).join(', ')}`);
  }

  if (failures.length > 0) {
    console.error('\n[check:bundle-budget] FAILED');
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      '\nBefore raising a budget, check whether the growth belongs on the critical\n'
      + 'path at all: a route-level `lazyWithRetry` import keeps a feature out of the\n'
      + 'eager set entirely. Raising a number is a review decision, not a build fix.',
    );
    process.exit(1);
  }

  console.log(`\n[check:bundle-budget] OK — eager ${fmt(eagerGzipKb)} gz of ${fmt(BUDGETS.eagerPayloadGzipKb)} budget.`);
}

if (process.argv[1] && process.argv[1].endsWith('checkBundleBudget.mjs')) main();
