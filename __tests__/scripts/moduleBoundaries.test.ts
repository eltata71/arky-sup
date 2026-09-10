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
  DEEP_IMPORT_BUDGET,
  LAYER_VIOLATION_BUDGET,
  UI_SERVICE_FANOUT_BUDGET,
  UI_SERVICE_FANOUT_DEFAULT,
  analyse,
  moduleOf,
  scan,
  sourceFiles,
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
