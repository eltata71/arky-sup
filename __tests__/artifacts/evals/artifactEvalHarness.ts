/**
 * Banco de evaluación de artefactos (plan de calidad de artefactos, 7.1c).
 *
 * El banco de diagramas mide lo que se guarda. Éste mide lo que el plan de
 * calidad de artefactos promete mejorar, y lo mide antes de mejorarlo:
 *
 * 1. **Contexto entregado.** Cada ámbito de contexto —global, memoria del
 *    agente, proyecto, captura inicial, memoria del proyecto y del artefacto,
 *    iniciativa, entregable, conversación, artefactos hermanos— lleva una
 *    **marca única**. Cada camino real que llama a un modelo (generar, criticar,
 *    refinar, revisar, sugerir, presentar, convertir, copiloto) se ejecuta con
 *    el transporte sustituido, y se mira qué marcas llegaron al prompt. No es
 *    una estimación: la marca está o no está. Un ámbito sin canal hacia ese
 *    camino cuenta como no entregado, que es exactamente lo que es.
 * 2. **Vista completa y cercado.** Una marca al final del artefacto dice si el
 *    modelo lo vio entero; su posición dice si iba dentro de la cerca de
 *    contenido externo.
 * 3. **Conservación bajo edición.** Cuatro reescrituras tipo por documento —una
 *    mejora, un truncado, una sección perdida y una sección quitada a
 *    petición— pasan por el chat y por el agente; se mide si cada veredicto es
 *    el correcto.
 * 4. **Contrato de la disciplina.** Cada respuesta de modelo omite a propósito
 *    secciones que su disciplina exige (un ADR sin «Consecuencias»); se mide
 *    si el validador de contratos lo detecta.
 *
 * Lo que NO mide: la calidad del modelo. Las respuestas son redactadas a mano
 * y cada caso lo declara en `origenRespuesta`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';
import type { Artifact, ArtifactBusinessMotivation, ArtifactDeliverableContext } from '../../../lib/artifacts';
import { instructionPermitsRemoval, extractMarkdownHeadings } from '../../../lib/artifacts';
import { UNTRUSTED_FENCE_CLOSE, UNTRUSTED_FENCE_OPEN } from '../../../lib/untrustedContent';
import { ARTIFACT_TEMPLATES } from '../../../constants';
import { extractConversationDecisions, type ChatMessage } from '../../../services/chat';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import { artifactGenerationService } from '../../../services/ai/generation/artifactGenerationService';
import { generatePresentationDeck } from '../../../services/ai/generation/presentationDeck';
import { convertDiagramToDocument } from '../../../services/ai/generation/documents/documentConversions';
import { suggestArtifactImprovements } from '../../../services/ai/generation/artifactSuggestions';
import { buildArtifactSuggestionContext } from '../../../services/ai/artifactSuggestionService';
import { artifactGenerationSupport } from '../../../services/artifacts/domain/artifactGenerationSupport';
import { compileArtifact } from '../../../services/artifactCompiler';
import { processAssistantChat } from '../../../services/agent/agentConversation';
import { interpretArtifactModification } from '../../../services/agent/artifactModificationCall';
import { validateArtifactContent } from '../../../services/agent/agentContentValidation';
import { checkDocumentFidelity } from '../../../services/artifacts/application/documentFidelity';
import { createContextManifestRecorder, renderCitationsForExport, reviewContextCitations } from '../../../lib/artifacts';
import { renderContextGraphReinforcement } from '../../../services/contextGraph';

export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'artifact-evals');

// ─── Vocabulario ────────────────────────────────────────────────────────────

export const SCOPES = [
    'global',
    'agenteBase',
    'proyecto',
    'capturaInicial',
    'memoriaProyecto',
    'memoriaArtefacto',
    'iniciativa',
    'entregable',
    'conversacion',
    'hermanos',
] as const;
export type Scope = typeof SCOPES[number];

export const PATHS = [
    'generar',
    'criticar',
    'refinar',
    'revisar',
    'sugerir',
    'presentar',
    'convertir',
    'copiloto',
] as const;
export type EvalPath = typeof PATHS[number];

/** Los caminos que trabajan sobre un artefacto que ya existe. */
const PATHS_ON_ARTIFACT: ReadonlySet<EvalPath> = new Set(['criticar', 'refinar', 'revisar', 'sugerir', 'convertir', 'copiloto']);

