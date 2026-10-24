/**
 * Reservar una tarea funciona con cualquier plan que tenga tabla de
 * seguimiento, no sólo con el primero.
 *
 * `nueva-tarea.sh` leía `docs/plan-clase-mundial.md` escrito a mano, así que
 * con ese plan cerrado ninguna tarea de `docs/plan-agentes-ia.md` se podía
 * reservar: el protocolo multiagente dejaba de existir justo para el plan en
 * curso (tarea 15.P). Ahora la tarea se localiza en la lista `PLANES` de
 * `scripts/agentes/comun.sh`, y la rama lleva el prefijo de su plan.
 *
 * Las pruebas ejecutan `localizar-tarea.sh` de verdad, contra planes de
 * prueba (`ARKY_PLANES_DIR`), para no depender de en qué estado esté cada
 * tarea real el día que corren.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/agentes/localizar-tarea.sh';

const PLAN_CLASE_MUNDIAL = `# Plan
## 8. Seguimiento
| Tarea | Estado | PR |
|---|---|---|
| 9.1 DOCX nativo | Hecha | #156 |
| 12.0 Workspace | Pendiente | |
`;

const PLAN_AGENTES = `# Plan de agentes
| 15.0 aparece también en el texto, pero no al inicio de fila de seguimiento |
## 8. Seguimiento
| Tarea | Prioridad · Complejidad | Estado | PR · nota |
|---|---|---|---|
| 15.0 Banco \`agent-evals\` | P0 · L | Pendiente | |
| 15.1 Prompts con identidad | P1 · M | Hecha | #240 |
| 16.7 Agentes de la organización | P3 · L | Descartada | D-A1 = A |
| 12.0 Duplicada a propósito | P2 · S | Pendiente | |
`;

let dir: string;

const localizar = (id: string, env: Record<string, string> = {}) => {
  const result = spawnSync('bash', [SCRIPT, id], {
    encoding: 'utf8',
    env: { ...process.env, ARKY_PLANES_DIR: dir, ...env },
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'arky-planes-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/plan-clase-mundial.md'), PLAN_CLASE_MUNDIAL);
  writeFileSync(join(dir, 'docs/plan-agentes-ia.md'), PLAN_AGENTES);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('localizar-tarea.sh', () => {
  it('localiza una tarea abierta del plan de agentes con su prefijo de rama', () => {
    const result = localizar('15.0');
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('docs/plan-agentes-ia.md|agentes|| 15.0 ')).toBe(true);
  });

  it('se niega a reabrir una tarea Hecha', () => {
    expect(localizar('15.1').status).toBe(1);
    expect(localizar('9.1').status).toBe(1);
  });

  it('se niega a reservar una tarea Descartada', () => {
    const result = localizar('16.7');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cerrada');
  });

  it('dice que una tarea fuera de todos los planes se propone antes', () => {
    const result = localizar('99.9');
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('ningún plan');
  });

  it('no adivina cuando un id está en dos planes', () => {
    expect(localizar('12.0').status).toBe(4);
  });

  it('ARKY_PLAN fija el plan y deshace la ambigüedad', () => {
    const result = localizar('12.0', { ARKY_PLAN: 'docs/plan-clase-mundial.md' });
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('docs/plan-clase-mundial.md|clase-mundial|')).toBe(true);
  });

  it('rechaza el uso sin id', () => {
    expect(localizar('').status).toBe(2);
  });
});

describe('nueva-tarea.sh ya no está atado a un plan', () => {
  const nuevaTarea = readFileSync('scripts/agentes/nueva-tarea.sh', 'utf8');
  const comun = readFileSync('scripts/agentes/comun.sh', 'utf8');

  it('no nombra ningún plan ni prefijo de rama en su código', () => {
    const code = nuevaTarea.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
    expect(code).not.toMatch(/plan-clase-mundial|plan-agentes-ia/);
    expect(code).not.toMatch(/clase-mundial\//);
    expect(code).toContain('localizar-tarea.sh');
  });

  it('cada plan declarado en PLANES existe en el repositorio', () => {
    const planes = [...comun.matchAll(/^\s+"(docs\/[^|"]+)\|([a-z-]+)"$/gm)];
    expect(planes.map(([, plan, prefijo]) => `${plan}|${prefijo}`)).toEqual([
      'docs/plan-clase-mundial.md|clase-mundial',
      'docs/plan-agentes-ia.md|agentes',
      'docs/plan-remediacion-agentes.md|remediacion',
    ]);
    for (const [, plan] of planes) expect(existsSync(plan)).toBe(true);
  });
});
