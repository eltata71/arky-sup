/**
 * El banco de evaluación de agentes, como gate (plan de agentes, 15.0).
 *
 * Tres clases de afirmación, igual que los bancos de exportación y artefactos:
 *
 * - **El corpus es el que dice ser.** Cinco familias con el mínimo de casos que
 *   pide el plan, escritas a mano y declarándolo.
 * - **Línea base monótona.** Ninguna métrica empeora respecto a
 *   `linea-base.json`. La tarea que mejore una actualiza la línea base en el
 *   mismo commit (`ARKY_AGENT_EVAL_WRITE_BASELINE=1`), con `npm run
 *   eval:agents` para ver la tabla.
 * - **Cada defecto está nombrado.** Toda métrica por debajo de su objetivo la
 *   explica un `defectoConocido` con el hallazgo y la tarea que lo cierra, y
 *   todo defecto conocido sigue midiéndose por debajo del objetivo: cuando una
 *   tarea lo cierra, esta prueba falla hasta que se retira la entrada. Un
 *   defecto resuelto que sigue en la lista es una excusa disponible para el
 *   siguiente.
 *
 * El modelo no se llama nunca: cada caso trae su respuesta.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CORPUS_DIR,
  HANDOFF_REFERENCE_LIMIT,
  LOWER_IS_BETTER,
  TARGETS,
  isFenced,
  loadCorpus,
  meetsTarget,
  renderReport,
  runConsolidation,
  runFencing,
  runHandoffContract,
  runIntent,
  runPinnedPersona,
  runReview,
  runRouting,
  summarize,
  type AgentEvalMetric,
  type AgentEvalResults,
  type AgentEvalSummary,
  type CapturedExecution,
} from './agentEvalHarness';

// El runner produce a través del ejecutor del agente. El doble guarda con qué
// instrucción y con qué `resolvePersona` lo llamó: eso dice quién firmaría la
// tarea, que es lo que mide la familia «persona fijada» (A7).
const captured = vi.hoisted(() => ({ last: null as CapturedExecution | null }));
vi.mock('../../../services/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent')>();
  return {
    ...actual,
    executeAgentAction: vi.fn(async (input: {
      plan: { intent: { userInstruction: string } };
      resolvePersona?: CapturedExecution['resolvePersona'];
    }) => {
      captured.last = { instruction: input.plan.intent.userInstruction, resolvePersona: input.resolvePersona };
      return { status: 'cancelled', messages: ['banco'], errors: [], traceId: 'trace-banco' };
    }),
  };
});

interface KnownDefect {
  id: string;
  hallazgo: string;
  tarea: string;
  metrica: Exclude<AgentEvalMetric, 'llamadasPorOperacion'>;
  descripcion: string;
}

interface Baseline {
  fecha: string;
  actual: AgentEvalSummary;
  defectosConocidos: KnownDefect[];
}

const BASELINE_FILE = join(CORPUS_DIR, 'linea-base.json');
const corpus = loadCorpus();
let results: AgentEvalResults;
let summary: AgentEvalSummary;

const baseline = (): Baseline => JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;

beforeAll(async () => {
  const personaFijada = [];
  for (const testCase of corpus.personaFijada) {
    captured.last = null;
    personaFijada.push(await runPinnedPersona(testCase, () => captured.last));
  }
  const revision = [];
  for (const testCase of corpus.revision) revision.push(await runReview(testCase));
  const consolidacion = [];
  for (const testCase of corpus.consolidacion) consolidacion.push(await runConsolidation(testCase));

  results = {
    enrutado: corpus.enrutado.map(runRouting),
    intencion: corpus.intencion.map(runIntent),
    contratos: corpus.contratos.map(runHandoffContract),
    personaFijada,
    revision,
    consolidacion,
    vallado: await runFencing(),
  };
  summary = summarize(results);

  // Vitest no muestra la consola de una prueba que pasa: el informe va a un
  // fichero que `npm run eval:agents` imprime.
  if (process.env.ARKY_AGENT_EVAL_REPORT) {
    mkdirSync(join(process.cwd(), '.vitest'), { recursive: true });
    writeFileSync(join(process.cwd(), '.vitest', 'eval-agentes.md'), `${renderReport(results, summary)}\n`);
  }
  // Sólo a mano, para escribir una línea base nueva: nunca en CI. Conserva los
  // defectos conocidos, que se editan a mano con su tarea.
  if (process.env.ARKY_AGENT_EVAL_WRITE_BASELINE) {
    const previous = (() => { try { return baseline().defectosConocidos; } catch { return []; } })();
    writeFileSync(BASELINE_FILE, `${JSON.stringify({
      fecha: new Date().toISOString().slice(0, 10),
      actual: summary,
      defectosConocidos: previous,
    }, null, 2)}\n`);
  }
}, 120_000);

describe('el corpus del banco de agentes', () => {
  it('tiene las cinco familias con el mínimo de casos del plan', () => {
    expect(corpus.enrutado.length).toBeGreaterThanOrEqual(20);
    expect(corpus.intencion.length).toBeGreaterThanOrEqual(15);
    expect(corpus.contratos.length + corpus.personaFijada.length).toBeGreaterThanOrEqual(8);
    expect(corpus.revision.length).toBeGreaterThanOrEqual(10);
    expect(corpus.consolidacion.length).toBeGreaterThanOrEqual(5);
  });

  it('cubre los caminos que el plan pide medir', () => {
    expect(corpus.enrutado.some((c) => (c.desactivados ?? []).length > 0)).toBe(true);
    expect(corpus.contratos.some((c) => (c.referencias ?? 0) > HANDOFF_REFERENCE_LIMIT)).toBe(true);
    expect(new Set(corpus.revision.map((c) => (typeof c.critica === 'string' ? c.critica : 'json'))))
      .toEqual(new Set(['json', 'falla', 'texto-roto', 'vacia']));
    expect(new Set(corpus.consolidacion.map((c) => c.camino))).toEqual(new Set(['coordinacion', 'encargo']));
    expect(results.vallado.length).toBeGreaterThanOrEqual(7);
  });

  it('cada sitio de vallado pone de verdad el texto del usuario en el prompt', () => {
    // Un sitio donde el marcador no aparece mediría 100 % sin medir nada.
    expect(results.vallado.filter((r) => !r.presente).map((r) => r.sitio)).toEqual([]);
  });
});

describe('controles del arnés', () => {
  it('reconoce un texto vallado y uno sin vallar', () => {
    const fenced = '<<<CONTENIDO_EXTERNO x\nhola M\nFIN_CONTENIDO_EXTERNO>>>';
    expect(isFenced(fenced, 'M')).toBe(true);
    expect(isFenced(`M\n${fenced}`, 'M')).toBe(false);
    expect(isFenced(`${fenced}\nM`, 'M')).toBe(false);
    expect(isFenced('sin marcador', 'M')).toBe(false);
  });
});

describe('banco de evaluación de agentes', () => {
  it('ninguna métrica empeora respecto a la línea base', () => {
    const before = baseline().actual;
    for (const metric of Object.keys(before) as AgentEvalMetric[]) {
      if (metric === 'llamadasPorOperacion') continue;
      if (LOWER_IS_BETTER.includes(metric)) expect(summary[metric], metric).toBeLessThanOrEqual(before[metric]);
      else expect(summary[metric], metric).toBeGreaterThanOrEqual(before[metric]);
    }
  });

  it('toda métrica bajo su objetivo está explicada por un defecto conocido', () => {
    const known = new Set(baseline().defectosConocidos.map((defect) => defect.metrica));
    const unexplained = (Object.keys(TARGETS) as (keyof typeof TARGETS)[])
      .filter((metric) => !meetsTarget(metric, summary[metric]) && !known.has(metric))
      .map((metric) => `${metric} = ${summary[metric]}`);
    expect(unexplained).toEqual([]);
  });

  it('todo defecto conocido se sigue midiendo bajo su objetivo', () => {
    const fixed = baseline().defectosConocidos
      .filter((defect) => meetsTarget(defect.metrica, summary[defect.metrica]))
      .map((defect) => `${defect.id} (${defect.tarea}): ${defect.metrica} ya cumple; retíralo de defectosConocidos`);
    expect(fixed).toEqual([]);
  });

  it('cada defecto conocido nombra su hallazgo y una tarea del plan', () => {
    for (const defect of baseline().defectosConocidos) {
      expect(defect.hallazgo, defect.id).toMatch(/^A\d+$/);
      expect(defect.tarea, defect.id).toMatch(/^1[5-9]\.\d|^20\.\d/);
    }
  });
});
