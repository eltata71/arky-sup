/**
 * Banco de evaluación de diagramas (plan de diagramas, 6.1 — mejora 10).
 *
 * Hasta aquí las pruebas de prompts comprobaban que ciertas cadenas estuvieran
 * en el prompt, que es lo único que no le importa a quien recibe el diagrama.
 * Este banco mide lo que sí: si lo que se guarda conserva el dialecto pedido,
 * las entidades de la petición, los metadatos que el modelo escribió
 * (clasificación PHI/PII/PCI, tecnologías, criticidad) y su historia.
 *
 * Cómo funciona: cada caso de `tests/fixtures/diagram-evals/` trae un proyecto,
 * una plantilla, **la respuesta del modelo** y lo que se espera. El arnés
 * sustituye sólo el transporte (`legacyTransport.generateTextWithFallback`)
 * por esa respuesta, y todo lo demás —el motor, la vertical C4, la compuerta
 * de renderizado, la puerta de calidad y el refinamiento determinista— corre
 * de verdad, con los interruptores de producción.
 *
 * Lo que NO mide, dicho en voz alta: la calidad del modelo. Las respuestas
 * son redactadas a mano como respuestas representativas (cada caso lo declara
 * en `origenRespuesta`). Mide el pipeline, que es lo que un cambio de código
 * puede romper sin que ninguna prueba unitaria lo vea.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { ArtifactTemplate, ArtifactType, Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';
import type { DiagramIR, DiagramIRNode, DiagramNarrative } from '../../../lib/diagram';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import { runArtifactGeneration } from '../../../services/artifacts/application/artifactGenerationRun';
import { isSkeletonFallbackContent } from '../../../services/artifacts/domain/deterministicArtifactFallbacks';

export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'diagram-evals');

export interface DiagramEvalCase {
    id: string;
    dominio: 'salud' | 'vida';
    origenRespuesta: string;
    proyecto: { nombre: string; descripcion: string; contexto: string[] };
    plantilla: {
        nombre: string;
        tipo: ArtifactType;
        objetivo: string;
        conceptosClave: Array<{ term: string; definition: string }>;
    };
    /** El IR (camino C4) o el texto (Mermaid, híbrido) que devolvió el modelo. */
    respuestaModelo: DiagramIR | string;
    esperado: {
        /** La cabecera que debe abrir el contenido guardado. */
        dialecto: string;
        /** Cada entrada es una lista de alias; basta con que aparezca uno. */
        entidades: string[][];
        metadatos: Array<{ entidad: string[]; campo: keyof DiagramIRNode; valor: string }>;
    };
}

export interface DiagramEvalCaseResult {
    id: string;
    tipo: ArtifactType;
    dialectoConservado: boolean;
    dialectoGuardado: string;
    entidades: { cubiertas: number; total: number; faltantes: string[] };
    metadatos: { conservados: number; total: number; perdidos: string[] };
    /** `null` cuando la respuesta no declaraba tecnologías que comparar. */
    tecnologias: { conservadas: number; total: number } | null;
    /** `null` cuando el modelo no escribió historia. */
    historiaConservada: boolean | null;
    esqueleto: boolean;
    calidad: number | null;
    llamadasModelo: number;
}

export interface DiagramEvalSummary {
    casos: number;
    dialectoConservado: number;
    coberturaEntidades: number;
    metadatosConservados: number;
    tecnologiasConservadas: number;
    historiaConservada: number;
    tasaEsqueleto: number;
    calidadMedia: number;
}

export function loadCorpus(): DiagramEvalCase[] {
    return readdirSync(CORPUS_DIR)
        .filter((file) => file.endsWith('.json') && file !== 'linea-base.json')
        .sort()
        .map((file) => JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as DiagramEvalCase);
}

const normalize = (value: unknown): string =>
    String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

const nodeMatches = (node: DiagramIRNode, aliases: string[]): boolean => {
    const haystack = `${normalize(node.label)} ${normalize(node.id)}`;
    return aliases.some((alias) => haystack.includes(normalize(alias)));
};

const findNode = (ir: DiagramIR | null, aliases: string[]): DiagramIRNode | undefined =>
    ir?.nodes.find((node) => nodeMatches(node, aliases));

/** La primera línea con contenido del diagrama guardado (el bloque, si es híbrido). */
export function savedDialect(content: string): string {
    const block = content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] ?? content;
    let inFrontMatter = false;
    for (const raw of block.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('%%')) continue;
        if (line === '---') { inFrontMatter = !inFrontMatter; continue; }
        if (inFrontMatter) continue;
        return line.split(/\s+/)[0];
    }
    return '';
}

const dialectMatches = (saved: string, expected: string): boolean =>
    saved.toLowerCase() === expected.toLowerCase()
    // `graph` y `flowchart` son el mismo dialecto de Mermaid.
    || (expected === 'flowchart' && saved.toLowerCase() === 'graph');

const narrativeOf = (ir: DiagramIR | null | undefined): DiagramNarrative | null => {
    const narrative = ir?.metadata?.narrative;
    return narrative && typeof narrative === 'object' ? narrative as DiagramNarrative : null;
};

const settings = {
    globalContext: [],
    language: 'es',
    theme: 'light',
    aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'profesional', languageStyle: 'es', apiKeySource: 'global' },
} as unknown as Settings;

function projectFor(testCase: DiagramEvalCase): Project {
    const now = '2026-09-29T00:00:00.000Z';
    return {
        id: `eval-${testCase.id}`,
        name: testCase.proyecto.nombre,
        description: testCase.proyecto.descripcion,
        projectContext: testCase.proyecto.contexto,
        artifacts: [],
        createdAt: now,
        updatedAt: now,
    } as unknown as Project;
}

