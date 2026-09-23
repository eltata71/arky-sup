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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CYCLES,
  ALLOWED_SCCS,
  DEEP_IMPORT_BUDGET,
  LAYER_VIOLATION_BUDGET,
  UI_SERVICE_FANOUT_BUDGET,
  UI_SERVICE_FANOUT_DEFAULT,
  ALLOWED_DEPENDENCIES,
  analyse,
  checkDeclaredDependencies,
  checkStronglyConnected,
  moduleOf,
  publicEntries,
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

describe('el verificador ve lo que dice ver', () => {
  // F3-02 (ADR-105). Un gate de fronteras informa de un grafo, y un grafo
  // incompleto no se ve incompleto: se ve sano. Éste tenía dos puntos ciegos, y
  // los dos se comprueban aquí contra dependencias reales del repositorio —no
  // contra un fixture— porque lo que se afirma es justamente que el escáner
  // alcanza el árbol de verdad.

  it('lee un `import()` diferido, que es como el arranque evita la capa de IA', () => {
    // `App.tsx` alcanza cada página sólo con `lazyWithRetry(() => import(...))`:
    // ningún import estático cruza de `app` a `pages`. Si el escáner sólo mirara
    // los imports estáticos, esta arista no existiría — y durante toda la
    // transformación no existió. (El ejemplo anterior, `OfficeContext`
    // cargando `services/ai` en diferido, desapareció con F5-01 corte 8: ahora
    // carga el chat de proyecto de la Oficina, y la arista `context ->
    // services/ai` ya no existe.)
    const appSource = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
    expect(appSource).not.toMatch(/from ['"]\.\/pages\//);
    const { edges } = analyse();
    expect(edges.has('app -> pages')).toBe(true);
    expect(edges.has('context -> services/ai')).toBe(false);
  });

  it('lee un `import()` en posición de tipo, que acopla igual', () => {
    // `Project.architectureKnowledgeGraph` nombra el tipo del grafo con
    // `import('...').T`, y es la única vía por la que `architectureProjects`
    // entra en un fichero interno de ese contexto. No existe en ejecución y
    // acopla exactamente como el `import type` que el gate cuenta desde el
    // primer día; medir uno y no el otro sería decidir que la dependencia cuenta
    // según cómo se escribió. (El ejemplo anterior, `ArtifactTypes` nombrando
    // al compilador, desapareció con F3-07: el resumen de compilación bajó a
    // `lib/artifacts` junto con el Artefacto.)
    const { deepImports } = analyse();
    expect(deepImports.get('services/architectureProjects -> services/architectureKnowledgeGraph')).toBe(1);
  });

  it('abre los ficheros de la raíz, que no son carpeta de nadie', () => {
    expect(moduleOf('types.ts')?.name).toBe('types.ts');
    expect(moduleOf('utils.ts')?.name).toBe('utils.ts');
    expect(moduleOf('App.tsx')?.name).toBe('app');
    // Y el de la raíz no le roba los ficheros a la carpeta del mismo nombre.
    expect(moduleOf('utils/chatHistory.ts')?.name).toBe('utils');
    expect(sourceFiles()).toContain('types.ts');
    expect(sourceFiles()).toContain('utils.ts');
  });

  it('atribuye un import que nombra un fichero de la raíz sin extensión', () => {
    // `from '../types'`, que es como lo escriben los 25 módulos que lo importan.
    const { edges } = analyse();
    expect(edges.has('services/artifacts -> types.ts')).toBe(true);
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

  it('mantiene `lib/` y `utils/` fuera del dominio — cero, y sigue siendo cero', () => {
    const { layerViolations } = analyse();
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
    // Esa mitad se conserva y se afirma por separado de la que F3-02 destapó:
    // mezclarlas habría dejado un test que pasa de cero a siete y no dice cuál
    // de las dos cosas cambió.
    const fromDirectories = [...layerViolations.keys()]
      .filter((pair) => pair.startsWith('lib -> ') || pair.startsWith('utils -> '));
    expect(fromDirectories).toEqual([]);
  });

  it('no deja ningún import ascendente, tampoco desde la raíz', () => {
    // Siete cuando F3-02 los hizo visibles (ADR-105); dos tras F3-08; **cero**
    // desde F3-07.
    //
    // Los cinco que se fueron: tres eran reexportaciones de `types.ts` que
    // nadie consumía salvo los propios módulos dueños (F3-07), y dos eran la
    // composición de prompts que vivía en `utils.ts` bajo nombre de utilidad
    // (F3-08).
    //
    // Los dos últimos eran un solo hecho dicho dos veces: `types.ts`
    // reexportaba `Artifact` y `Project` desde sus contextos. D-4 (ADR-106)
    // decidió la frontera y F3-07 hizo lo que ella permitía: el Artefacto es
    // núcleo compartido —lo lee la fundación y quince contextos— y bajó a
    // `lib/artifacts`; `Project` se importa de su módulo, y las pantallas lo
    // reciben de `context/AppContext`. `types.ts` ya no importa nada.
    //
    // La lista vacía es la afirmación: un par ascendente nuevo falla aquí y en
    // el gate.
    const { layerViolations, edges } = analyse();
    expect([...layerViolations.keys()]).toEqual([]);
    // Y `types.ts` no importa nada: `lib` depende de él, así que cualquier
    // arista que salga de aquí cierra un ciclo en la fundación o sube al
    // dominio. Se afirma por separado porque un import hacia `lib` no es
    // ascendente y no lo vería la línea de arriba.
    expect([...edges.keys()].filter((edge) => edge.startsWith('types.ts -> '))).toEqual([]);
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

  it('ArtifactCanvas, el caso para el que se escribió la regla, ya no está en la tabla', () => {
    // Eran ocho módulos de servicio detrás de un lienzo. La Ola 4 se llevó la
    // orquestación —calidad, preflight, presentación, formatos, exportabilidad
    // y la puerta visual— a `services/artifacts/application/artifactAssessment`
    // y bajó a cinco. F4-05 se llevó el resto —la auto-mejora del diagrama, los
    // artefactos derivados y la mejora con sugerencias— a
    // `artifactImprovement`, y el lienzo quedó en dos: el que cualquier
    // pantalla nueva tiene.
    //
    // Se afirma aquí, y no sólo en el presupuesto, porque este fichero es el
    // ejemplo que `CLAUDE.md` cita: si vuelve a la tabla, lo que se rompió es
    // el argumento.
    const { fanout } = analyse();
    expect(fanout.has('components/ArtifactCanvas.tsx')).toBe(false);
    expect(Object.keys(UI_SERVICE_FANOUT_BUDGET)).not.toContain('components/ArtifactCanvas.tsx');
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

  it('sigue llevando dentro el núcleo de nueve — el objetivo de la fase 5', () => {
    // Nombrado en vez de contado, para que el día que encoja el test diga qué
    // módulo salió. `services/ai -> services (raíz)` es la arista que lo cierra:
    // 16 imports de `services/geminiService` desde dentro de la capa construida
    // para ocultarlo.
    const { sccs } = analyse();
    const domain = sccs.find((component: string[]) => component.includes('services/ai'));
    expect(domain).toContain('services (raíz)');
    expect(domain).toContain('services/architectureOffice');
    expect(domain).toContain('services/architectureProjects');
  });

  it('deja fuera del componente a `types.ts` y a toda la fundación (F3-07)', () => {
    // De nueve módulos a veintisiete el 2026-09-21 sin escribir una línea
    // (F3-02, ADR-105): el verificador aprendió a abrir los ficheros de la raíz.
    // `types.ts` los importan 25 de los 34 módulos y él importa seis, así que
    // cierra el grafo entero — y arrastra dentro a `lib` y `utils`, que son la
    // capa de fundación y no deberían poder volver.
    //
    // Esto se afirma aparte del tamaño porque son dos trabajos distintos:
    // deshacer el reexportador es mover declaraciones, y romper el núcleo de
    // nueve es estrangular un motor de 5 400 líneas. El primero es el barato,
    // y F3-07 lo terminó: de 27 a 14. Que ninguna pieza de la fundación vuelva
    // a entrar es lo que este test impide.
    const { sccs } = analyse();
    const domain = sccs.find((component: string[]) => component.includes('services/ai'));
    for (const foundation of ['types.ts', 'lib', 'utils', 'utils.ts', 'constants.ts']) {
      expect(domain).not.toContain(foundation);
    }
    expect(domain!.length).toBeLessThanOrEqual(14);
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

describe('declared dependencies (F3-03)', () => {
  const run = (edges: string[], declared: Record<string, string[]>) => {
    const failures: string[] = [];
    const notes: string[] = [];
    checkDeclaredDependencies(new Map(edges.map((edge) => [edge, 1])), failures, notes, declared);
    return { failures, notes };
  };

  it('every module in the manifest declares its list', () => {
    const { failures } = run([], ALLOWED_DEPENDENCIES as Record<string, string[]>);
    expect(failures).toEqual([]);
  });

  it('matches the real graph today: no undeclared edge, no stale declaration', () => {
    const { edges } = analyse();
    const failures: string[] = [];
    const notes: string[] = [];
    checkDeclaredDependencies(edges, failures, notes);
    expect(failures).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('refuses an edge nobody declared', () => {
    const declared = { ...(ALLOWED_DEPENDENCIES as Record<string, string[]>), 'services/review': [] };
    const { failures } = run(['services/review -> services/diagram'], declared);
    expect(failures).toContain(
      'dependency: services/review -> services/diagram no está declarada en modules.json → allowedDependencies',
    );
  });

  it('refuses a module that declares nothing, rather than letting it depend on anything', () => {
    const declared = { ...(ALLOWED_DEPENDENCIES as Record<string, string[]>) };
    delete declared['services/review'];
    const { failures } = run([], declared);
    expect(failures).toContain('dependency: services/review no declara sus dependencias en modules.json');
  });

  it('asks for a declaration that no longer exists to be removed, so the list only shrinks', () => {
    const declared = { ...(ALLOWED_DEPENDENCIES as Record<string, string[]>), 'services/review': ['lib'] };
    const { failures, notes } = run([], declared);
    expect(failures).toEqual([]);
    expect(notes).toContain('dependency: services/review -> lib ya no existe. Quítala de allowedDependencies.');
  });

  it('the pilot context depends on nothing in the domain but persistence and adapters', () => {
    // F3-05: el dominio de Iniciativas es puro y su infraestructura habla sólo
    // con la capa de persistencia. Si esta lista crece, alguien acopló el
    // contexto piloto a otro contexto de negocio.
    const declared = (ALLOWED_DEPENDENCIES as Record<string, string[]>)['services/businessInitiatives'];
    expect(declared.filter((name) => name.startsWith('services/')).sort())
      .toEqual(['services/adapters', 'services/persistence']);
  });
});

describe('a module may publish more than one door (F3-06)', () => {
  it('declares the pilot context with its small domain entry', () => {
    const mod = moduleOf('services/businessInitiatives/index.ts');
    expect(publicEntries(mod)).toEqual([
      'services/businessInitiatives/index.ts',
      'services/businessInitiatives/domain/index.ts',
      'services/businessInitiatives/commands.ts',
    ]);
  });

  it('counts the domain entry as a way in, and an internal file as a deep import', () => {
    const { deepImports } = analyse();
    // Los 19 imports que entraban por ficheros internos de `domain/` entran
    // ahora por su puerta: ningún par profundo hacia el contexto piloto.
    for (const [pair] of deepImports) {
      expect(pair.endsWith('-> services/businessInitiatives'), pair).toBe(false);
    }
  });
});
