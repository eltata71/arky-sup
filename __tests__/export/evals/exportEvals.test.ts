/**
 * El banco de evaluación de exportación, como gate (plan de clase mundial, 9.0).
 *
 * Tres clases de afirmación:
 *
 * - **El corpus es el que dice ser.** Lo que cada caso declara en `esperado`
 *   coincide con lo que el arnés lee en el original, y entre todos cubren los
 *   catorce *layouts*, los siete tipos de bloque y los cinco hallazgos H1–H5.
 * - **Línea base monótona.** Ningún porcentaje baja de `linea-base.json` y
 *   ninguna pérdida sube. Las tareas 9.1–9.3 existen para subir estas cifras;
 *   la que lo haga actualiza la línea base en el mismo commit
 *   (`ARKY_EXPORT_EVAL_WRITE_BASELINE=1`), con `npm run eval:exports` para ver
 *   la tabla.
 * - **Cada defecto está nombrado.** Toda métrica por debajo de su objetivo está
 *   explicada por un `defectoConocido` de la línea base, y todo defecto
 *   conocido sigue midiéndose por debajo del objetivo. Cuando una tarea lo
 *   cierra, esta prueba falla hasta que se quita la entrada: un defecto
 *   resuelto que sigue en la lista es una excusa disponible para el siguiente.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    ALL_LAYOUTS,
    CORPUS_DIR,
    FORMATS,
    LOSS_METRICS,
    METRICS_BY_FORMAT,
    loadCorpus,
    meetsTarget,
    renderReport,
    runEvalCase,
    summarize,
    type EvalFormat,
    type EvalMetric,
    type ExportEvalCaseResult,
    type ExportEvalSummary,
} from './exportEvalHarness';
import { parsePresentationDeck } from '../../../services/presentation';

// jsdom no pinta: el rasterizador devuelve una imagen fija y lo que se mide es
// si el exportador la incrusta.
vi.mock('../../../services/export/utils/mermaidRaster', () => ({
    rasterizeMermaidToPng: async () => ({
        pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        width: 800,
        height: 400,
    }),
    rasterizeMermaidToJpeg: async () => ({
        jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]),
        width: 800,
        height: 400,
    }),
}));

interface KnownDefect {
    id: string;
    tarea: string;
    formato: EvalFormat;
    metrica: EvalMetric;
    descripcion: string;
}

interface Baseline {
    fecha: string;
    actual: ExportEvalSummary;
    defectosConocidos: KnownDefect[];
}

const corpus = loadCorpus();
const BASELINE_FILE = join(CORPUS_DIR, 'linea-base.json');
const readBaseline = (): Baseline => JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;

let results: ExportEvalCaseResult[] = [];
let summary: ExportEvalSummary;

beforeAll(async () => {
    results = [];
    for (const testCase of corpus) results.push(await runEvalCase(testCase));
    summary = summarize(results);
    // Vitest no muestra la consola de una prueba que pasa: el informe va a un
    // fichero que `npm run eval:exports` imprime.
    if (process.env.ARKY_EXPORT_EVAL_REPORT) {
        mkdirSync(join(process.cwd(), '.vitest'), { recursive: true });
        writeFileSync(join(process.cwd(), '.vitest', 'eval-exportacion.md'), `${renderReport(results, summary)}\n`);
    }
    // Sólo a mano, y sólo para escribir una línea base nueva: nunca en CI. Los
    // defectos conocidos se conservan; quitarlos es una decisión de la PR.
    if (process.env.ARKY_EXPORT_EVAL_WRITE_BASELINE) {
        const previous = readBaseline();
        writeFileSync(BASELINE_FILE, `${JSON.stringify({ ...previous, fecha: new Date().toISOString().slice(0, 10), actual: summary }, null, 2)}\n`);
    }
}, 120_000);

describe('banco de evaluación de exportación', () => {
    it('cubre salud y vida, doce artefactos, documentos y decks', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(12);
        expect(new Set(corpus.map((c) => c.dominio))).toEqual(new Set(['salud', 'vida']));
        for (const c of corpus) expect(c.origen, c.id).toMatch(/^redactada-a-mano/);
        const formats = new Set(corpus.flatMap((c) => c.formatos));
        for (const format of FORMATS) expect(formats.has(format), format).toBe(true);
        expect(new Set(corpus.flatMap((c) => c.ejercita))).toEqual(new Set(['H1', 'H2', 'H3', 'H4', 'H5']));
    });

    it('lo que cada caso declara es lo que el original contiene', () => {
        for (const c of corpus) {
            const r = results.find((x) => x.id === c.id);
            expect(r, c.id).toBeDefined();
            if (!r) continue;
            expect(r.original.tablas, `${c.id} tablas`).toBe(c.esperado.tablas);
            expect(r.original.filas, `${c.id} filas`).toBe(c.esperado.filas);
            expect(r.original.encabezados, `${c.id} encabezados`).toBe(c.esperado.encabezados);
            expect(r.original.diagramas, `${c.id} diagramas`).toBe(c.esperado.diagramas);
            expect(r.original.caracteresEspeciales, `${c.id} caracteres`).toBe(c.esperado.caracteresEspeciales ?? 0);
            expect(r.original.notas, `${c.id} notas`).toBe(c.esperado.notas ?? 0);
            expect([...r.original.layouts].sort(), `${c.id} layouts`).toEqual([...(c.esperado.layouts ?? [])].sort());
        }
    });

    it('los decks son JSON que el producto lee sin caer al deck mínimo', () => {
        for (const c of corpus.filter((x) => x.artefacto.tipo.startsWith('presentation-'))) {
            const parsed = parsePresentationDeck(c.artefacto.contenido, { artifactType: c.artefacto.tipo, artifactName: c.artefacto.nombre });
            expect(parsed.usedFallback, c.id).toBe(false);
        }
    });

    it('entre todos los decks están los catorce layouts y los siete tipos de bloque', () => {
        const decks = corpus
            .filter((c) => c.artefacto.tipo.startsWith('presentation-'))
            .map((c) => parsePresentationDeck(c.artefacto.contenido, { artifactType: c.artefacto.tipo, artifactName: c.artefacto.nombre }).deck);
        expect(new Set(decks.flatMap((d) => d.slides.map((s) => s.layout)))).toEqual(new Set(ALL_LAYOUTS));
        expect(new Set(decks.flatMap((d) => d.slides.flatMap((s) => s.contentBlocks.map((b) => b.type)))))
            .toEqual(new Set(['text', 'bullets', 'table', 'diagram', 'imagePlaceholder', 'kpi', 'callout']));
    });

    it('ninguna cifra empeora respecto de la línea base', () => {
        const before = readBaseline().actual;
        for (const format of FORMATS) {
            for (const metric of METRICS_BY_FORMAT[format]) {
                const previous = before[format]?.[metric];
                const now = summary[format][metric];
                if (previous === undefined) continue;
                expect(now, `${format}.${metric}`).toBeDefined();
                if (LOSS_METRICS.includes(metric)) expect(now, `${format}.${metric}`).toBeLessThanOrEqual(previous);
                else expect(now, `${format}.${metric}`).toBeGreaterThanOrEqual(previous);
            }
        }
    });

    it('toda métrica por debajo del objetivo tiene su defecto conocido, y todo defecto conocido sigue abierto', () => {
        const { defectosConocidos } = readBaseline();
        const named = new Set(defectosConocidos.map((d) => `${d.formato}.${d.metrica}`));
        const unexplained: string[] = [];
        for (const format of FORMATS) {
            for (const metric of METRICS_BY_FORMAT[format]) {
                const value = summary[format][metric];
                if (value !== undefined && !meetsTarget(metric, value) && !named.has(`${format}.${metric}`)) {
                    unexplained.push(`${format}.${metric} = ${value}`);
                }
            }
        }
        expect(unexplained).toEqual([]);
        const closed = defectosConocidos
            .filter((d) => {
                const value = summary[d.formato][d.metrica];
                return value === undefined || meetsTarget(d.metrica, value);
            })
            .map((d) => `${d.id} (${d.formato}.${d.metrica}): cerrado por ${d.tarea}, quítalo de la línea base`);
        expect(closed).toEqual([]);
        for (const d of defectosConocidos) expect(d.id, d.descripcion).toMatch(/^H[1-5]$/);
    });
});
