/**
 * `estado.sh` bloquea sobre el worktree propio, nunca sobre el de otra
 * tarea -- y el checkout principal sigue siendo un chequeo global (2026-11-13,
 * revisión de Rafael en PR #328, pruebas M1 exigidas).
 *
 * Fixture real, no simulada: un `origin` bare local, un checkout principal
 * clonado de él, y worktrees reales creados con `git worktree add`. `gh` se
 * sustituye por un script que devuelve listas vacías -- no se llama a la red
 * ni al repositorio real en ningún caso.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'scripts/agentes/estado.sh');

let base: string;
let origin: string;
let principal: string;
let ghStubDir: string;

const run = (cwd: string) => {
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, PATH: `${ghStubDir}:${process.env.PATH}` },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', args, { cwd, encoding: 'utf8' });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'arky-estado-sh-'));

  // gh de mentira: pr list (abiertas o fusionadas) siempre vacío.
  ghStubDir = join(base, 'gh-stub');
  mkdirSync(ghStubDir);
  writeFileSync(join(ghStubDir, 'gh'), '#!/usr/bin/env bash\necho "[]"\n');
  chmodSync(join(ghStubDir, 'gh'), 0o755);

  origin = join(base, 'origin.git');
  mkdirSync(origin);
  git(origin, 'init', '--bare', '-q', '-b', 'main');

  const seed = join(base, 'seed');
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'config', 'user.email', 'a@b.c');
  git(seed, 'config', 'user.name', 'Fixture');
  writeFileSync(join(seed, 'README.md'), 'seed\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'inicial');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');

  principal = join(base, 'principal');
  git(base, 'clone', '-q', origin, principal);
  git(principal, 'config', 'user.email', 'a@b.c');
  git(principal, 'config', 'user.name', 'Fixture');

  // origin avanza DESPUÉS de que el worktree exista, para que su base quede
  // "antigua" sin tocarla.
}, 20000);

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('estado.sh: alcance del bloqueo (PR #328)', () => {
  it('bloquea (exit 1) sobre el worktree propio, sucio y antiguo', () => {
    const wtPropio = join(base, 'wt-propio');
    git(principal, 'worktree', 'add', '-q', '-b', 'tarea/propia', wtPropio, 'main');
    // origin avanza: el worktree queda "antigua".
    const seed2 = join(base, 'seed');
    writeFileSync(join(seed2, 'otro.txt'), 'x\n');
    git(seed2, 'add', '.');
    git(seed2, 'commit', '-q', '-m', 'avance de main');
    git(seed2, 'push', '-q', 'origin', 'main');
    writeFileSync(join(wtPropio, 'sin-commitear.txt'), 'x\n');

    const result = run(wtPropio);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('AVISO: cambios sin commit sobre una base anterior a main');
  });

  it('un worktree AJENO sucio y antiguo no bloquea, y emite la línea de máquina', () => {
    const wtPropio = join(base, 'wt-propio-2');
    git(principal, 'worktree', 'add', '-q', '-b', 'tarea/propia-2', wtPropio, 'main');

    // El worktree de la prueba anterior (wt-propio) sigue sucio/antiguo --
    // visto desde ESTE worktree, es ajeno.
    const result = run(wtPropio);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('(sin bloquear — no es tu worktree)');
    expect(result.stdout).toMatch(/WORKTREE_AJENO_SUCIO\tantigua\t.*wt-propio\b/);
  });

  it('el checkout principal sucio bloquea (exit 1) desde cualquier worktree', () => {
    writeFileSync(join(principal, 'sin-commitear-principal.txt'), 'x\n');
    const wtAjeno = join(base, 'wt-propio-2');

    const result = run(wtAjeno);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('AVISO: el checkout principal sólo sigue a main');

    git(principal, 'checkout', '-q', '--', '.');
    spawnSync('rm', ['-f', join(principal, 'sin-commitear-principal.txt')]);
  });
});
