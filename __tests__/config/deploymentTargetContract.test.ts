import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');
const contract = JSON.parse(read('docs/operacion/despliegue.json')) as {
  repository: string;
  branch: string;
  vercel: { orgId: string; projectName: string; projectId: string; productionUrl: string };
};
const guard = join(root, 'scripts/deploy/assertDeploymentTarget.mjs');

const runGuard = (metadata: string | undefined): { status: number; output: string } => {
  const directory = mkdtempSync(join(tmpdir(), 'arky-deploy-target-'));
  const metadataPath = join(directory, 'project.json');
  try {
    if (metadata !== undefined) writeFileSync(metadataPath, metadata);
    try {
      const output = execFileSync(process.execPath, [guard], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, VERCEL_PROJECT_METADATA_PATH: metadataPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return {
        status: failed.status ?? 1,
        output: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      };
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe('contrato del destino de despliegue', () => {
  it('declara un único repositorio, rama, proyecto, alias y equipo de producción', () => {
    expect(contract.repository).toBe('eltata71/arky-sup');
    expect(contract.branch).toBe('main');
    expect(contract.vercel).toEqual({
      orgId: 'team_HGSWQHORpMV8wQUQf3mAdWEl',
      projectId: 'prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk',
      projectName: 'arky-sup',
      productionUrl: 'https://arky-sup.vercel.app',
    });
  });

  it('keeps the operating instructions synchronized with the deployment contract', () => {
    const documentation = read('docs/operacion/contrato-despliegue.md');
    const claude = read('CLAUDE.md');
    const agents = read('AGENTS.md');

    expect(documentation).toContain('`CLAUDE.md`');
    expect(documentation).toContain('`AGENTS.md`');
    expect(documentation).toContain('`docs/ci-cd-pipeline.md`');
    expect(claude).toContain('`docs/operacion/despliegue.json`');
    expect(agents).toContain('`docs/operacion/despliegue.json`');
  });

  it('keeps CI and its operational documentation aligned with the contract', () => {
    const ci = read('.github/workflows/ci.yml');
    const pipeline = read('docs/ci-cd-pipeline.md');

    expect(ci).toContain('scripts/deploy/assertDeploymentTarget.mjs');
    expect(pipeline).toContain('needs: quality, coverage');
    expect(pipeline).toContain('vercel pull → verifica destino → build');
  });

  it('accepts only metadata that resolves to the canonical Vercel project', () => {
    const result = runGuard(JSON.stringify({
      orgId: contract.vercel.orgId,
      projectId: contract.vercel.projectId,
      projectName: contract.vercel.projectName,
    }));
    expect(result.status).toBe(0);
    expect(result.output).toContain(contract.vercel.productionUrl);
  });

  it.each([
    ['metadata ausente', undefined],
    ['metadata malformada', '{'],
    ['equipo distinto', JSON.stringify({
      orgId: 'team_other',
      projectId: contract.vercel.projectId,
      projectName: contract.vercel.projectName,
    })],
    ['identificador de proyecto distinto', JSON.stringify({
      orgId: contract.vercel.orgId,
      projectId: 'prj_other',
      projectName: contract.vercel.projectName,
    })],
    ['nombre de proyecto distinto', JSON.stringify({
      orgId: contract.vercel.orgId,
      projectId: contract.vercel.projectId,
      projectName: 'other-project',
    })],
  ])('fails closed when %s', (_case, metadata) => {
    const result = runGuard(metadata);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('[deploy-target] ERROR:');
  });
});
