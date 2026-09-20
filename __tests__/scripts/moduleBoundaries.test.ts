/**
 * Specs for the module boundary gate.
 *
 * `modules.json` says what the modules are and how they may depend on each
 * other; `checkModuleBoundaries.mjs` measures it. This checks the measurement,
 * because a boundary gate that silently matches nothing passes forever — which
 * is the same failure mode as the convention it replaced.
 *
 * The four cycles between domain contexts that this gate was written for
 * (`export ↔ quality`, `artifacts ↔ export`, `agent ↔ architectureOffice`,
 * `ai ↔ diagram`) are asserted broken by name. Nothing else in the repository
 * would notice if one came back: they were introduced one import at a time.
 */

import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CYCLES,
  ALLOWED_SCCS,
  DEEP_IMPORT_BUDGET,
  LAYER_VIOLATION_BUDGET,
  UI_SERVICE_FANOUT_BUDGET,
  UI_SERVICE_FANOUT_DEFAULT,
  analyse,
  checkStronglyConnected,
  moduleOf,
  scan,
  sourceFiles,
  stronglyConnectedComponents,
} from '../../scripts/checkModuleBoundaries.mjs';

describe('the gate measures something', () => {
  it('finds the productive tree', () => {
    // A scan over an empty file list passes every rule.
    expect(sourceFiles().length).toBeGreaterThan(500);
  });

  it('maps a file to the most specific module that contains it', () => {
    expect(moduleOf('services/diagram/qualityGate.ts')?.name).toBe('services/diagram');
    // The catch-all must lose to a real module, or every service file would be
    // attributed to the loose-files pseudo-module and the graph would be wrong.
    expect(moduleOf('services/firestoreService.ts')?.name).toBe('services (raíz)');
    expect(moduleOf('lib/security.ts')?.name).toBe('lib');
  });

  it('sees the import graph', () => {
    const { edges } = analyse();
    expect(edges.size).toBeGreaterThan(50);
  });
});

describe('the boundaries hold today', () => {
  it('reports no new cycle, upward import, deep import or UI fan-out', () => {
    const { failures } = scan();
    expect(failures).toEqual([]);
  });
});

describe('the four domain cycles stay broken', () => {
  const BROKEN = [
    'services/export <-> services/quality',
    'services/artifacts <-> services/export',
    'services/agent <-> services/architectureOffice',
    'services/ai <-> services/diagram',
  ];

  it.each(BROKEN)('%s does not exist', (cycle) => {
    const { cycles } = analyse();
    expect(cycles).not.toContain(cycle);
  });

  it.each(BROKEN)('%s is not permitted to come back', (cycle) => {
    // Asserting on the recorded list as well as the measurement: a cycle that
    // reappears *and* gets added to ALLOWED_CYCLES would pass the check above.
    expect(ALLOWED_CYCLES).not.toContain(cycle);
  });
});

describe('the budgets are records, not aspirations', () => {
  it('records no cycle that no longer exists', () => {
    const { cycles } = analyse();
    for (const recorded of ALLOWED_CYCLES) {
      expect(cycles, `${recorded} is recorded and already broken — remove it`).toContain(recorded);
    }
  });

  it('records no budget entry that no longer exists', () => {
    const { deepImports, layerViolations } = analyse();
    for (const key of Object.keys(LAYER_VIOLATION_BUDGET)) {
      expect(layerViolations.has(key), `${key} is recorded and already gone — remove it`).toBe(true);
    }
    for (const key of Object.keys(DEEP_IMPORT_BUDGET)) {
      expect(deepImports.has(key), `${key} is recorded and already gone — remove it`).toBe(true);
    }
  });

  it('records no screen that no longer reaches past the fan-out default', () => {
    const { fanout } = analyse();
    for (const key of Object.keys(UI_SERVICE_FANOUT_BUDGET)) {
      expect(fanout.has(key), `${key} is recorded and already within the default — remove it`).toBe(true);
    }
  });

  it('keeps the foundation layer out of the domain, with nothing recorded', () => {
    const { layerViolations } = analyse();
    const upward = [...layerViolations.keys()];
    // Cero, y este test existe para que siga siéndolo.
    //
    // Eran tres pares y cinco imports. Dos de ellos salían de `lib/validation/`,
    // un reexportador que subía a `services/` para republicar tipos bajo nombres
    // de `lib/` — y al que no importaba ningún fichero del repositorio, ni
    // siquiera una prueba. El tercero era `utils/artifactExploration` pidiendo
    // una ordenación pura a un servicio.
    //
    // La regla que los retiró es la misma en los tres casos y está en CLAUDE.md:
    // un contrato sin comportamiento baja a una hoja. Ahora `lib/artifacts/`
    // declara el vocabulario del pipeline, la clasificación de artefactos, la
    // gobernanza de plantillas y las cinco declaraciones de exportación que
    // faltaban, y los servicios las importan hacia abajo como todo el mundo.
    //
    // Un import ascendente nuevo falla aquí en vez de entrar en una lista que
    // crece.
    expect(upward).toEqual([]);
  });
});

