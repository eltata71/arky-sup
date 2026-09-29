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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    // Vitest 5 no muestra la consola de una prueba que pasa: el informe va a un
    // fichero que `npm run eval:diagrams` imprime.
    if (process.env.ARKY_DIAGRAM_EVAL_REPORT) {
        mkdirSync(join(process.cwd(), '.vitest'), { recursive: true });
        writeFileSync(join(process.cwd(), '.vitest', 'eval-diagramas.md'), `${renderReport(results, summary)}\n`);
    }
}, 120_000);

const resultOf = (id: string) => results.find((r) => r.id === id)!;

describe('banco de evaluación de diagramas', () => {
    it('cubre salud y vida, C4 y otros dialectos', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(10);
        expect(new Set(corpus.map((c) => c.dominio))).toEqual(new Set(['salud', 'vida']));
        expect(corpus.some((c) => c.plantilla.tipo.startsWith('mermaid-c4-'))).toBe(true);
        expect(corpus.some((c) => !c.plantilla.tipo.startsWith('mermaid-c4-'))).toBe(true);
        // La 6.2 se mide sobre solicitudes, iniciativas y un nivel C4 superior reales.
        expect(corpus.some((c) => c.solicitud?.audiencia === 'executive')).toBe(true);
        expect(corpus.some((c) => (c.iniciativas ?? []).length > 0)).toBe(true);
        expect(corpus.some((c) => (c.esperado.nivelSuperior ?? []).length > 0)).toBe(true);
        for (const c of corpus) expect(c.origenRespuesta, c.id).toMatch(/redactada-a-mano|capturada/);
    });

    it('no llama al modelo más de una vez por caso cuando la respuesta es válida', () => {
        for (const r of results.filter((x) => !x.degradado)) expect(r.llamadasModelo, r.id).toBe(1);
    });

    // Plan de diagramas 6.3: lo diseñado para degradarse se le dice al usuario.
    it.each(corpus.filter((c) => c.esperado.degradado).map((c) => [c.id, c.esperado.avisos ?? []] as const))(
        '%s se degrada y se lo dice al usuario',
        (id, expected) => {
            const r = resultOf(id);
            expect(r.avisos.length, 'sin aviso al usuario').toBeGreaterThan(0);
            for (const fragment of expected) expect(r.avisos.join(' ')).toContain(fragment);
        },
    );

    it('un modelo que declina por falta de datos no se reintenta: su motivo llega al usuario', () => {
        const declined = corpus.filter((c) => typeof c.respuestaModelo === 'object' && 'error' in c.respuestaModelo);
        expect(declined.length).toBeGreaterThan(0);
        for (const c of declined) {
            const r = resultOf(c.id);
            expect(r.llamadasModelo, c.id).toBe(1);
            expect(r.esqueleto, c.id).toBe(true);
        }
    });

    it.each(corpus.filter((c) => c.esperado.correccionAplicada).map((c) => c.id))(
        '%s se corrige con un parche y cierra la brecha de fidelidad',
        (id) => {
            const r = resultOf(id);
            expect(r.llamadasCorreccion).toBe(1);
            expect(r.entidades.faltantes).toEqual([]);
            // Los criterios se informan como «sin evidencia» y no disparan
            // correcciones; lo que la corrección debe cerrar son los nombres.
            expect(r.avisosFidelidad.filter((m) => !m.startsWith('Sin evidencia del criterio'))).toEqual([]);
        },
    );

    // Plan de diagramas 6.4: el paquete de dominio correcto llega al modelo,
    // y el validador de seguros encuentra lo que debe y nada más.
    it.each(corpus.filter((c) => c.esperado.paquetes).map((c) => [c.id, c.esperado.paquetes ?? []] as const))(
        '%s recibe exactamente sus paquetes de dominio',
        (id, expected) => {
            expect([...resultOf(id).paquetes].sort()).toEqual([...expected].sort());
        },
    );

    it.each(corpus.filter((c) => c.esperado.hallazgosDominio || c.esperado.sinHallazgosDominio).map((c) => c.id))(
        '%s: el validador de dominio encuentra lo que debe',
        (id) => {
            const r = resultOf(id);
            for (const code of r.hallazgosEsperados) expect(r.hallazgosDominio, code).toContain(code);
            for (const code of r.hallazgosProhibidos) expect(r.hallazgosDominio, code).not.toContain(code);
        },
    );

    it('la corrección sólo gasta una llamada cuando hay hallazgos', () => {
        for (const r of results) expect(r.llamadasCorreccion, r.id).toBeLessThanOrEqual(1);
    });

    describe.each(corpus.filter((c) => c.plantilla.tipo.startsWith('mermaid-c4-') && !c.esperado.degradado).map((c) => c.id))('C4 %s', (id) => {
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

    it.each(corpus.map((c) => c.id))('%s entrega al modelo todo su contexto, sin instrucciones contradictorias', (id) => {
        const r = resultOf(id);
        expect(r.contexto.filter((c) => !c.ok).map((c) => c.que)).toEqual([]);
        expect(r.contradicciones).toEqual([]);
    });

    it.each(corpus.filter((c) => !c.plantilla.tipo.startsWith('mermaid-c4-') && !c.esperado.degradado).map((c) => c.id))(
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
            'contextoEntregado',
            'fidelidadMedia',
            'degradacionesAvisadas',
            'paquetesCorrectos',
            'hallazgosDominioCorrectos',
        ] as const) {
            expect(summary[key], key).toBeGreaterThanOrEqual(actual[key]);
        }
        expect(summary.tasaEsqueleto).toBeLessThanOrEqual(actual.tasaEsqueleto);
        expect(summary.casosConContradicciones).toBeLessThanOrEqual(actual.casosConContradicciones);
        // La puntuación la calcula un motor heurístico que evoluciona por su
        // cuenta; se tolera un punto para no convertir cada ajuste suyo en un
        // cambio de línea base.
        expect(summary.calidadMedia).toBeGreaterThanOrEqual(actual.calidadMedia - 1);
    });
});
