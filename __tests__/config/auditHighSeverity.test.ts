import { describe, expect, it } from 'vitest';
import { assessAudit } from '../../scripts/auditHighSeverity.mjs';

const advisory = { url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' };
const report = {
  vulnerabilities: {
    braces: { severity: 'high', via: [advisory], nodes: ['node_modules/braces'] },
    chokidar: { severity: 'high', via: ['braces'], nodes: ['node_modules/chokidar'] },
    tailwindcss: { severity: 'high', via: ['chokidar'], nodes: ['node_modules/tailwindcss'] },
  },
};
const lockfile = {
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
    next.vulnerabilities.braces.via[0].url = 'https://example.test/new';
    expect(assessAudit(next, lockfile, '2026-10-03')).not.toEqual([]);
  });
});