export interface ArtifactEvalCase {
    id: string;
    dominio: 'salud' | 'vida';
    origenRespuesta: string;
    /** Nombre exacto de una plantilla de `ARTIFACT_TEMPLATES`. */
    plantilla: string;
    proyecto: { nombre: string; descripcion: string };
    /** Los caminos que se miden en este caso. */
    caminos: EvalPath[];
    /** El artefacto que ya existe (el que se critica, revisa, convierte o edita). */
    artefacto: { contenido: string; representacion: 'document' | 'diagram' | 'hybrid' };
    /** Lo que devuelve el modelo al generar: Markdown, o el JSON de un deck. */
    respuestaModelo: string;
    /** Secciones que la disciplina exige; cada entrada es una lista de alias. */
    seccionesDisciplina?: string[][];
    /** Las que `respuestaModelo` omite a propósito (por su primer alias). */
    seccionesOmitidas?: string[];
}

// ─── Contexto marcado ───────────────────────────────────────────────────────

const marker = (caseId: string, scope: Scope): string => `MARCA-${scope.toUpperCase()}-${caseId}`;
const END_MARKER = (caseId: string): string => `MARCA-FIN-ARTEFACTO-${caseId}`;

/** Lo que dice cada ámbito, por dominio: frases verosímiles, cada una con su marca. */
const SCOPE_TEXT: Record<'salud' | 'vida', Record<Scope, string>> = {
    salud: {
        global: 'Toda integración con terceros usa OAuth 2.0 con mTLS y registra auditoría inmutable',
        agenteBase: 'Prefiero decisiones con alternativas comparadas y su coste de operación',
        proyecto: 'La autorización previa debe resolverse en menos de 72 horas para casos urgentes',
        capturaInicial: 'Stakeholder principal: dirección médica; alcance: red de prestadores nacional',
        memoriaProyecto: 'Se descartó el bus propietario del proveedor del core por coste de licencias',
        memoriaArtefacto: 'Este documento debe citar la norma interna de retención de datos clínicos',
        iniciativa: 'Reducir el tiempo de adjudicación de reclamaciones médicas de 9 a 3 días',
        entregable: 'El comité pidió comparar mensajería gestionada frente a autogestionada',
        conversacion: 'Acordamos en el chat que el canal de prestadores queda fuera de la primera fase',
        hermanos: 'El C4 de contenedores nombra el servicio Motor de Coberturas como fuente de verdad',
    },
    vida: {
        global: 'Todo pago a beneficiarios pasa por el control de listas de sanciones antes de liberarse',
        agenteBase: 'Prefiero requisitos con criterio de aceptación verificable y dueño identificado',
        proyecto: 'La suscripción simplificada aplica a capitales asegurados de hasta 150 000 USD',
        capturaInicial: 'Stakeholder principal: dirección de suscripción; alcance: canal de brokers',
        memoriaProyecto: 'Se decidió conservar el core de pólizas AS/400 y exponerlo por API',
        memoriaArtefacto: 'Este documento debe usar el glosario corporativo de siniestros',
        iniciativa: 'Pagar el 90 % de los siniestros de vida en menos de 10 días hábiles',
        entregable: 'El comité pidió trazar cada requisito hasta un control de prevención de lavado',
        conversacion: 'Acordamos en el chat que la evidencia médica se clasifica como PHI',
        hermanos: 'El diagrama de secuencia de pago nombra el servicio Validador de Beneficiarios',
    },
};

const scopeSentence = (testCase: ArtifactEvalCase, scope: Scope): string =>
    `${SCOPE_TEXT[testCase.dominio][scope]} (${marker(testCase.id, scope)})`;

const NOW = '2026-09-29T00:00:00.000Z';

function settingsFor(testCase: ArtifactEvalCase): Settings {
    return {
        globalContext: [scopeSentence(testCase, 'global')],
        agentMemory: [scopeSentence(testCase, 'agenteBase')],
        language: 'es',
        theme: 'light',
        aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'profesional', languageStyle: 'es', apiKeySource: 'global' },
    } as unknown as Settings;
}

