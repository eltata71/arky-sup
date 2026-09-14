import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rewrite = { source?: string; destination?: string };

function matchesSource(source: string, path: string): boolean {
  // Traduce el subconjunto de sintaxis de rewrites de Vercel que usamos
  // (grupos de captura y negative lookahead) a RegExp de JS para el test.
  const anchored = `^${source}$`;
  return new RegExp(anchored).test(path);
}

describe('Vercel API routes are not shadowed by the SPA fallback', () => {
  it('leaves /api/* out of every rewrite to /', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      rewrites?: Rewrite[];
    };

    const rewrites = config.rewrites ?? [];
    expect(rewrites.length).toBeGreaterThan(0);

    for (const rewrite of rewrites) {
      if (rewrite.destination !== '/') continue;
      expect(rewrite.source).toBeDefined();
      expect(matchesSource(rewrite.source!, '/api/ai')).toBe(false);
      expect(matchesSource(rewrite.source!, '/api/gemini')).toBe(false);
      // El fallback SPA debe seguir capturando rutas de la app.
      expect(matchesSource(rewrite.source!, '/dashboard')).toBe(true);
    }
  });
});
