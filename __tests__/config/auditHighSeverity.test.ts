import { describe, expect, it } from 'vitest';
import { assessAudit } from '../../scripts/auditHighSeverity.mjs';

const advisory = { url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' };
type Vulnerability = { severity: string; via: Array<string | { url: string }>; nodes: string[] };
const report: { vulnerabilities: Record<string, Vulnerability> } = {
  vulnerabilities: {
    braces: { severity: 'high', via: [advisory], nodes: ['node_modules/braces'] },
    chokidar: { severity: 'high', via: ['braces'], nodes: ['node_modules/chokidar'] },
    tailwindcss: { severity: 'high', via: ['chokidar'], nodes: ['node_modules/tailwindcss'] },
  },
};
const lockfile: { packages: Record<string, { dev: boolean }> } = {
  packages: {
    'node_modules/braces': { dev: true },
    'node_modules/chokidar': { dev: true },
    'node_modules/tailwindcss': { dev: true },
  },
};

describe('auditoría de dependencias', () => {
  it('tolera sólo el aviso conocido en la cadena de build antes de caducar', () => {
    expect(assessAudit(report, lockfile, '2026-10-03')).toEqual([]);
    expect(assessAudit(report, lockfile, '2026-11-04')).not.toEqual([]);
  });

  it('falla si la dependencia vulnerable llega a producción', () => {
    const production = structuredClone(lockfile);
    production.packages['node_modules/braces'].dev = false;
    expect(assessAudit(report, production, '2026-10-03')).not.toEqual([]);
  });

  it('falla ante otra alerta alta aunque la excepción siga vigente', () => {
    const next = structuredClone(report);
    Object.assign(next.vulnerabilities, {
      other: { severity: 'high', via: [{ url: 'https://example.test/new' }], nodes: ['node_modules/other'] },
    });
    expect(assessAudit(next, lockfile, '2026-10-03')).not.toEqual([]);
  });

  it('falla si cambia la identidad del aviso de braces', () => {
    const next = structuredClone(report);
    next.vulnerabilities.braces.via = [{ url: 'https://example.test/new' }];
    expect(assessAudit(next, lockfile, '2026-10-03')).not.toEqual([]);
  });
  it('tolera un aviso moderado de build que también cuelga de la cadena', () => {
    const next = structuredClone(report);
    next.vulnerabilities.tailwindcss.via = ['chokidar', 'postcss-selector-parser'];
    next.vulnerabilities['postcss-selector-parser'] = {
      severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-rj75-hqrm-r3gf' }],
      nodes: ['node_modules/postcss-selector-parser'],
    };
    const lock = structuredClone(lockfile);
    lock.packages['node_modules/postcss-selector-parser'] = { dev: true };
    expect(assessAudit(next, lock, '2026-10-07')).toEqual([]);
    lock.packages['node_modules/postcss-selector-parser'].dev = false;
    expect(assessAudit(next, lock, '2026-10-07')).not.toEqual([]);
  });

  it('falla si lo alto no viene de la cadena de braces', () => {
    const next = structuredClone(report);
    next.vulnerabilities.tailwindcss.via = ['postcss-selector-parser'];
    next.vulnerabilities['postcss-selector-parser'] = {
      severity: 'moderate', via: [{ url: 'https://example.test/m' }], nodes: ['node_modules/postcss-selector-parser'],
    };
    const lock = structuredClone(lockfile);
    lock.packages['node_modules/postcss-selector-parser'] = { dev: true };
    expect(assessAudit(next, lock, '2026-10-07')).not.toEqual([]);
  });
});