function templateFor(testCase: ArtifactEvalCase): ArtifactTemplate {
    const template = ARTIFACT_TEMPLATES.find((candidate) => candidate.name === testCase.plantilla);
    if (!template) throw new Error(`Plantilla desconocida en ${testCase.id}: ${testCase.plantilla}`);
    return template;
}

function artifactFor(testCase: ArtifactEvalCase): Artifact {
    const template = templateFor(testCase);
    return {
        id: `art-${testCase.id}`,
        versionGroupId: `grupo-${testCase.id}`,
        version: 1,
        createdAt: NOW,
        name: template.name,
        type: testCase.artefacto.representacion === 'diagram' ? 'mermaid-sequence' : template.type,
        phase: template.phase,
        architecturalView: template.architecturalView,
        objective: template.objective,
        keyConcepts: template.keyConcepts,
        representation: testCase.artefacto.representacion,
        content: `${testCase.artefacto.contenido.trimEnd()}\n\n${testCase.artefacto.representacion === 'diagram' ? '%% ' : ''}${END_MARKER(testCase.id)}`,
        artifactMemory: [scopeSentence(testCase, 'memoriaArtefacto')],
    } as unknown as Artifact;
}

function siblingFor(testCase: ArtifactEvalCase): Artifact {
    return {
        id: `hermano-${testCase.id}`,
        versionGroupId: `grupo-hermano-${testCase.id}`,
        version: 1,
        createdAt: '2026-09-28T00:00:00.000Z',
        name: 'Visión de la Arquitectura',
        type: 'markdown',
        phase: 'Fase 1: Visión',
        architecturalView: 'Vista de Contexto y Negocio',
        objective: 'Visión y principios',
        keyConcepts: [],
        representation: 'document',
        content: `# Visión de la Arquitectura\n\n## Resumen\n${scopeSentence(testCase, 'hermanos')}. La visión prioriza la trazabilidad regulatoria y la reutilización de capacidades existentes del core.`,
    } as unknown as Artifact;
}

function projectFor(testCase: ArtifactEvalCase, artifact: Artifact): Project {
    return {
        id: `eval-${testCase.id}`,
        name: testCase.proyecto.nombre,
        description: testCase.proyecto.descripcion,
        projectContext: [scopeSentence(testCase, 'proyecto')],
        initialCapture: [scopeSentence(testCase, 'capturaInicial')],
        agentMemory: [scopeSentence(testCase, 'memoriaProyecto')],
        initiativeIds: ['ini-1'],
        artifacts: [siblingFor(testCase), artifact],
        createdAt: NOW,
        updatedAt: NOW,
    } as unknown as Project;
}

function motivationFor(testCase: ArtifactEvalCase): ArtifactBusinessMotivation[] {
    return [{
        title: 'Iniciativa del caso',
        code: 'NEG-2026-001',
        need: scopeSentence(testCase, 'iniciativa'),
        objectives: [],
        expectedOutcomes: [],
        kpis: [],
        regulatoryDrivers: [],
    }];
}

/** El entregable en curso del proyecto, como lo describe la Oficina (7.3c). */
function deliverablesFor(testCase: ArtifactEvalCase): ArtifactDeliverableContext[] {
    return [{
        title: 'Entregable del caso',
        brief: scopeSentence(testCase, 'entregable'),
        status: 'in-progress',
        objectives: [],
        scope: [],
        outOfScope: [],
        constraints: [],
        regulatoryDrivers: [],
    }];
}

function conversationFor(testCase: ArtifactEvalCase): ChatMessage[] {
    return [
        { role: 'user', content: `${scopeSentence(testCase, 'conversacion')}.`, timestamp: NOW },
        { role: 'model', content: 'Entendido, lo tendré en cuenta en los artefactos del proyecto.', timestamp: NOW },
    ];
}

// ─── Ejecución de cada camino ───────────────────────────────────────────────

/** Todo lo que un camino le mandó al modelo, en una sola cadena. */
const promptOf = (calls: unknown[][]): string =>
    calls.map((call) => {
        const [, , contents, config] = call as [unknown, unknown, unknown, { systemInstruction?: unknown } | undefined];
        const system = typeof config?.systemInstruction === 'string' ? config.systemInstruction : '';
        return `${system}\n${typeof contents === 'string' ? contents : JSON.stringify(contents)}`;
    }).join('\n');

