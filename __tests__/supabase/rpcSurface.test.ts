import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const productionFiles = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = join(directory, entry);
  if (statSync(path).isDirectory()) return productionFiles(path);
  return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
});

const normalizedSignature = (name: string, args: string): string =>
  `api.${name.toLowerCase()}(${args.toLowerCase().replace(/\s+/g, '')})`;

const authenticatedGrants = (): Set<string> => {
  const live = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const events: Array<{ index: number; kind: 'grant' | 'revoke'; signature: string; roles: string }> = [];
    for (const match of sql.matchAll(/grant\s+execute\s+on\s+function\s+api\.([a-z0-9_]+)\s*\(([^)]*)\)\s+to\s+([^;]+);/gi)) {
      events.push({
        index: match.index,
        kind: 'grant',
        signature: normalizedSignature(match[1], match[2]),
        roles: match[3],
      });
    }
    for (const match of sql.matchAll(/revoke\s+all\s+on\s+function\s+api\.([a-z0-9_]+)\s*\(([^)]*)\)\s+from\s+([^;]+);/gi)) {
      events.push({
        index: match.index,
        kind: 'revoke',
        signature: normalizedSignature(match[1], match[2]),
        roles: match[3],
      });
    }
    for (const event of events.sort((left, right) => left.index - right.index)) {
      if (!/\bauthenticated\b/i.test(event.roles)) continue;
      if (event.kind === 'grant') live.add(event.signature);
      else live.delete(event.signature);
    }
    // One migration applies the same revoke+grant policy through a DO/FOREACH
    // block. Its quoted identity signatures are the contract, not comments.
    if (/foreach\s+fn\s+in\s+array/i.test(sql)
      && /grant execute on function %s to authenticated/i.test(sql)) {
      for (const match of sql.matchAll(/'api\.([a-z0-9_]+)\(([^)]*)\)'/gi)) {
        live.add(normalizedSignature(match[1], match[2]));
      }
    }
  }
  return live;
};

const productionConsumers = (): Map<string, Set<string>> => {
  const found = new Map<string, Set<string>>();
  for (const base of [join(ROOT, 'services'), join(ROOT, 'supabase', 'functions')]) {
    for (const file of productionFiles(base)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:callRpc(?:<[^>]+>)?|\.rpc)\(\s*['"]([a-z0-9_]+)['"]/gi)) {
        if (!found.has(match[1])) found.set(match[1], new Set());
        found.get(match[1])!.add(relative(ROOT, file));
      }
    }
  }
  return found;
};

describe('superficie RPC concedida frente a consumidores de producción', () => {
  it('no deja una concesión authenticated sin consumidor', () => {
    const consumers = productionConsumers();
    const orphaned = [...authenticatedGrants()]
      .filter((signature) => !consumers.has(signature.slice(4, signature.indexOf('('))))
      .sort();
    expect(orphaned).toEqual([]);
  });

  it('no deja llamadas de cliente sin una concesión compatible', () => {
    const grantedNames = new Set([...authenticatedGrants()].map((signature) =>
      signature.slice(4, signature.indexOf('('))));
    const clientCalls = [...productionConsumers().entries()]
      .filter(([, paths]) => [...paths].some((path) => path.startsWith('services/')))
      .map(([name]) => name);
    const withoutGrant = clientCalls.filter((name) => !grantedNames.has(name)).sort();
    expect(withoutGrant).toEqual([]);
  });

  it('mantiene cerrada toda la superficie api para anon', () => {
    const violations: string[] = [];
    for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const match of sql.matchAll(/grant\s+execute\s+on\s+function\s+api\.([a-z0-9_]+)\s*\(([^)]*)\)\s+to\s+anon/gi)) {
        violations.push(`${file}: ${normalizedSignature(match[1], match[2])}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