describe('a screen is not the application layer', () => {
  // The rule Wave 4 added: a component that imports one service is using a
  // capability, one that imports eight *is* the orchestration for that screen,
  // written in a file whose job is rendering. Two is the bar for new code; the
  // recorded entries are the census, and each falls when its orchestration
  // moves into an application service the screen calls once.

  it('holds new screens to two service modules', () => {
    expect(UI_SERVICE_FANOUT_DEFAULT).toBe(2);
  });

  it('measures screens rather than every file', () => {
    const { fanout } = analyse();
    for (const file of fanout.keys()) {
      expect(file).toMatch(/^(components|pages)\/.*\.tsx$/);
    }
  });

  it('sigue nombrando a ArtifactCanvas, el caso para el que se escribió la regla', () => {
    // Eran ocho módulos de servicio detrás de un lienzo. La Ola 4 se llevó la
    // orquestación —calidad, preflight, presentación, formatos, exportabilidad
    // y la puerta visual— a `services/artifacts/application/artifactAssessment`
    // y a `hooks/artifacts/useArtifactAssessment`, y bajó a cinco.
    //
    // El número se fija aquí, y no sólo en el presupuesto, porque este fichero
    // es el ejemplo que `CLAUDE.md` cita: si vuelve a subir, lo que se rompió
    // es el argumento.
    expect(UI_SERVICE_FANOUT_BUDGET['components/ArtifactCanvas.tsx']).toBeLessThanOrEqual(5);
  });

  it('leaves AppContext out of it — a context is allowed to compose', () => {
    const { fanout } = analyse();
    expect([...fanout.keys()].some((f) => f.startsWith('context/'))).toBe(false);
  });
});