async function runPath(testCase: ArtifactEvalCase, path: EvalPath): Promise<string> {
    const settings = settingsFor(testCase);
    const artifact = artifactFor(testCase);
    const project = projectFor(testCase, artifact);
    const template = templateFor(testCase);
    const text = vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue(testCase.respuestaModelo);
    // Lo que hoy pasan las pantallas a cada camino: iniciativa, entregables y conversación (7.3d).
    const ports = {
        businessMotivation: motivationFor(testCase),
        conversation: extractConversationDecisions(conversationFor(testCase)),
        deliverables: deliverablesFor(testCase),
    };
    const content = vi.spyOn(legacyTransport, 'generateContentWithFallback')
        .mockResolvedValue({ text: path === 'sugerir' ? '{}' : path === 'revisar' ? '[]' : testCase.respuestaModelo });
    try {
        switch (path) {
            case 'generar':
                await artifactGenerationService.generateArtifactContent(project, template, settings, undefined, {
                    support: artifactGenerationSupport,
                    businessMotivation: motivationFor(testCase),
                    // Lo que pasa el Workspace al generar: las decisiones del chat (7.3b).
                    conversation: extractConversationDecisions(conversationFor(testCase)),
                    // Lo que pasa el Workspace: los entregables en curso (7.3c).
                    deliverables: deliverablesFor(testCase),
                });
                break;
            case 'criticar':
            case 'refinar': {
                // Lo que pasa `refineArtifactBeforePersistence` al regenerar: el artefacto anterior y la motivación (7.3a).
                const request = {
                    project, template, settings, content: artifact.content, mode: 'document' as const, score: 70, issues: [],
                    previousArtifact: artifact, businessMotivation: motivationFor(testCase),
                    conversation: extractConversationDecisions(conversationFor(testCase)),
                    deliverables: deliverablesFor(testCase),
                };
                if (path === 'criticar') await artifactGenerationService.critiqueArtifactContent(request);
                else await artifactGenerationService.refineArtifactContent(request);
                break;
            }
            case 'revisar':
                await artifactGenerationService.reviewArtifact(artifact, project, settings, ports);
                break;
            case 'sugerir':
                await suggestArtifactImprovements(
                    buildArtifactSuggestionContext({ artifact, project, qualityScore: 70, qualitySummary: null, qualityIssues: [], ports }, settings),
                    settings,
                );
                break;
            case 'presentar':
                await generatePresentationDeck(project, template, settings, undefined, ports);
                break;
            case 'convertir':
                await convertDiagramToDocument(artifact, project, settings, ports);
                break;
            case 'copiloto':
                await processAssistantChat({
                    project,
                    activeArtifact: artifact,
                    history: conversationFor(testCase),
                    question: 'Revisa el documento y dime qué le falta.',
                    settings,
                    ports,
                });
                break;
        }
        return promptOf([...text.mock.calls, ...content.mock.calls]);
    } finally {
        text.mockRestore();
        content.mockRestore();
    }
}

// ─── Medición ───────────────────────────────────────────────────────────────

export interface PathResult {
    path: EvalPath;
    /** Ámbito → si su marca llegó al prompt; sólo los que aplican al camino. */
    ambitos: Partial<Record<Scope, boolean>>;
    /** El modelo vio el artefacto entero (sólo caminos sobre un artefacto). */
    vistaCompleta?: boolean;
    /** El artefacto llegó dentro de la cerca de contenido externo. */
    cercado?: boolean;
}

export interface EditResult {
    edicion: string;
    esperado: 'aplica' | 'rechaza';
    chat: 'aplica' | 'rechaza';
    agente: 'aplica' | 'rechaza';
}

export interface ArtifactEvalCaseResult {
    id: string;
    caminos: PathResult[];
    ediciones: EditResult[];
    /** Secciones omitidas a propósito → si el validador de contratos lo detectó. */
    contrato: Array<{ seccion: string; detectada: boolean }>;
    /** Proporción de comprobaciones de fidelidad cumplidas por la respuesta (7.4c); null si no aplica. */
    fidelidad: number | null;
    /** 7.5b: citas contra el contexto registrado; null si el caso no es un documento. */
    procedencia: { resueltas: boolean; informada: boolean; exportLimpia: boolean } | null;
}

