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
import type { Artifact, ArtifactBusinessMotivation } from '../../../lib/artifacts';
import { UNTRUSTED_FENCE_OPEN } from '../../../lib/untrustedContent';
import { DOMAIN_PACKS } from '../../../lib/domainPacks';
import { validateInsuranceCompliance } from '../../../services/diagram/insuranceCompliance';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import { runArtifactGeneration } from '../../../services/artifacts/application/artifactGenerationRun';
import { isSkeletonFallbackContent } from '../../../services/artifacts/domain/deterministicArtifactFallbacks';

export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'diagram-evals');

export interface DiagramEvalCase {
    id: string;
    dominio: 'salud' | 'vida';
    origenRespuesta: string;
    proyecto: {
        nombre: string;
        descripcion: string;
        contexto: string[];
        /** Artefactos que ya existen en el proyecto: el nivel C4 superior, por ejemplo. */
        artefactos?: Array<{ nombre: string; tipo: ArtifactType; contenido: string }>;
    };
    /** Lo que el usuario pidió, cuando el artefacto nace de una solicitud (plan 6.2). */
    solicitud?: { texto: string; audiencia?: 'technical' | 'executive' | 'mixed'; criterios?: string[] };
    /** Las iniciativas a las que responde el proyecto. */
    iniciativas?: ArtifactBusinessMotivation[];
    plantilla: {
        nombre: string;
        tipo: ArtifactType;
        objetivo: string;
        conceptosClave: Array<{ term: string; definition: string }>;
    };
    /** El IR (camino C4) o el texto (Mermaid, híbrido) que devolvió el modelo. */
    respuestaModelo: DiagramIR | string | { error: string };
    /** El parche que propone el modelo cuando se le pide corregir (plan 6.3). */
    respuestaCorreccion?: unknown;
    esperado: {
        /** La cabecera que debe abrir el contenido guardado. */
        dialecto: string;
        /** Cada entrada es una lista de alias; basta con que aparezca uno. */
        entidades: string[][];
        metadatos: Array<{ entidad: string[]; campo: keyof DiagramIRNode; valor: string }>;
        /** Nombres del nivel superior que el prompt debe entregar al modelo. */
        nivelSuperior?: string[];
        /** El caso está diseñado para degradarse: lo que se mide es que se diga (6.3). */
        degradado?: boolean;
        /** Fragmentos que deben aparecer en lo que se le dice al usuario. */
        avisos?: string[];
        /** La corrección grabada debe aplicarse y cerrar las brechas de fidelidad. */
        correccionAplicada?: boolean;
        /** Los paquetes de dominio que deben llegar al prompt, y sólo ésos (6.4). */
        paquetes?: string[];
        /** Códigos que el validador de dominio debe encontrar, y los que no. */
        hallazgosDominio?: string[];
        sinHallazgosDominio?: string[];
    };
}

/** Una comprobación de lo que llegó al modelo: qué debía llegar y si llegó. */
export interface PromptCheck {
    que: string;
    ok: boolean;
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
    /** Lo que el prompt debía llevar (idioma, solicitud, criterios, necesidad, nivel superior, cercado). */
    contexto: PromptCheck[];
    /** Instrucciones que contradicen al system prompt o al camino (colores, sintaxis Mermaid en un C4). */
    contradicciones: string[];
    /** Lo que la corrida le dijo al usuario (`onWarning`). */
    avisos: string[];
    /** Veredicto del verificador de fidelidad (0–1), `null` si no hubo nada que verificar. */
    fidelidad: number | null;
    avisosFidelidad: string[];
    /** Llamadas a la vía de corrección (0 o 1). */
    llamadasCorreccion: number;
    degradado: boolean;
    /** Paquetes de dominio que llegaron al prompt (6.4). */
    paquetes: string[];
    /** Códigos del validador de dominio sobre el IR guardado. */
    hallazgosDominio: string[];
    paquetesEsperados?: string[];
    hallazgosEsperados: string[];
    hallazgosProhibidos: string[];
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
    /** Fracción de lo que el modelo debía recibir y recibió (plan 6.2). */
    contextoEntregado: number;
    /** Casos cuyo prompt contiene una instrucción contradictoria. */
    casosConContradicciones: number;
    /** Media del veredicto de fidelidad en los casos no degradados (6.3). */
    fidelidadMedia: number;
    /** De los casos diseñados para degradarse, cuántos se lo dijeron al usuario (6.3). */
    degradacionesAvisadas: number;
    /** Casos cuyo prompt lleva exactamente los paquetes de dominio esperados (6.4). */
    paquetesCorrectos: number;
    /** Hallazgos de dominio esperados que el validador encontró, y ausentes los que no debía (6.4). */
    hallazgosDominioCorrectos: number;
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
        artifacts: (testCase.proyecto.artefactos ?? []).map((artefacto, index) => ({
            id: `prev-${index}`,
            versionGroupId: `grupo-${index}`,
            version: 1,
            createdAt: now,
            name: artefacto.nombre,
            type: artefacto.tipo,
            phase: 'Fase 2: Arquitectura',
            architecturalView: 'Vista Lógica y de Diseño',
            content: artefacto.contenido,
            objective: '',
            keyConcepts: [],
            representation: 'diagram',
        }) as unknown as Artifact),
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
        ...(testCase.solicitud ? {
            requestContext: {
                userRequest: testCase.solicitud.texto,
                audience: testCase.solicitud.audiencia,
                acceptanceCriteria: testCase.solicitud.criterios,
            },
        } : {}),
    } as ArtifactTemplate;
}

