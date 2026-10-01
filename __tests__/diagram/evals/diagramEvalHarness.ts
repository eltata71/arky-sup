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
import { planCanvasEdit } from '../../../services/artifacts/application/diagramCanvasEdit';
import { extractIRFromArtifact, resolveRenderableDiagram } from '../../../services/diagram';
import { checkMermaidSyntax } from '../../../services/diagram/mermaidSyntax';
import { resolveGroupSemanticStyle } from '../../../services/diagram/groupSemantics';
import { computeLayoutQuality, type GroupRect, type NodeRect } from '../../../services/diagram/layoutQualityService';

export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'diagram-evals');

export interface DiagramEvalCase {
    id: string;
    dominio: 'salud' | 'vida';
    /** Por qué existe el caso, cuando mide un defecto concreto (plan de diagramas, 8.0). */
    proposito?: string;
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
        /**
         * La tarea del plan de diagramas que corrige un defecto que este caso
         * expone hoy (8.0). Sus garantías por caso no se exigen hasta entonces;
         * los agregados sí lo cuentan, que es lo que lo hace visible.
         */
        defectoConocido?: string;
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
    /** Lo que dice la gramática de Mermaid del texto guardado (8.2a); `null` en React Flow. */
    sintaxis: 'valid' | 'invalid' | 'unavailable' | null;
    sintaxisError?: string;
    defectoConocido?: string;
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
    /** Lo que el pipeline cambió por su cuenta respecto a la respuesta del modelo (8.0b); `null` sin respuesta comparable. */
    integridad: IntegrityMetrics | null;
    /** Lo que ocurre al mover un nodo en el lienzo (8.0b). */
    edicion: CanvasEditMetrics | null;
    /** La geometría del primer render, el síncrono que ve el usuario (8.0b). */
    geometria: GeometryMetrics | null;
}

/** Lo que el pipeline añadió o cambió sin que el modelo ni la persona lo pidieran. */
export interface IntegrityMetrics {
    /** Nodos guardados que no estaban en la respuesta del modelo. */
    elementosInventados: string[];
    /** Grupos guardados que el modelo no declaró. */
    gruposInventados: string[];
    /** Relaciones del modelo que no se guardaron con sus extremos y su etiqueta. */
    aristasAlteradas: string[];
    /** Relaciones guardadas entre extremos que el modelo nunca conectó (8.1b). */
    aristasInventadas: string[];
    /** Nodos que el modelo dejó sin descripción y se guardaron con una. */
    descripcionesSinteticas: number;
    /** Nodos que el lienzo pinta (vista técnica) y no existen en lo guardado. */
    nodosRenderNoGuardados: string[];
}

export interface CanvasEditMetrics {
    /** El texto sigue en su dialecto tras mover un nodo en la vista técnica. */
    dialectoTrasEdicion: boolean;
    dialectoGuardadoTrasEdicion: string;
    /** Nodos guardados que desaparecen del IR al mover un nodo, por audiencia. */
    nodosPerdidos: { tecnica: string[]; ejecutiva: string[] };
    /** Nodos que aparecen en el IR al mover un nodo, por audiencia. */
    nodosAnadidos: { tecnica: string[]; ejecutiva: string[] };
}

