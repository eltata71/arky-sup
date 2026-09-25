/**
 * Specs for the bundle budget.
 *
 * The measurement is the whole value here, so it is the measurement that is
 * tested: which assets count as "eager", and whether the numbers come from the
 * built `index.html` rather than from a hardcoded guess that goes stale the
 * first time chunking changes.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUDGETS,
  ROUTE_BUDGETS_GZIP_KB,
  allChunks,
  eagerAssets,
  forbiddenEagerAssets,
  measure,
  routeDownloads,
} from '../../scripts/checkBundleBudget.mjs';

let dist: string;

const write = (name: string, content: string) => {
  const full = join(dist, name);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
};

/** A payload that is genuinely that big after gzip, not a run of one byte. */
const incompressible = (approxKb: number) => {
  let text = '';
  for (let i = 0; text.length < approxKb * 1024; i += 1) text += `${i.toString(36)}${(i * 7919).toString(36)};`;
  return text;
};

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'arky-bundle-'));
  write('index.html',
    '<!doctype html><html><head>'
    + '<link rel="modulepreload" href="/assets/vendor-react-abc.js">'
    + '<link rel="stylesheet" href="/assets/index-abc.css">'
    + '</head><body><script type="module" src="/assets/index-abc.js"></script></body></html>');
  write('assets/index-abc.js', 'console.log(1);');
  write('assets/vendor-react-abc.js', 'console.log(2);');
  write('assets/index-abc.css', 'body{color:red}');
  write('assets/lazy-Workspace-abc.js', 'console.log(3);');
});

afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe('what counts as eager', () => {
  it('reads the set from index.html rather than assuming it', () => {
    const names = eagerAssets(dist).map((path) => path.split('/').pop());
    expect(names.sort()).toEqual(['index-abc.css', 'index-abc.js', 'vendor-react-abc.js']);
  });

  it('excludes lazy chunks, which a visitor may never download', () => {
    // The distinction the gate exists for: total build output is mostly lazy,
    // so budgeting it would fail on features that cost first paint nothing.
    expect(eagerAssets(dist).some((path) => path.includes('lazy-Workspace'))).toBe(false);
  });

  it('still sees every chunk when asked, so a lazy one cannot explode unnoticed', () => {
    expect(allChunks(dist).map((chunk) => chunk.name)).toContain('lazy-Workspace-abc.js');
  });
});

describe('the measurement', () => {
  it('reports gzip, which is what crosses the wire', () => {
    const body = incompressible(40);
    write('assets/index-abc.js', body);
    const { entryGzipKb, eager } = measure(dist);
    const expected = gzipSync(Buffer.from(body), { level: 9 }).length / 1024;
    expect(entryGzipKb).toBeCloseTo(expected, 1);
    // And raw, so a reviewer can see the compression ratio too.
    expect(eager.find((a) => a.name === 'index-abc.js')!.rawKb).toBeGreaterThan(entryGzipKb);
  });

  it('sums the eager payload rather than reporting only the entry', () => {
    write('assets/index-abc.js', incompressible(30));
    write('assets/vendor-react-abc.js', incompressible(20));
    const { eagerGzipKb, entryGzipKb } = measure(dist);
    expect(eagerGzipKb).toBeGreaterThan(entryGzipKb);
  });

  it('identifies the largest chunk including lazy ones', () => {
    write('assets/lazy-Workspace-abc.js', incompressible(500));
    expect(measure(dist).largestChunk.name).toBe('lazy-Workspace-abc.js');
  });
});

describe('the budgets themselves', () => {
  it('are set close to the measured figures, not left as slack', () => {
    // Slack is not neutral: a budget far above the real number silently
    // permits growth until it is used up.
    expect(BUDGETS.eagerPayloadGzipKb).toBeLessThanOrEqual(600);
    expect(BUDGETS.entryChunkGzipKb).toBeLessThan(400);
  });

  it('budget the entry more tightly than the whole eager payload', () => {
    expect(BUDGETS.entryChunkGzipKb).toBeLessThan(BUDGETS.eagerPayloadGzipKb);
  });
});

describe('lazy-route boundaries', () => {
  it('identifies ReactFlow if it returns to the eager asset set', () => {
    write('index.html',
      '<!doctype html><html><head>'
      + '<link rel="modulepreload" href="/assets/vendor-reactflow-abc.js">'
      + '</head><body><script type="module" src="/assets/index-abc.js"></script></body></html>');
    write('assets/vendor-reactflow-abc.js', 'console.log("canvas");');

    expect(forbiddenEagerAssets(measure(dist).eager).map(({ name }: { name: string }) => name))
      .toEqual(['vendor-reactflow-abc.js']);
  });
});

describe('what each route downloads beyond the eager payload (F6-05)', () => {
  it('counts the route chunk and what it statically imports, minus what boot already loaded', () => {
    write('assets/DashboardPage-abc.js', 'import{a}from"./shared-abc.js";import{b}from"./vendor-react-abc.js";' + incompressible(4));
    write('assets/shared-abc.js', 'import"./heavy-abc.js";' + incompressible(8));
    write('assets/heavy-abc.js', incompressible(30));
    const kb = routeDownloads(dist, ['DashboardPage']).DashboardPage as number;
    const expected = ['DashboardPage-abc.js', 'shared-abc.js', 'heavy-abc.js']
      .map((name) => gzipSync(readFileSync(join(dist, 'assets', name)), { level: 9 }).length / 1024)
      .reduce((sum, value) => sum + value, 0);
    expect(kb).toBeCloseTo(expected, 5);
  });

  it('does not follow dynamic imports: a lazy dependency is not the route\'s cost', () => {
    write('assets/AgentsPage-abc.js', 'const m=()=>import("./ai-abc.js");' + incompressible(2));
    write('assets/ai-abc.js', incompressible(40));
    expect(routeDownloads(dist, ['AgentsPage']).AgentsPage as number).toBeLessThan(10);
  });

  it('reports a route with no chunk as missing, never as zero', () => {
    expect(routeDownloads(dist, ['RenamedPage']).RenamedPage).toBeNull();
  });

  it('holds the landing page and the model-free screens to tight budgets', () => {
    expect(ROUTE_BUDGETS_GZIP_KB.DashboardPage).toBeLessThanOrEqual(60);
    expect(ROUTE_BUDGETS_GZIP_KB.AgentsPage).toBeLessThanOrEqual(50);
    expect(ROUTE_BUDGETS_GZIP_KB.SettingsPage).toBeLessThanOrEqual(30);
  });
});
