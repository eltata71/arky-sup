/**
 * El banco de evaluación de diagramas, como gate (plan de diagramas, 6.1).
 *
 * Dos clases de afirmación, y la diferencia importa:
 *
 * - **Garantías por caso.** Un C4 se guarda en su dialecto, con cada metadato,
 *   tecnología e historia que el modelo escribió. No son promedios: un solo
 *   caso que las incumple es el defecto que la 6.1 corrigió, de vuelta.
 * - **Línea base monótona.** El agregado no puede empeorar respecto a
 *   `linea-base.json`. Si un cambio lo mejora, se sube la línea base en el
 *   mismo commit, con `npm run eval:diagrams` para ver las cifras nuevas.
 *
 * El modelo no se llama nunca: cada caso trae su respuesta.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    CORPUS_DIR,
    loadCorpus,
    renderReport,
    runEvalCase,
    summarize,
    type DiagramEvalCaseResult,
    type DiagramEvalSummary,
} from './diagramEvalHarness';

const corpus = loadCorpus();
const baseline = JSON.parse(readFileSync(join(CORPUS_DIR, 'linea-base.json'), 'utf8')) as {
    antes: DiagramEvalSummary;
    actual: DiagramEvalSummary;
};

let results: DiagramEvalCaseResult[] = [];
let summary: DiagramEvalSummary;

beforeAll(async () => {
    results = [];
    for (const testCase of corpus) results.push(await runEvalCase(testCase));
    summary = summarize(results);
    if (process.env.ARKY_DIAGRAM_EVAL_REPORT) {
        console.info(`\n${renderReport(results, summary)}\n`);
    }
}, 120_000);

const resultOf = (id: string) => results.find((r) => r.id === id)!;

describe('banco de evaluación de diagramas', () => {
    it('cubre salud y vida, C4 y otros dialectos', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(10);
        expect(new Set(corpus.map((c) => c.dominio))).toEqual(new Set(['salud', 'vida']));
        expect(corpus.some((c) => c.plantilla.tipo.startsWith('mermaid-c4-'))).toBe(true);
        expect(corpus.some((c) => !c.plantilla.tipo.startsWith('mermaid-c4-'))).toBe(true);
        for (const c of corpus) expect(c.origenRespuesta, c.id).toMatch(/redactada-a-mano|capturada/);
    });

    it('no llama al modelo más de una vez por caso cuando la respuesta es válida', () => {
        for (const r of results) expect(r.llamadasModelo, r.id).toBe(1);
    });

    describe.each(corpus.filter((c) => c.plantilla.tipo.startsWith('mermaid-c4-')).map((c) => c.id))('C4 %s', (id) => {
        it('se guarda en el dialecto C4 que nombra su tipo, no como flowchart', () => {
            const r = resultOf(id);
            expect(r.dialectoConservado, r.dialectoGuardado).toBe(true);
        });

        it('conserva los metadatos y las tecnologías que escribió el modelo', () => {
            const r = resultOf(id);
            expect(r.metadatos.perdidos).toEqual([]);
            if (r.tecnologias) expect(r.tecnologias.conservadas).toBe(r.tecnologias.total);
        });

        it('conserva la historia escrita, sin presentarla como derivada', () => {
            const r = resultOf(id);
            if (r.historiaConservada !== null) expect(r.historiaConservada).toBe(true);
        });

        it('no cae en esqueleto cuando el modelo respondió', () => {
            expect(resultOf(id).esqueleto).toBe(false);
        });
    });

    it.each(corpus.filter((c) => !c.plantilla.tipo.startsWith('mermaid-c4-')).map((c) => c.id))(
        '%s conserva su dialecto y las entidades pedidas',
        (id) => {
            const r = resultOf(id);
            expect(r.dialectoConservado, r.dialectoGuardado).toBe(true);
            expect(r.entidades.faltantes).toEqual([]);
        },
    );

    it('el agregado no empeora respecto a la línea base', () => {
        const actual = baseline.actual;
        expect(summary.casos).toBeGreaterThanOrEqual(actual.casos);
        for (const key of [
            'dialectoConservado',
            'coberturaEntidades',
            'metadatosConservados',
            'tecnologiasConservadas',
            'historiaConservada',
        ] as const) {
            expect(summary[key], key).toBeGreaterThanOrEqual(actual[key]);
        }
        expect(summary.tasaEsqueleto).toBeLessThanOrEqual(actual.tasaEsqueleto);
        // La puntuación la calcula un motor heurístico que evoluciona por su
        // cuenta; se tolera un punto para no convertir cada ajuste suyo en un
        // cambio de línea base.
        expect(summary.calidadMedia).toBeGreaterThanOrEqual(actual.calidadMedia - 1);
    });
});