/** Ejecuta un caso por el pipeline real, con el modelo sustituido por su respuesta. */
export async function runEvalCase(testCase: DiagramEvalCase): Promise<DiagramEvalCaseResult> {
    const response = typeof testCase.respuestaModelo === 'string'
        ? testCase.respuestaModelo
        : JSON.stringify(testCase.respuestaModelo);
    const transport = vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue(response);
    // La corrección llega por `aiGateway`; sin respuesta grabada, falla como un
    // proveedor caído — nunca sale a la red.
    const correction = vi.spyOn(legacyTransport, 'generateContentWithFallback').mockImplementation(async () => {
        if (testCase.respuestaCorreccion === undefined) throw new Error('sin respuesta de corrección grabada');
        return { text: JSON.stringify(testCase.respuestaCorreccion) } as never;
    });
    const avisos: string[] = [];
    try {
        const result = await runArtifactGeneration({
            project: projectFor(testCase),
            template: templateFor(testCase),
            settings,
            action: 'create',
            operationId: `eval-${testCase.id}`,
            startedAt: '2026-09-29T00:00:00.000Z',
            startedMs: 0,
            businessMotivation: testCase.iniciativas,
            onWarning: (message) => { avisos.push(message); },
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
        if (typeof testCase.respuestaModelo !== 'string' && 'nodes' in testCase.respuestaModelo) {
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

        const [, , firstPrompt, firstConfig] = transport.mock.calls[0] ?? [];
        const prompt = `${String((firstConfig as { systemInstruction?: string } | undefined)?.systemInstruction ?? '')}\n${String(firstPrompt ?? '')}`;
        const { contexto, contradicciones } = checkPrompt(testCase, prompt);

        return {
            id: testCase.id,
            tipo: testCase.plantilla.tipo,
            contexto,
            contradicciones,
            avisos,
            fidelidad: result.fidelity?.score ?? null,
            avisosFidelidad: (result.fidelity?.warnings ?? []).map((w) => w.message),
            llamadasCorreccion: correction.mock.calls.length,
            degradado: Boolean(testCase.esperado.degradado),
            paquetes: DOMAIN_PACKS.filter((pack) => prompt.includes(`PAQUETE DE DOMINIO — ${pack.name}`)).map((pack) => pack.id),
            hallazgosDominio: ir ? validateInsuranceCompliance(ir).map((issue) => issue.code) : [],
            paquetesEsperados: testCase.esperado.paquetes,
            hallazgosEsperados: testCase.esperado.hallazgosDominio ?? [],
            hallazgosProhibidos: testCase.esperado.sinHallazgosDominio ?? [],
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
        correction.mockRestore();
    }
}

/**
 * Lo que un prompt debía llevar, derivado del caso: nada se declara a mano
 * salvo los nombres del nivel superior, que dependen del artefacto previo.
 */
export function checkPrompt(testCase: DiagramEvalCase, prompt: string): { contexto: PromptCheck[]; contradicciones: string[] } {
    const text = normalize(prompt);
    const has = (needle: string) => text.includes(normalize(needle));
    const contexto: PromptCheck[] = [
        { que: 'idioma de salida', ok: /idioma de salida|language: spanish/.test(text) },
        { que: 'contenido del proyecto cercado', ok: prompt.includes(UNTRUSTED_FENCE_OPEN) },
    ];
    if (testCase.solicitud) {
        contexto.push({ que: 'solicitud literal', ok: has(testCase.solicitud.texto) });
        const audience = testCase.solicitud.audiencia;
        if (audience === 'executive' || audience === 'technical') {
            contexto.push({ que: `audiencia ${audience}`, ok: new RegExp(`audience:?\\s*${audience}`).test(text) });
        }
        for (const criterio of testCase.solicitud.criterios ?? []) contexto.push({ que: `criterio «${criterio}»`, ok: has(criterio) });
    }
    for (const iniciativa of testCase.iniciativas ?? []) {
        contexto.push({ que: `necesidad de ${iniciativa.title}`, ok: has(iniciativa.need) });
    }
    for (const nombre of testCase.esperado.nivelSuperior ?? []) {
        contexto.push({ que: `nivel superior «${nombre}»`, ok: has(nombre) });
    }
    const contradicciones: string[] = [];
    if (/fill:#|stroke:#/i.test(prompt)) contradicciones.push('pide colores hex y el system prompt los prohíbe');
    if (testCase.plantilla.tipo.startsWith('mermaid-c4-') && /\bRel\(|argument/.test(prompt)) {
        contradicciones.push('pide sintaxis Mermaid C4 en un camino que devuelve JSON');
    }
    return { contexto, contradicciones };
}

const ratio = (hits: number, total: number): number => (total === 0 ? 1 : hits / total);
const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Agregado micro: cada entidad, metadato y tecnología pesa lo mismo, sea del caso que sea. */
export function summarize(all: DiagramEvalCaseResult[]): DiagramEvalSummary {
    // Los casos diseñados para degradarse miden otra cosa —que se avise— y no
    // entran en los agregados de lo que se conserva.
    const results = all.filter((r) => !r.degradado);
    const degraded = all.filter((r) => r.degradado);
    const fidelityScores = results.map((r) => r.fidelidad).filter((v): v is number => v !== null);
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
        contextoEntregado: round(ratio(
            sum((r) => r.contexto.filter((c) => c.ok).length),
            sum((r) => r.contexto.length),
        )),
        casosConContradicciones: all.filter((r) => r.contradicciones.length > 0).length,
        fidelidadMedia: round(fidelityScores.reduce((a, b) => a + b, 0) / Math.max(1, fidelityScores.length)),
        degradacionesAvisadas: round(ratio(degraded.filter((r) => r.avisos.length > 0).length, degraded.length)),
        paquetesCorrectos: round(ratio(all.filter((r) => r.paquetesEsperados === undefined
            || [...r.paquetes].sort().join() === [...r.paquetesEsperados].sort().join()).length, all.length)),
        hallazgosDominioCorrectos: round(ratio(
            all.reduce((acc, r) => acc + r.hallazgosEsperados.filter((code) => r.hallazgosDominio.includes(code)).length
                + r.hallazgosProhibidos.filter((code) => !r.hallazgosDominio.includes(code)).length, 0),
            all.reduce((acc, r) => acc + r.hallazgosEsperados.length + r.hallazgosProhibidos.length, 0),
        )),
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
        `${r.contexto.filter((c) => c.ok).length}/${r.contexto.length}`,
        r.contradicciones.length ? r.contradicciones.join('; ') : '—',
        r.fidelidad ?? '—',
        r.llamadasCorreccion,
        r.avisos.length ? r.avisos.join(' / ').slice(0, 140) : '—',
        r.paquetes.join(',') || '—',
        r.hallazgosDominio.join(',') || '—',
    ].join(' | '));
    const missing = results.flatMap((r) => r.contexto.filter((c) => !c.ok).map((c) => `  ${r.id}: falta ${c.que}`));
    return [
        'caso | dialecto | entidades | metadatos | tecnologías | historia | esqueleto | calidad | contexto | contradicciones | fidelidad | correcciones | avisos al usuario | paquetes | hallazgos de dominio',
        ...rows,
        '',
        ...(missing.length ? ['Contexto que no llegó al modelo:', ...missing, ''] : []),
        JSON.stringify(summary, null, 2),
    ].join('\n');
}