function templateFor(testCase: DiagramEvalCase): ArtifactTemplate {
    const type = testCase.plantilla.tipo;
    return {
        name: testCase.plantilla.nombre,
        type,
        phase: 'Fase 2: Arquitectura',
        architecturalView: 'Vista Lógica y de Diseño',
        objective: testCase.plantilla.objetivo,
        keyConcepts: testCase.plantilla.conceptosClave,
        representation: type === 'hybrid-text-diagram' ? 'hybrid' : 'diagram',
    } as ArtifactTemplate;
}

/** Ejecuta un caso por el pipeline real, con el modelo sustituido por su respuesta. */
export async function runEvalCase(testCase: DiagramEvalCase): Promise<DiagramEvalCaseResult> {
    const response = typeof testCase.respuestaModelo === 'string'
        ? testCase.respuestaModelo
        : JSON.stringify(testCase.respuestaModelo);
    const transport = vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue(response);
    try {
        const result = await runArtifactGeneration({
            project: projectFor(testCase),
            template: templateFor(testCase),
            settings,
            action: 'create',
            operationId: `eval-${testCase.id}`,
            startedAt: '2026-09-29T00:00:00.000Z',
            startedMs: 0,
        });

        const ir = result.ir;
        const dialectoGuardado = savedDialect(result.persistedContent);

        const faltantes = testCase.esperado.entidades
            .filter((aliases) => !findNode(ir, aliases))
            .map((aliases) => aliases[0]);

        const perdidos = testCase.esperado.metadatos
            .filter(({ entidad, campo, valor }) => normalize(findNode(ir, entidad)?.[campo]) !== normalize(valor))
            .map(({ entidad, campo }) => `${entidad[0]}.${String(campo)}`);

        let tecnologias: DiagramEvalCaseResult['tecnologias'] = null;
        let historiaConservada: boolean | null = null;
        if (typeof testCase.respuestaModelo !== 'string') {
            const declared = testCase.respuestaModelo.nodes.filter((node) => node.technology);
            if (declared.length > 0) {
                const conservadas = declared.filter((node) =>
                    normalize(findNode(ir, [node.label])?.technology) === normalize(node.technology)).length;
                tecnologias = { conservadas, total: declared.length };
            }
            const written = narrativeOf(testCase.respuestaModelo);
            if (written?.summary) {
                const saved = narrativeOf(ir);
                historiaConservada = Boolean(saved && saved.source !== 'derived' && saved.summary === written.summary);
            }
        }

        return {
            id: testCase.id,
            tipo: testCase.plantilla.tipo,
            dialectoConservado: dialectMatches(dialectoGuardado, testCase.esperado.dialecto),
            dialectoGuardado,
            entidades: {
                cubiertas: testCase.esperado.entidades.length - faltantes.length,
                total: testCase.esperado.entidades.length,
                faltantes,
            },
            metadatos: {
                conservados: testCase.esperado.metadatos.length - perdidos.length,
                total: testCase.esperado.metadatos.length,
                perdidos,
            },
            tecnologias,
            historiaConservada,
            esqueleto: Boolean(result.skeletonFallbackError) || isSkeletonFallbackContent(result.persistedContent),
            calidad: result.generationTrace.quality?.score ?? null,
            llamadasModelo: transport.mock.calls.length,
        };
    } finally {
        transport.mockRestore();
    }
}

const ratio = (hits: number, total: number): number => (total === 0 ? 1 : hits / total);
const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Agregado micro: cada entidad, metadato y tecnología pesa lo mismo, sea del caso que sea. */
export function summarize(results: DiagramEvalCaseResult[]): DiagramEvalSummary {
    const sum = (pick: (r: DiagramEvalCaseResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
    const withTech = results.filter((r) => r.tecnologias);
    const withStory = results.filter((r) => r.historiaConservada !== null);
    const scored = results.filter((r) => r.calidad !== null);
    return {
        casos: results.length,
        dialectoConservado: round(ratio(results.filter((r) => r.dialectoConservado).length, results.length)),
        coberturaEntidades: round(ratio(sum((r) => r.entidades.cubiertas), sum((r) => r.entidades.total))),
        metadatosConservados: round(ratio(sum((r) => r.metadatos.conservados), sum((r) => r.metadatos.total))),
        tecnologiasConservadas: round(ratio(
            withTech.reduce((acc, r) => acc + r.tecnologias!.conservadas, 0),
            withTech.reduce((acc, r) => acc + r.tecnologias!.total, 0),
        )),
        historiaConservada: round(ratio(withStory.filter((r) => r.historiaConservada).length, withStory.length)),
        tasaEsqueleto: round(ratio(results.filter((r) => r.esqueleto).length, results.length)),
        calidadMedia: round(scored.reduce((acc, r) => acc + (r.calidad ?? 0), 0) / Math.max(1, scored.length)),
    };
}

/** Tabla legible para `npm run eval:diagrams`. */
export function renderReport(results: DiagramEvalCaseResult[], summary: DiagramEvalSummary): string {
    const rows = results.map((r) => [
        r.id,
        `${r.dialectoConservado ? 'sí' : 'NO'} (${r.dialectoGuardado})`,
        `${r.entidades.cubiertas}/${r.entidades.total}`,
        `${r.metadatos.conservados}/${r.metadatos.total}`,
        r.tecnologias ? `${r.tecnologias.conservadas}/${r.tecnologias.total}` : '—',
        r.historiaConservada === null ? '—' : r.historiaConservada ? 'sí' : 'NO',
        r.esqueleto ? 'SÍ' : 'no',
        r.calidad ?? '—',
    ].join(' | '));
    return [
        'caso | dialecto | entidades | metadatos | tecnologías | historia | esqueleto | calidad',
        ...rows,
        '',
        JSON.stringify(summary, null, 2),
    ].join('\n');
}