describe('the gate sees a cycle it cannot reach by pairs', () => {
  // `ALLOWED_CYCLES` answers "do these two import each other?". That is a
  // strictly weaker question than "can this module reach itself?", and the gate
  // spent a whole wave green while nine domain contexts were mutually
  // reachable. These cases are synthetic on purpose: the real graph cannot
  // demonstrate that a three-module cycle is caught, because it would have to
  // contain one.
  const graph = (...edges: string[]) => new Map(edges.map((edge) => [edge, 1]));

  it('finds a three-module cycle no pair reveals', () => {
    const components = stronglyConnectedComponents(graph('a -> b', 'b -> c', 'c -> a'));
    expect(components).toEqual([['a', 'b', 'c']]);
  });

  it('leaves a chain alone', () => {
    expect(stronglyConnectedComponents(graph('a -> b', 'b -> c'))).toEqual([]);
  });

  it('leaves a diamond alone — two paths to the same module are not a cycle', () => {
    expect(stronglyConnectedComponents(
      graph('a -> b', 'a -> c', 'b -> d', 'c -> d'),
    )).toEqual([]);
  });

  it('does not merge two components that share no module', () => {
    const components = stronglyConnectedComponents(
      graph('a -> b', 'b -> a', 'b -> c', 'c -> d', 'd -> c'),
    );
    expect(components).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('ignores a module that only points at itself', () => {
    // `analyse()` never emits a self edge — `to.name === from.name` is skipped
    // — but the detector is the thing being tested, not its caller.
    expect(stronglyConnectedComponents(graph('a -> a'))).toEqual([]);
  });

  it('survives a chain longer than a recursive walk would like', () => {
    // A recursive Tarjan blows the stack at a depth equal to the module count.
    // The manifest has 34 today; the failure would arrive the day it has
    // thousands, as a gate that crashes rather than one that reports.
    const edges: string[] = [];
    for (let i = 0; i < 20000; i += 1) edges.push(`n${i} -> n${i + 1}`);
    edges.push('n20000 -> n0');
    const components = stronglyConnectedComponents(graph(...edges));
    expect(components).toHaveLength(1);
    expect(components[0]).toHaveLength(20001);
  });
});

describe('the strongly connected components are a budget that only falls', () => {
  it('records exactly the components the repository has', () => {
    const { sccs } = analyse();
    expect(sccs.map((component: string[]) => [...component].sort()))
      .toEqual(ALLOWED_SCCS.map((component: string[]) => [...component].sort()));
  });

  it('still carries the nine-module domain component — the target of phase 5', () => {
    // Named rather than counted, so the day it shrinks the test says which
    // module left. `services/ai -> services (raíz)` is the edge that closes it:
    // 12 imports of `services/geminiService` from inside the layer built to
    // hide it.
    const { sccs } = analyse();
    const domain = sccs.find((component: string[]) => component.includes('services/ai'));
    expect(domain).toContain('services (raíz)');
    expect(domain).toContain('services/architectureOffice');
    expect(domain!.length).toBeLessThanOrEqual(9);
  });

  it('keeps the UI component at three — React ordinaria, no un defecto', () => {
    const { sccs } = analyse();
    const ui = sccs.find((component: string[]) => component.includes('components'));
    expect(ui).toEqual(['components', 'context', 'hooks']);
  });

  it('does not record a component the graph no longer has', () => {
    const { sccs } = analyse();
    const measured = new Set(sccs.map((component: string[]) => component.join(' <-> ')));
    for (const recorded of ALLOWED_SCCS) {
      expect(
        measured.has([...recorded].sort().join(' <-> ')),
        `${recorded.join(' <-> ')} is recorded and already broken — remove it`,
      ).toBe(true);
    }
  });
});

describe('the strongly connected budget refuses to be walked past', () => {
  // The positive cases above prove the gate is green today. These prove it
  // would go red — which is the only half that matters, and the half a
  // green-only test suite never checks.
  const run = (measured: string[][], budget: string[][]) => {
    const failures: string[] = [];
    const notes: string[] = [];
    checkStronglyConnected(measured, failures, notes, budget);
    return { failures, notes };
  };

  it('fails when a component appears where none was recorded', () => {
    const { failures } = run([['services/export', 'services/quality']], []);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('sin presupuesto');
    expect(failures[0]).toContain('services/export <-> services/quality');
  });

  it('fails when a recorded component gains a module, and names the module', () => {
    const { failures } = run(
      [['a', 'b', 'c']],
      [['a', 'b']],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('creció con c');
    expect(failures[0]).toContain('2 → 3');
  });

  it('fails when two recorded components merge into one', () => {
    // Overlap matching is what makes this legible: comparing exact sets would
    // report "a new component appeared" and say nothing about the cause.
    const { failures } = run(
      [['a', 'b', 'c', 'd']],
      [['a', 'b'], ['c', 'd']],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('creció con c, d');
  });

  it('passes and asks for the budget to be lowered when a component shrinks', () => {
    const { failures, notes } = run([['a', 'b']], [['a', 'b', 'c']]);
    expect(failures).toEqual([]);
    expect(notes[0]).toContain('salieron c');
    expect(notes[0]).toContain('ALLOWED_SCCS');
  });

  it('passes and asks for the entry to be removed when a component is broken', () => {
    const { failures, notes } = run([], [['a', 'b']]);
    expect(failures).toEqual([]);
    expect(notes[0]).toContain('está roto');
  });

  it('accepts an unchanged component in silence', () => {
    const { failures, notes } = run([['a', 'b']], [['a', 'b']]);
    expect(failures).toEqual([]);
    expect(notes).toEqual([]);
  });
});