export interface GeometryMetrics {
    solapesNodos: number;
    solapesGrupos: number;
    /**
     * Aristas cuyo segmento recto entre centros atraviesa otro nodo. Es una
     * aproximación: el lienzo dibuja curvas de asa a asa; mide la misma
     * disposición, no el trazo exacto.
     */
    aristasQueAtraviesanNodos: number;
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
    // ── 8.0b: integridad y presentación. Los contadores sólo pueden bajar. ──
    /** Nodos que el pipeline añadió por su cuenta, sumados en todo el corpus. */
    elementosInventados: number;
    gruposInventados: number;
    aristasAlteradas: number;
    aristasInventadas: number;
    descripcionesSinteticas: number;
    /** Nodos que el lienzo pinta y no están guardados. */
    nodosRenderNoGuardados: number;
    /** Fracción de casos cuyo texto conserva el dialecto tras mover un nodo. */
    dialectoTrasEdicion: number;
    /** Nodos guardados que se pierden al mover un nodo (técnica + ejecutiva). */
    nodosPerdidosPorEdicion: number;
    /** Nodos que aparecen en el IR al mover un nodo (técnica + ejecutiva). */
    nodosAnadidosPorEdicion: number;
    solapesNodos: number;
    solapesGrupos: number;
    aristasQueAtraviesanNodos: number;
    /** Fracción de textos guardados que la gramática de Mermaid acepta (8.2a). */
    sintaxisValida: number;
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
    // React Flow se guarda como JSON: su «dialecto» es abrir un objeto.
    || (expected === '{' && saved.startsWith('{'))
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

// ── 8.0b: integridad, edición en el lienzo y geometría ─────────────────────

/** El diagrama tal y como lo devolvió el modelo, para compararlo con lo guardado. */
function modelIRFor(testCase: DiagramEvalCase): DiagramIR | null {
    const response = testCase.respuestaModelo;
    let ir: DiagramIR | null;
    if (typeof response !== 'string') {
        if ('error' in response) return null;
        ir = { ...response, groups: response.groups ?? [] };
    } else {
        const template = templateFor(testCase);
        ir = extractIRFromArtifact({ content: response, representation: template.representation, type: template.type });
    }
    return ir ? withRecordedCorrection(ir, testCase.respuestaCorreccion) : null;
}

/** Lo que añade la corrección grabada también lo escribió el modelo: no cuenta como invención. */
function withRecordedCorrection(ir: DiagramIR, correction: unknown): DiagramIR {
    const operations = (correction as { operations?: Array<{ op?: string; node?: DiagramIRNode; edge?: DiagramIR['edges'][number] }> } | undefined)?.operations ?? [];
    return {
        ...ir,
        nodes: [...ir.nodes, ...operations.flatMap((o) => (o.op === 'add-node' && o.node ? [o.node] : []))],
        edges: [...ir.edges, ...operations.flatMap((o) => (o.op === 'add-edge' && o.edge ? [o.edge] : []))],
    };
}

const labelKey = (node: { label?: string; id: string } | undefined): string =>
    normalize(node?.label || node?.id);

export function measureIntegrity(
    modelIR: DiagramIR,
    savedIR: DiagramIR,
    renderIR: DiagramIR | null,
): IntegrityMetrics {
    const modelLabels = new Set(modelIR.nodes.map(labelKey));
    const modelIds = new Set(modelIR.nodes.map((n) => n.id));
    const elementosInventados = savedIR.nodes
        .filter((n) => !modelIds.has(n.id) && !modelLabels.has(labelKey(n)))
        .map((n) => n.label || n.id);

    const modelGroups = new Set((modelIR.groups ?? []).map((g) => normalize(g.label)));
    // Un subgraph de Mermaid nombra su grupo en los nodos aunque no lo declare aparte.
    for (const node of modelIR.nodes) if (node.group) modelGroups.add(normalize(node.group));
    const gruposInventados = (savedIR.groups ?? [])
        .filter((g) => !modelGroups.has(normalize(g.label)))
        .map((g) => g.label);

    const labelOf = (ir: DiagramIR, id: string) => labelKey(ir.nodes.find((n) => n.id === id) ?? { id });
    const savedEdges = new Set(savedIR.edges.map((e) => `${labelOf(savedIR, e.source)}→${labelOf(savedIR, e.target)}::${normalize(e.label)}`));
    const aristasAlteradas = modelIR.edges
        .filter((e) => !savedEdges.has(`${labelOf(modelIR, e.source)}→${labelOf(modelIR, e.target)}::${normalize(e.label)}`))
        .map((e) => `${labelOf(modelIR, e.source)} → ${labelOf(modelIR, e.target)} «${e.label ?? ''}»`);
    const modelPairs = new Set(modelIR.edges.map((e) => `${labelOf(modelIR, e.source)}→${labelOf(modelIR, e.target)}`));
    const aristasInventadas = savedIR.edges
        .map((e) => `${labelOf(savedIR, e.source)}→${labelOf(savedIR, e.target)}`)
        .filter((pair) => !modelPairs.has(pair));

    const undescribed = new Set(modelIR.nodes.filter((n) => !n.description?.trim()).map(labelKey));
    const descripcionesSinteticas = savedIR.nodes
        .filter((n) => undescribed.has(labelKey(n)) && Boolean(n.description?.trim())).length;

    const savedIds = new Set(savedIR.nodes.map((n) => n.id));
    const nodosRenderNoGuardados = (renderIR?.nodes ?? [])
        .filter((n) => !savedIds.has(n.id))
        .map((n) => n.label || n.id);

    return { elementosInventados, gruposInventados, aristasAlteradas, aristasInventadas, descripcionesSinteticas, nodosRenderNoGuardados };
}

/** Mueve el primer nodo del lienzo 40 px, como un arrastre, y devuelve lo que escribe la pantalla. */
function simulateDrag(artifact: Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>, audience: 'technical' | 'executive'): Partial<Artifact> {
    const rendered = resolveRenderableDiagram(artifact, { audience });
    const before = { nodes: rendered.reactFlow.nodes.filter((n) => n.type !== 'groupZone'), edges: rendered.reactFlow.edges };
    const after = {
        ...before,
        nodes: before.nodes.map((n, index) => (index === 0 ? { ...n, position: { x: n.position.x + 40, y: n.position.y } } : n)),
    };
    return planCanvasEdit(artifact, { before, after }).patch ?? {};
}

export function measureCanvasEdit(
    artifact: Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>,
    expectedDialect: string,
): CanvasEditMetrics {
    const savedIds = new Set((artifact.ir?.nodes ?? []).map((n) => n.id));
    const diff = (patchIR: DiagramIR | undefined) => {
        // Sin IR en la escritura, el modelo guardado no cambió.
        const after = new Set((patchIR ?? artifact.ir)?.nodes.map((n) => n.id) ?? []);
        return {
            perdidos: [...savedIds].filter((id) => !after.has(id)),
            anadidos: [...after].filter((id) => !savedIds.has(id)),
        };
    };
    const technical = simulateDrag(artifact, 'technical');
    const executive = simulateDrag(artifact, 'executive');
    const t = diff(technical.ir);
    const e = diff(executive.ir);
    const dialectoGuardadoTrasEdicion = savedDialect(technical.content ?? artifact.content);
    return {
        dialectoTrasEdicion: dialectMatches(dialectoGuardadoTrasEdicion, expectedDialect),
        dialectoGuardadoTrasEdicion,
        nodosPerdidos: { tecnica: t.perdidos, ejecutiva: e.perdidos },
        nodosAnadidos: { tecnica: t.anadidos, ejecutiva: e.anadidos },
    };
}

/** Geometría del render síncrono (dagre), con las zonas de grupo que pinta el lienzo. */
export function measureGeometry(
    artifact: Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>,
): GeometryMetrics | null {
    const rendered = resolveRenderableDiagram(artifact, { audience: 'technical' });
    const content = rendered.reactFlow.nodes.filter((n) => n.type !== 'groupZone');
    if (!rendered.ir || content.length === 0) return null;
    const dims = (n: (typeof content)[number]) => {
        const data = (n.data ?? {}) as { width?: number; height?: number };
        return { width: data.width ?? n.width ?? 240, height: data.height ?? n.height ?? 96 };
    };
    const nodeRects: NodeRect[] = content.map((n) => ({ id: String(n.id), x: n.position.x, y: n.position.y, ...dims(n) }));
    const byGroup = new Map<string, NodeRect[]>();
    content.forEach((n, index) => {
        const group = (n.data as { group?: string } | undefined)?.group;
        if (!group) return;
        byGroup.set(group, [...(byGroup.get(group) ?? []), nodeRects[index]]);
    });
    const kinds = new Map((rendered.ir.groups ?? []).map((g) => [g.label, g.kind] as const));
    let fallback = 0;
    const groupRects: GroupRect[] = [...byGroup.entries()].map(([label, members]) => {
        const kind = kinds.get(label);
        const style = resolveGroupSemanticStyle(kind, fallback);
        if (!kind) fallback++;
        const minX = Math.min(...members.map((r) => r.x)) - style.padX;
        const minY = Math.min(...members.map((r) => r.y)) - style.padTop;
        const maxX = Math.max(...members.map((r) => r.x + r.width)) + style.padX;
        const maxY = Math.max(...members.map((r) => r.y + r.height)) + style.padBottom;
        return { id: label, label, x: minX, y: minY, width: maxX - minX, height: maxY - minY, memberIds: members.map((r) => r.id) };
    });
    const centre = new Map(nodeRects.map((r) => [r.id, { x: r.x + r.width / 2, y: r.y + r.height / 2 }] as const));
    const edgeSegments = rendered.reactFlow.edges
        .filter((e) => centre.has(String(e.source)) && centre.has(String(e.target)))
        .map((e) => ({ id: String(e.id), source: String(e.source), target: String(e.target), waypoints: [centre.get(String(e.source))!, centre.get(String(e.target))!] }));
    const metrics = computeLayoutQuality({ ir: rendered.ir, nodeRects, groupRects, edgeSegments });
    return {
        solapesNodos: metrics.overlappingNodePairs.length,
        solapesGrupos: metrics.overlappingGroupPairs.length,
        aristasQueAtraviesanNodos: metrics.edgesCrossingNodes.length,
    };
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

        const esqueleto = Boolean(result.skeletonFallbackError) || isSkeletonFallbackContent(result.persistedContent);
        const saved = {
            id: `eval-${testCase.id}`,
            type: testCase.plantilla.tipo,
            content: result.persistedContent,
            representation: templateFor(testCase).representation,
            ir: ir ?? undefined,
        } as Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>;
        const savedBlock = testCase.plantilla.tipo === 'react-flow-graph'
            ? null
            : result.persistedContent.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] ?? result.persistedContent;
        const verdict = savedBlock === null ? null : await checkMermaidSyntax(savedBlock);
        const modelIR = modelIRFor(testCase);
        const comparable = Boolean(ir && modelIR && !esqueleto && !testCase.esperado.degradado);
        const integridad = comparable
            ? measureIntegrity(modelIR!, ir!, resolveRenderableDiagram(saved, { audience: 'technical' }).ir)
            : null;
        const edicion = comparable ? measureCanvasEdit(saved, testCase.esperado.dialecto) : null;
        const geometria = comparable ? measureGeometry(saved) : null;

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
            esqueleto,
            sintaxis: verdict?.status ?? null,
            ...(verdict?.status === 'invalid' ? { sintaxisError: verdict.message } : {}),
            defectoConocido: testCase.esperado.defectoConocido,
            integridad,
            edicion,
            geometria,
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
        ...summarizeIntegrity(results),
        sintaxisValida: round(ratio(
            all.filter((r) => r.sintaxis === 'valid').length,
            all.filter((r) => r.sintaxis === 'valid' || r.sintaxis === 'invalid').length,
        )),
    };
}

