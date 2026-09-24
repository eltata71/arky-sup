/**
 * `CLAUDE.md` y `AGENTS.md` dicen las mismas reglas (decisión del propietario,
 * 2026-09-23).
 *
 * `AGENTS.md` es el contrato operativo de Codex/Koder y resume lo que `CLAUDE.md`
 * detalla. Su regla de sincronización decía «si cambia la arquitectura base»,
 * y con esa condición el archivo pasó las fases 3 y 4 enteras —el gate
 * transitivo, las dependencias declaradas, el contexto piloto, el Artefacto como
 * raíz, la escritura única del Proyecto— sin enterarse, mientras `CLAUDE.md` las
 * describía. La mitad de los asistentes trabajaba con las reglas de otra época.
 *
 * Esto no compara textos: cada archivo explica a su manera. Compara **anclas**,
 * los nombres que una regla no puede evitar citar. Una regla nueva en
 * `CLAUDE.md` que merezca estar en los dos añade aquí su ancla, y entonces el
 * gate exige que `AGENTS.md` la nombre.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/** Cada ancla es una regla que las dos guías tienen que conocer. */
const SHARED_ANCHORS: readonly { readonly anchor: string; readonly rule: string }[] = [
  { anchor: 'provision-user', rule: 'el backend es Supabase y su única pieza de servidor' },
  { anchor: 'sqlMatrixParity', rule: 'la matriz de permisos es la misma en cliente y en PostgreSQL' },
  { anchor: 'createArchitectureProject', rule: 'un proyecto sólo nace de su fábrica' },
  { anchor: 'modules.json', rule: 'los módulos declarados y su gate' },
  { anchor: 'allowedDependencies', rule: 'las dependencias entre módulos están declaradas (F3-03)' },
  { anchor: 'budgetTargets', rule: 'los presupuestos tienen objetivo y fecha (F3-04)' },
  { anchor: 'domainPurity', rule: 'el dominio del contexto piloto no hace E/S (F3-05)' },
  { anchor: 'ADR-106', rule: 'el Artefacto es la raíz de su propio agregado' },
  { anchor: 'ProjectRoot', rule: 'la raíz del Proyecto no tiene artefactos (F4-04)' },
  { anchor: 'save_project_aggregate', rule: 'la RPC compuesta está retirada (F4-06)' },
  { anchor: 'retiredRpcs', rule: 'una RPC retirada no vuelve' },
  { anchor: 'noRevisionCache', rule: 'la revisión viaja con el registro (F4-07)' },
  { anchor: 'artifactWorkflow', rule: 'la coordinación de artefactos no vive en React (F4-05)' },
  { anchor: 'legacyTransport', rule: 'el transporte salió del motor y el motor se estrangula por verticales (F5-01)' },
  { anchor: 'engineImporters', rule: 'la lista de importadores del motor sólo encoge' },
  { anchor: 'ArtifactGenerationSupport', rule: 'el motor vive en services/ai y recibe por puerto lo que no puede buscar (F5-01 corte 14)' },
  { anchor: 'SERVICES_ROOT_BUDGET', rule: 'la raíz de services/ no tiene ficheros sueltos' },
  { anchor: 'DiagramSignalSource', rule: 'ningún módulo de dominio es mutuamente alcanzable (F5-03)' },
  { anchor: 'routeCopilotTurn', rule: 'ninguna pantalla supera el fan-out: la regla va a su contexto dueño (F5-02)' },
  { anchor: 'agentRegistry', rule: 'el registro es la única puerta a los agentes' },
  { anchor: 'wrapUntrustedContent', rule: 'lo externo se valla antes de llegar al modelo' },
  { anchor: 'docs/operacion/despliegue.json', rule: 'producción la publica un solo camino' },
];

describe('CLAUDE.md y AGENTS.md cuentan las mismas reglas', () => {
  const claude = read('CLAUDE.md');
  const agents = read('AGENTS.md');

  it.each(SHARED_ANCHORS)('las dos guías conocen: $rule', ({ anchor }) => {
    expect(claude, `CLAUDE.md no nombra ${anchor}`).toContain(anchor);
    expect(agents, `AGENTS.md no nombra ${anchor}`).toContain(anchor);
  });

  it('las dos dicen que se actualizan juntas', () => {
    expect(agents).toMatch(/Todo cambio de `CLAUDE\.md` actualiza `AGENTS\.md`/);
    expect(claude).toMatch(/every change to this file updates `AGENTS\.md`/i);
  });
});
