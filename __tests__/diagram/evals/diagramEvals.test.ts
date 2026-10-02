// @vitest-environment jsdom
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
    INTEGRITY_COUNTERS,
    loadCorpus,
    renderReport,
    runEvalCase,
    summarize,
    templateFor,
    type DiagramEvalCaseResult,
    type DiagramEvalSummary,
} from './diagramEvalHarness';
import { extractIRFromArtifact } from '../../../services/diagram';
import { describeFidelityLoss } from '../../../services/artifacts/application/diagramFidelityReview';

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

    // Plan de diagramas 8.0a: ningún tipo de diagrama queda sin caso.
    it('cubre cada tipo de diagrama del producto', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(22);
        const types = new Set(corpus.map((c) => c.plantilla.tipo));
        for (const type of [
            'mermaid-c4-context', 'mermaid-c4-container', 'mermaid-c4-component', 'mermaid-c4-deployment',
            'mermaid-graph', 'mermaid-sequence', 'mermaid-erd', 'mermaid-state', 'mermaid-gantt',
            'react-flow-graph', 'hybrid-text-diagram',
        ]) expect(types.has(type as never), type).toBe(true);
        for (const c of corpus.filter((x) => x.esperado.defectoConocido)) {
            expect(c.esperado.defectoConocido, c.id).toMatch(/^8\.\d[a-d]?$/);
        }
    });

    it('no llama al modelo más de una vez por caso cuando la respuesta es válida', () => {
        for (const r of results.filter((x) => !x.degradado && !x.defectoConocido)) expect(r.llamadasModelo, r.id).toBe(1);
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

    it('cada diagrama abre en la superficie de su dialecto: notación o lienzo (8.3a)', () => {
        // Una secuencia abre con líneas de vida y bloques, no aplanada a cajas.
        const sequences = results.filter((r) => r.dialectoGuardado === 'sequenceDiagram');
        expect(sequences.length).toBeGreaterThan(0);
        for (const r of sequences) expect(r.vista.inicial, r.id).toBe('notation');
        for (const r of results) expect(r.vista.inicial, `${r.id} (${r.dialectoGuardado})`).toBe(r.vista.esperada);
    });

    it('secuencias, ERD y estados se reescriben desde su IR sin pérdida (8.3b)', () => {
        const notated = results.filter((r) => r.notacionSinPerdida !== null);
        expect(notated.length).toBeGreaterThanOrEqual(5);
        for (const r of notated) expect(r.notacionSinPerdida, `${r.id} (${r.dialectoGuardado})`).toBe(true);
    });

    it('el layout final no solapa nodos ni zonas, y ninguna arista atraviesa un nodo (8.3c, 8.3d)', () => {
        const measured = results.filter((r) => r.geometriaFinal);
        expect(measured.length).toBeGreaterThanOrEqual(15);
        for (const r of measured) {
            expect(r.geometriaFinal, r.id).toMatchObject({ solapesNodos: 0, solapesGrupos: 0, aristasQueAtraviesanNodos: 0 });
        }
    });

    it('reparar no sube la puntuación de ningún caso (8.4a)', () => {
        const measured = results.filter((r) => r.inflacion);
        expect(measured.length).toBeGreaterThanOrEqual(15);
        for (const r of measured) expect(r.inflacion, r.id).toEqual({ estructural: 0, completa: 0 });
    });

    it('la corrección sólo gasta una llamada cuando hay hallazgos', () => {
        for (const r of results) expect(r.llamadasCorreccion, r.id).toBeLessThanOrEqual(1);
    });

    it('la corrección única funciona en C4, flujo y React Flow', () => {
        const corrected = corpus.filter((c) => c.esperado.correccionAplicada && resultOf(c.id).llamadasCorreccion === 1);
        expect(new Set(corrected.map((c) => c.plantilla.tipo))).toEqual(new Set([
            'mermaid-c4-container', 'mermaid-graph', 'react-flow-graph',
        ]));
    });

    it.each(corpus.filter((c) => c.respuestaRefinamiento).map((c) => c.id))(
        '%s rechaza un refinamiento que borra algo pedido',
        (id) => {
            const fixture = corpus.find((c) => c.id === id)!;
            const baseline = fixture.respuestaModelo as string;
            const candidate = fixture.respuestaRefinamiento!;
            const template = templateFor(fixture);
            const parse = (content: string) => extractIRFromArtifact({ content, type: template.type, representation: template.representation });
            expect(describeFidelityLoss(template, baseline, parse(baseline), candidate, parse(candidate)))
                .toMatch(/deja de cumplir lo pedido/);
        },
    );

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

    it.each(corpus.filter((c) => !c.plantilla.tipo.startsWith('mermaid-c4-') && !c.esperado.degradado && !c.esperado.defectoConocido).map((c) => c.id))(
        '%s conserva su dialecto y las entidades pedidas',
        (id) => {
            const r = resultOf(id);
            expect(r.dialectoConservado, r.dialectoGuardado).toBe(true);
            expect(r.entidades.faltantes).toEqual([]);
        },
    );

    // Plan de diagramas 8.2a: lo que se guarda lo acepta la gramática que lo va a dibujar.
    it.each(corpus.filter((c) => !c.esperado.degradado && c.plantilla.tipo !== 'react-flow-graph').map((c) => c.id))(
        '%s se guarda en un texto que Mermaid acepta',
        (id) => {
            const r = resultOf(id);
            expect(r.sintaxis, r.sintaxisError).toBe('valid');
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
        // 8.0b: lo que el pipeline cambia por su cuenta y lo que rompe una edición en el lienzo.
        for (const key of INTEGRITY_COUNTERS) expect(summary[key], key).toBeLessThanOrEqual(actual[key] ?? Number.POSITIVE_INFINITY);
        expect(summary.dialectoTrasEdicion).toBeGreaterThanOrEqual(actual.dialectoTrasEdicion);
        expect(summary.sintaxisValida).toBeGreaterThanOrEqual(actual.sintaxisValida ?? 0);
        expect(summary.vistaFiel).toBeGreaterThanOrEqual(actual.vistaFiel ?? 0);
        expect(summary.notacionSinPerdida).toBeGreaterThanOrEqual(actual.notacionSinPerdida ?? 0);
        expect(summary.casosConContradicciones).toBeLessThanOrEqual(actual.casosConContradicciones);
        // La puntuación la calcula un motor heurístico que evoluciona por su
        // cuenta; se tolera un punto para no convertir cada ajuste suyo en un
        // cambio de línea base.
        expect(summary.calidadMedia).toBeGreaterThanOrEqual(actual.calidadMedia - 1);
    });
});
