/**
 * El banco de evaluación de artefactos, como gate (plan de calidad de
 * artefactos, 7.1c).
 *
 * Igual que el de diagramas, dos clases de afirmación:
 *
 * - **Garantías.** Lo que una ola ya cerró no vuelve: ninguna reescritura que
 *   pierde contenido se acepta, ninguna que se pidió se rechaza (7.1a), y el
 *   copiloto ve entero y cercado lo que puede reescribir (7.1b).
 * - **Línea base monótona.** Los agregados no bajan de `linea-base.json`, y
 *   ninguna celda caso·camino·ámbito que hoy recibe su contexto puede dejar de
 *   recibirlo. Las olas 7.2–7.5 existen para subir estas cifras; la que las
 *   suba actualiza la línea base en el mismo commit, con
 *   `npm run eval:artifacts` para ver la tabla.
 *
 * El modelo no se llama nunca: cada caso trae su respuesta, y el transporte
 * se sustituye por ella.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    CORPUS_DIR,
    loadCorpus,
    renderReport,
    runEvalCase,
    summarize,
    type ArtifactEvalCaseResult,
    type ArtifactEvalSummary,
} from './artifactEvalHarness';

const corpus = loadCorpus();
const BASELINE_FILE = join(CORPUS_DIR, 'linea-base.json');

let results: ArtifactEvalCaseResult[] = [];
let summary: ArtifactEvalSummary;

beforeAll(async () => {
    results = [];
    for (const testCase of corpus) results.push(await runEvalCase(testCase));
    summary = summarize(results);
    // Vitest 5 no muestra la consola de una prueba que pasa: el informe va a un
    // fichero que `npm run eval:artifacts` imprime.
    if (process.env.ARKY_ARTIFACT_EVAL_REPORT) {
        mkdirSync(join(process.cwd(), '.vitest'), { recursive: true });
        writeFileSync(join(process.cwd(), '.vitest', 'eval-artefactos.md'), `${renderReport(results, summary)}\n`);
    }
    // Sólo a mano, y sólo para escribir una línea base nueva: nunca en CI.
    if (process.env.ARKY_ARTIFACT_EVAL_WRITE_BASELINE) {
        writeFileSync(BASELINE_FILE, `${JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), actual: summary }, null, 2)}\n`);
    }
}, 120_000);

const baseline = (): ArtifactEvalSummary =>
    (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { actual: ArtifactEvalSummary }).actual;

describe('banco de evaluación de artefactos', () => {
    it('cubre salud y vida, documentos, una presentación y una conversión', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(8);
        expect(new Set(corpus.map((c) => c.dominio))).toEqual(new Set(['salud', 'vida']));
        const paths = new Set(corpus.flatMap((c) => c.caminos));
        for (const path of ['generar', 'criticar', 'refinar', 'revisar', 'sugerir', 'presentar', 'convertir', 'copiloto']) {
            expect(paths.has(path as never), path).toBe(true);
        }
        expect(corpus.some((c) => (c.seccionesOmitidas ?? []).length > 0)).toBe(true);
        for (const c of corpus) expect(c.origenRespuesta, c.id).toMatch(/redactada-a-mano|capturada/);
    });

    it('7.1a: ninguna reescritura que pierde contenido se acepta, y ninguna pedida se rechaza', () => {
        const wrong = results.flatMap((r) => r.ediciones
            .filter((e) => e.chat !== e.esperado || e.agente !== e.esperado)
            .map((e) => `${r.id} · ${e.edicion}: chat=${e.chat} agente=${e.agente}, se esperaba ${e.esperado}`));
        expect(wrong).toEqual([]);
        expect(results.flatMap((r) => r.ediciones).length).toBeGreaterThanOrEqual(24);
    });

    it('7.1b: el copiloto ve entero, y cercado, el artefacto que puede reescribir', () => {
        const copilot = results.flatMap((r) => r.caminos.filter((p) => p.path === 'copiloto').map((p) => ({ id: r.id, ...p })));
        expect(copilot.length).toBeGreaterThan(0);
        for (const turn of copilot) {
            expect(turn.vistaCompleta, turn.id).toBe(true);
            expect(turn.cercado, turn.id).toBe(true);
        }
    });

    it('ningún agregado baja de la línea base', () => {
        const before = baseline();
        for (const key of ['contextoEntregado', 'vistaCompleta', 'cercado', 'conservacion', 'contratoDetecta'] as const) {
            expect(summary[key], key).toBeGreaterThanOrEqual(before[key]);
        }
        for (const [path, value] of Object.entries(before.porCamino)) {
            expect(summary.porCamino[path as keyof typeof summary.porCamino] ?? 0, path).toBeGreaterThanOrEqual(value ?? 0);
        }
    });

    it('ninguna celda caso·camino·ámbito que recibía su contexto deja de recibirlo', () => {
        const now = new Set(summary.celdasEntregadas);
        expect(baseline().celdasEntregadas.filter((cell) => !now.has(cell))).toEqual([]);
    });
});