function summarizeIntegrity(results: DiagramEvalCaseResult[]) {
    const total = (pick: (r: DiagramEvalCaseResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
    const edited = results.filter((r) => r.edicion);
    return {
        elementosInventados: total((r) => r.integridad?.elementosInventados.length ?? 0),
        gruposInventados: total((r) => r.integridad?.gruposInventados.length ?? 0),
        aristasAlteradas: total((r) => r.integridad?.aristasAlteradas.length ?? 0),
        aristasInventadas: total((r) => r.integridad?.aristasInventadas.length ?? 0),
        descripcionesSinteticas: total((r) => r.integridad?.descripcionesSinteticas ?? 0),
        nodosRenderNoGuardados: total((r) => r.integridad?.nodosRenderNoGuardados.length ?? 0),
        dialectoTrasEdicion: round(ratio(edited.filter((r) => r.edicion!.dialectoTrasEdicion).length, edited.length)),
        nodosPerdidosPorEdicion: total((r) => (r.edicion?.nodosPerdidos.tecnica.length ?? 0) + (r.edicion?.nodosPerdidos.ejecutiva.length ?? 0)),
        nodosAnadidosPorEdicion: total((r) => (r.edicion?.nodosAnadidos.tecnica.length ?? 0) + (r.edicion?.nodosAnadidos.ejecutiva.length ?? 0)),
        solapesNodos: total((r) => r.geometria?.solapesNodos ?? 0),
        solapesGrupos: total((r) => r.geometria?.solapesGrupos ?? 0),
        aristasQueAtraviesanNodos: total((r) => r.geometria?.aristasQueAtraviesanNodos ?? 0),
    };
}

/** Los contadores de 8.0b que sólo pueden bajar, y la fracción que sólo puede subir. */
export const INTEGRITY_COUNTERS = [
    'elementosInventados',
    'gruposInventados',
    'aristasAlteradas',
    'aristasInventadas',
    'descripcionesSinteticas',
    'nodosRenderNoGuardados',
    'nodosPerdidosPorEdicion',
    'nodosAnadidosPorEdicion',
    'solapesNodos',
    'solapesGrupos',
    'aristasQueAtraviesanNodos',
] as const;

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
        r.sintaxis === 'invalid' ? `NO: ${r.sintaxisError?.split('\n')[0]}` : r.sintaxis ?? '—',
        r.hallazgosDominio.join(',') || '—',
    ].join(' | '));
    const missing = results.flatMap((r) => r.contexto.filter((c) => !c.ok).map((c) => `  ${r.id}: falta ${c.que}`));
    const integrityRows = results.filter((r) => r.integridad || r.edicion || r.geometria).map((r) => [
        r.id,
        r.integridad?.elementosInventados.join(', ') || '—',
        r.integridad?.gruposInventados.join(', ') || '—',
        r.integridad?.aristasAlteradas.length ?? '—',
        r.integridad?.aristasInventadas.join(', ') || '—',
        r.integridad?.descripcionesSinteticas ?? '—',
        r.integridad?.nodosRenderNoGuardados.join(', ') || '—',
        r.edicion ? `${r.edicion.dialectoTrasEdicion ? 'sí' : 'NO'} (${r.edicion.dialectoGuardadoTrasEdicion})` : '—',
        r.edicion ? `${r.edicion.nodosPerdidos.tecnica.length}/${r.edicion.nodosPerdidos.ejecutiva.length}` : '—',
        r.edicion ? `${r.edicion.nodosAnadidos.tecnica.length}/${r.edicion.nodosAnadidos.ejecutiva.length}` : '—',
        r.geometria ? `${r.geometria.solapesNodos}/${r.geometria.solapesGrupos}/${r.geometria.aristasQueAtraviesanNodos}` : '—',
    ].join(' | '));
    return [
        'caso | dialecto | entidades | metadatos | tecnologías | historia | esqueleto | calidad | contexto | contradicciones | fidelidad | correcciones | avisos al usuario | paquetes | sintaxis | hallazgos de dominio',
        ...rows,
        '',
        ...(missing.length ? ['Contexto que no llegó al modelo:', ...missing, ''] : []),
        'Integridad y presentación (8.0b)',
        'caso | inventados | grupos inventados | aristas alteradas | aristas inventadas | descripciones sintéticas | render no guardado | dialecto tras editar | perdidos téc/ejec | añadidos téc/ejec | solapes nodos/grupos/aristas por nodos',
        ...integrityRows,
        '',
        JSON.stringify(summary, null, 2),
    ].join('\n');
}