const scopesFor = (path: EvalPath): Scope[] =>
    SCOPES.filter((scope) => scope !== 'memoriaArtefacto' || PATHS_ON_ARTIFACT.has(path));

/** Si la marca va entre una apertura de la cerca y su cierre. */
const isFenced = (prompt: string, token: string): boolean => {
    const at = prompt.indexOf(token);
    if (at < 0) return false;
    const open = prompt.lastIndexOf(UNTRUSTED_FENCE_OPEN, at);
    const close = prompt.lastIndexOf(UNTRUSTED_FENCE_CLOSE, at);
    return open >= 0 && open > close;
};

async function measurePath(testCase: ArtifactEvalCase, path: EvalPath): Promise<PathResult> {
    const prompt = await runPath(testCase, path);
    const ambitos: Partial<Record<Scope, boolean>> = {};
    for (const scope of scopesFor(path)) ambitos[scope] = prompt.includes(marker(testCase.id, scope));
    if (!PATHS_ON_ARTIFACT.has(path)) return { path, ambitos };
    const end = END_MARKER(testCase.id);
    return { path, ambitos, vistaCompleta: prompt.includes(end), cercado: isFenced(prompt, end) };
}

/** Las cuatro reescrituras tipo de un documento, con su veredicto correcto. */
function editsFor(content: string): Array<{ edicion: string; instruccion: string; candidato: string; esperado: 'aplica' | 'rechaza' }> {
    const sections = content.split(/(?=^## )/m);
    const victim = sections.find((section, index) => index > 1 && section.startsWith('## '))
        ?? sections.find((section) => section.startsWith('## '))
        ?? '';
    const victimTitle = extractMarkdownHeadings(victim)[0] ?? '';
    const withoutVictim = content.replace(victim, '');
    const improved = content.replace(/^(## .+)$/m, '$1\n\nPárrafo añadido que concreta la sección con un dato verificable del proyecto.');
    return [
        { edicion: 'mejora', instruccion: 'Mejora la redacción del documento', candidato: improved, esperado: 'aplica' },
        { edicion: 'truncado', instruccion: 'Añade un riesgo a la tabla', candidato: content.slice(0, Math.floor(content.length * 0.35)), esperado: 'rechaza' },
        { edicion: 'seccion-perdida', instruccion: 'Mejora la redacción del documento', candidato: withoutVictim, esperado: 'rechaza' },
        { edicion: 'seccion-quitada', instruccion: `Elimina la sección ${victimTitle}`, candidato: withoutVictim, esperado: 'aplica' },
    ];
}

function measureEdits(testCase: ArtifactEvalCase): EditResult[] {
    if (testCase.artefacto.representacion === 'diagram') return [];
    const artifact = artifactFor(testCase);
    return editsFor(artifact.content).map(({ edicion, instruccion, candidato, esperado }) => {
        const chat = interpretArtifactModification(
            { name: 'modifyArtifact', args: { newContent: candidato, target: 'current' } },
            artifact,
            instruccion,
        );
        const agent = validateArtifactContent(artifact, candidato, { permitsRemoval: instructionPermitsRemoval(instruccion) });
        return {
            edicion,
            esperado,
            chat: chat.kind === 'update-current' ? 'aplica' : 'rechaza',
            agente: agent.passed ? 'aplica' : 'rechaza',
        };
    });
}

const normalize = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function measureContract(testCase: ArtifactEvalCase): Array<{ seccion: string; detectada: boolean }> {
    const omitted = testCase.seccionesOmitidas ?? [];
    if (omitted.length === 0) return [];
    const template = templateFor(testCase);
    const candidate = {
        ...artifactFor(testCase),
        type: template.type,
        representation: template.representation,
        content: testCase.respuestaModelo,
    } as Artifact;
    const result = compileArtifact(candidate, { applyRepairs: false });
    const findings = Object.values(result.issues).flat().map((issue) => normalize(`${issue.message} ${issue.recommendation} ${issue.dimension ?? ''}`));
    return omitted.map((seccion) => ({
        seccion,
        detectada: findings.some((finding) => finding.includes(normalize(seccion))),
    }));
}

/**
 * 7.5b. The document cites two entities of the pack really sent for this case
 * and one that was never sent. Provenance holds when the real ones resolve
 * against the recorded manifest, the invented one is reported, and the export
 * carries no `[ctx:*]` tag at all.
 */
function measureProvenance(testCase: ArtifactEvalCase): ArtifactEvalCaseResult['procedencia'] {
    if (testCase.artefacto.representacion === 'diagram' || testCase.caminos.includes('presentar')) return null;
    const artifact = artifactFor(testCase);
    const recorder = createContextManifestRecorder(NOW);
    renderContextGraphReinforcement(projectFor(testCase, artifact), settingsFor(testCase), { artifactType: artifact.type, intent: artifact.objective, language: 'es' }, undefined, recorder.capture);
    const manifest = recorder.manifest();
    const sent = (manifest?.records ?? []).flatMap((record) => record.citations ?? []).slice(0, 2).map((citation) => citation.tag);
    const cited = testCase.respuestaModelo.replace(/^(## .+\n+[^\n#][^\n]*)/m, `$1 ${sent.join(' ')} [ctx:inventada-99]`)
        + `\n\n## Contexto utilizado\n\n${[...sent, '[ctx:inventada-99]'].map((tag) => `- ${tag}`).join('\n')}\n`;
    const review = reviewContextCitations(cited, manifest);
    const exported = renderCitationsForExport(cited, manifest);
    return {
        resueltas: sent.length > 0 && review.references.filter((ref) => ref.key !== 'inventada-99').every((ref) => ref.status === 'resolved'),
        informada: review.references.some((ref) => ref.key === 'inventada-99' && ref.status === 'unresolved') && exported.removed.includes('inventada-99'),
        exportLimpia: !/\[ctx:/i.test(exported.content.replace(/```[\s\S]*?```/g, '')),
    };
}

export async function runEvalCase(testCase: ArtifactEvalCase): Promise<ArtifactEvalCaseResult> {
    const caminos: PathResult[] = [];
    for (const path of testCase.caminos) caminos.push(await measurePath(testCase, path));
    const fidelidad = testCase.artefacto.representacion === 'diagram' || testCase.caminos.includes('presentar')
        ? null
        : checkDocumentFidelity({ templateName: testCase.plantilla, content: testCase.respuestaModelo }).score;
    return { id: testCase.id, caminos, ediciones: measureEdits(testCase), contrato: measureContract(testCase), fidelidad, procedencia: measureProvenance(testCase) };
}

export function loadCorpus(): ArtifactEvalCase[] {
    return readdirSync(CORPUS_DIR)
        .filter((file) => file.endsWith('.json') && file !== 'linea-base.json')
        .sort()
        .map((file) => JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as ArtifactEvalCase);
}

// ─── Agregados ──────────────────────────────────────────────────────────────

const pct = (hits: number, total: number): number => (total === 0 ? 100 : Math.round((hits / total) * 1000) / 10);

export interface ArtifactEvalSummary {
    /** % de marcas de contexto que llegaron, sobre todas las que aplicaban. */
    contextoEntregado: number;
    /** Lo mismo, por camino. */
    porCamino: Partial<Record<EvalPath, number>>;
    /** Lo mismo, por ámbito. */
    porAmbito: Partial<Record<Scope, number>>;
    /** % de caminos sobre un artefacto que lo vieron entero. */
    vistaCompleta: number;
    /** % de caminos sobre un artefacto que lo recibieron cercado. */
    cercado: number;
    /** % de veredictos de edición correctos (chat y agente). */
    conservacion: number;
    /** % de secciones omitidas que el contrato detecta. */
    contratoDetecta: number;
    /** Media de fidelidad de las respuestas de documento: lo que la disciplina exige y está (7.4c). */
    fidelidad: number;
    /** 7.5b: % de documentos cuyas citas resuelven, cuya cita inventada se informa y cuya exportación sale sin etiquetas. */
    procedencia: number;
    /** Cada celda camino·ámbito entregada: la línea base no puede perder ninguna. */
    celdasEntregadas: string[];
}

export function summarize(results: ArtifactEvalCaseResult[]): ArtifactEvalSummary {
    const paths = results.flatMap((result) => result.caminos);
    const cells = paths.flatMap((path) => Object.entries(path.ambitos).map(([scope, hit]) => ({ path: path.path, scope: scope as Scope, hit: hit === true })));
    const onArtifact = paths.filter((path) => path.vistaCompleta !== undefined);
    const verdicts = results.flatMap((result) => result.ediciones.flatMap((edit) => [edit.chat === edit.esperado, edit.agente === edit.esperado]));
    const contract = results.flatMap((result) => result.contrato);
    const porCamino: Partial<Record<EvalPath, number>> = {};
    for (const path of PATHS) {
        const mine = cells.filter((cell) => cell.path === path);
        if (mine.length > 0) porCamino[path] = pct(mine.filter((cell) => cell.hit).length, mine.length);
    }
    const porAmbito: Partial<Record<Scope, number>> = {};
    for (const scope of SCOPES) {
        const mine = cells.filter((cell) => cell.scope === scope);
        if (mine.length > 0) porAmbito[scope] = pct(mine.filter((cell) => cell.hit).length, mine.length);
    }
    return {
        contextoEntregado: pct(cells.filter((cell) => cell.hit).length, cells.length),
        porCamino,
        porAmbito,
        vistaCompleta: pct(onArtifact.filter((path) => path.vistaCompleta).length, onArtifact.length),
        cercado: pct(onArtifact.filter((path) => path.cercado).length, onArtifact.length),
        conservacion: pct(verdicts.filter(Boolean).length, verdicts.length),
        contratoDetecta: pct(contract.filter((entry) => entry.detectada).length, contract.length),
        fidelidad: (() => {
            const scores = results.map((result) => result.fidelidad).filter((score): score is number => score !== null);
            return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 10 : 100;
        })(),
        procedencia: (() => {
            const cases = results.map((result) => result.procedencia).filter((value): value is NonNullable<typeof value> => value !== null);
            return pct(cases.filter((value) => value.resueltas && value.informada && value.exportLimpia).length, cases.length);
        })(),
        celdasEntregadas: [...new Set(results.flatMap((result) => result.caminos.flatMap((path) =>
            Object.entries(path.ambitos).filter(([, hit]) => hit).map(([scope]) => `${result.id}·${path.path}·${scope}`))))].sort(),
    };
}

export function renderReport(results: ArtifactEvalCaseResult[], summary: ArtifactEvalSummary): string {
    const mark = (value: boolean | undefined): string => (value === undefined ? '·' : value ? '✔' : '✘');
    const header = `| caso · camino | ${SCOPES.join(' | ')} | completa | cercado |`;
    const rule = `|${'---|'.repeat(SCOPES.length + 3)}`;
    const rows = results.flatMap((result) => result.caminos.map((path) =>
        `| ${result.id} · ${path.path} | ${SCOPES.map((scope) => mark(path.ambitos[scope])).join(' | ')} | ${mark(path.vistaCompleta)} | ${mark(path.cercado)} |`));
    const perPath = Object.entries(summary.porCamino).map(([path, value]) => `${path} ${value} %`).join(' · ');
    const perScope = Object.entries(summary.porAmbito).map(([scope, value]) => `${scope} ${value} %`).join(' · ');
    return [
        '## Banco de artefactos',
        '',
        header,
        rule,
        ...rows,
        '',
        `Contexto entregado: ${summary.contextoEntregado} %`,
        `Por camino: ${perPath}`,
        `Por ámbito: ${perScope}`,
        `Vista completa: ${summary.vistaCompleta} % · Cercado: ${summary.cercado} %`,
        `Conservación bajo edición: ${summary.conservacion} % · El contrato detecta lo que falta: ${summary.contratoDetecta} %`,
        `Fidelidad de los documentos (lo que su disciplina exige y está): ${summary.fidelidad} %`,
        `Procedencia (citas resueltas, la inventada informada, exportación sin etiquetas): ${summary.procedencia} %`,
    ].join('\n');
}
