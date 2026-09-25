/**
 * The artifact generation engine — what is left of `services/geminiService`
 * (F5-01, corte 14).
 *
 * For its whole life this file sat loose at the root of `services/`, reached
 * *up* into eight domain contexts to compose its prompts, and four of them
 * imported `services/ai` back. Moving it was tried in Ola 5 and reverted for
 * exactly that reason. Thirteen cuts took everything else out — the transport,
 * the LMS, recommendations, documents, diagrams, the assistant, critique,
 * review, the brief and the deck — and cut each upward dependency first: the
 * Office persona arrives through `ArtifactPersonaComposer`, and what it needed
 * from `services/artifacts` (the controlled source selection and the
 * deterministic fallbacks) arrives through `ArtifactGenerationSupport`, which
 * every caller hands over.
 *
 * What remains is one capability, the main artifact generation path, and it
 * is reached only through `artifactGenerationService`.
 */
import { Settings, ArtifactTemplate } from '../../../../types';
import {
    buildDialectInstruction,
    buildMermaidQualityReinforcement,
    DIAGRAM_SYSTEM_INSTRUCTION,
    diagramTemperature,
    generateDiagramIRWithSelfHealing,
    THINKING_BUDGET,
} from '../diagram';
import { emitGenerationPhase, type Artifact, type ArtifactGenerationPhaseEvent } from '../../../../lib/artifacts';
import { isPresentationArtifactType } from '../../../../lib/artifacts/artifactKind';
import type { Project } from '../../../architectureProjects';
import { cleanJsonString as cleanJsonStringUtil } from '../../../../utils';
import {
  buildGlobalPrompt as buildGlobalPromptUtil,
  buildBasePrompt as buildBasePromptUtil,
  buildArtifactsContext as buildArtifactsContextUtil,
  buildSiblingDiagramsPromptBlock as buildSiblingDiagramsPromptBlockUtil,
  type BasePromptOptions,
  type ArtifactsContextOptions,
} from '../../prompts/projectPrompts';
import { resolveModelForSettings } from '../../catalog';
import { legacyTransport, type LegacyGenerationOptions } from '../legacyTransport';
import { C4SelfHealingError, classifyAIError } from '../../errors';
import { generatePresentationDeck } from '../presentationDeck';
import { renderContextGraphReinforcement } from '../../../contextGraph';
import { assessDocumentArtifact } from '../../../quality';
import { buildMinimalPresentationDeck } from '../../../presentation';
import { extractDiagramSignals, irToMermaid, mermaidToIR, renderDiagramSignals } from '../../../diagram';
import {
    buildArchitectureKnowledgeGraphForProject,
    buildArtifactGenerationGraphContext,
    resolveProjectArchitectureGraphFreshness,
} from '../../../architectureKnowledgeGraph';
import type { ArtifactContentGenerationOptions, ArtifactGenerationSupport } from './artifactGenerationSupport';
import {
    buildCatalogDocumentReinforcement,
    buildHybridMarkdownFromMermaid,
    buildOnDemandDocumentReinforcement,
    isDiagramArtifactType,
} from './artifactPromptReinforcements';

class ArtifactGenerationEngine {
    // Note: We no longer store `this.ai` or `this.apiKey` as static properties on the class
    // because we need to decide which key to use (global or user) at runtime based on settings.

    /**
     * The shared generation transport (F6-01). The engine used to build its own
     * instance with its own client factory and publish `getAIClient`,
     * `generateContentWithFallback`, `generateContentStreamWithFallback` and
     * `isOpenRouterConfigured` — surface that, once every other capability had
     * left, only tests read. The seam tests replace is `legacyTransport.getAIClient`.
     */
    private readonly transport = legacyTransport;

    private isLocalGenerationFallbackCandidate(error: unknown): boolean {
        const friendly = classifyAIError(error);
        return friendly.category === 'timeout'
            || friendly.category === 'network'
            || friendly.category === 'overloaded'
            || friendly.category === 'rate-limit';
    }

    private generateTextWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: string,
        config: Record<string, unknown>,
        options: LegacyGenerationOptions = {}
    ): Promise<string> {
        return this.transport.generateTextWithFallback(settings, preferredModel, contents, config, options);
    }

    /**
     * Helper: cleanJsonString
     * SURGICAL JSON EXTRACTION: Finds the first '{' or '[' and the last '}' or ']' 
     * to extract the payload, ignoring any preamble text from the LLM.
     */
    private cleanJsonString(text: string): string {
        return cleanJsonStringUtil(text);
    }

    // --- Prompt Builders ---
    
    private buildGlobalPrompt(settings: Settings): string {
        return buildGlobalPromptUtil(settings);
    }

    private buildBasePrompt(project: Project, settings: Settings, opts?: BasePromptOptions): string {
        return buildBasePromptUtil(project, settings, opts);
    }

    private buildArtifactsContext(project: Project, opts?: ArtifactsContextOptions): string {
        return buildArtifactsContextUtil(project, opts);
    }

    // --- Core Operations ---

    /**
     * True for the C4 family of Mermaid artifacts. These types are routed
     * through the self-healing IR-direct path because they are the most
     * affected by guided-creation prompt saturation.
     */
    private isC4ArtifactType(type: string): boolean {
        return (
            type === 'mermaid-c4-context' ||
            type === 'mermaid-c4-container' ||
            type === 'mermaid-c4-component' ||
            type === 'mermaid-c4-deployment'
        );
    }

    /**
     * Build a transient {@link Artifact} stub from a template so the IR-direct
     * generator (which expects an Artifact-shaped object) can be called from
     * `generateArtifactContent`, where the template has not yet been turned
     * into a persisted artifact.
     */
    private artifactStubFromTemplate(
        template: ArtifactTemplate,
        project: Project,
        support: ArtifactGenerationSupport,
        previousArtifact?: Artifact,
    ): Artifact {
        const now = new Date().toISOString();
        const contract = template.requestContext?.generationContract;
        let controlledContext = '';
        if (contract) {
            const validation = support.controlledContext(project, contract, 700);
            controlledContext = validation.ok ? validation.promptBlock : `
## Selección controlada de fuentes/contexto
- Omitida por validación de seguridad: ${validation.errors.join(' · ')}
`;
        }
        const structuredObjective = contract
            ? `${template.objective}

Structured generation contract: ${contract.normalizedIntent}. Audience: ${contract.audience}. Purpose: ${contract.purpose}. Detail level: ${contract.detailLevel}. Acceptance criteria: ${contract.acceptanceCriteria.join(' | ')}. Excluded source ids: ${contract.excludedSourceArtifactIds.join(', ') || 'none'}.
${controlledContext}`
            : template.objective;
        return {
            id: previousArtifact?.id ?? `stub-${template.name}-${Date.now()}`,
            versionGroupId: previousArtifact?.versionGroupId ?? `stub-${template.name}`,
            version: previousArtifact?.version ?? 1,
            createdAt: previousArtifact?.createdAt ?? now,
            name: template.name,
            type: template.type,
            phase: template.phase,
            architecturalView: template.architecturalView,
            content: previousArtifact?.content ?? '',
            objective: structuredObjective,
            keyConcepts: template.keyConcepts,
            representation: template.representation,
            audience: previousArtifact?.audience,
            theme: previousArtifact?.theme,
            lastDiagramError: previousArtifact?.lastDiagramError,
        };
    }

    /**
     * Generate a C4 artifact via the self-healing IR-direct path and serialize
     * the result back to Mermaid for storage on `artifact.content`. When the
     * IR-direct path falls back to a skeleton, the transient
     * {@link C4SelfHealingError} carries the renderable Mermaid so the public
     * wrapper can persist a usable artifact and surface a precise diagnostic.
     */
    private async generateC4ArtifactViaSelfHealing(
        project: Project,
        template: ArtifactTemplate,
        settings: Settings,
        support: ArtifactGenerationSupport,
        previousArtifact?: Artifact,
    ): Promise<string> {
        const stub = this.artifactStubFromTemplate(template, project, support, previousArtifact);
        const result = await generateDiagramIRWithSelfHealing(stub, project, settings);
        const mermaid = result.fallback === 'skeleton'
            ? support.markSkeleton(irToMermaid(result.ir))
            : irToMermaid(result.ir);
        if (result.fallback === 'skeleton') {
            // Surface the failure to the caller without losing the rendered
            // skeleton: the caller can still persist `mermaid` so the canvas
            // is never blank, while marking `lastDiagramError` on the
            // artifact.
            const err = new C4SelfHealingError(
                'C4 generation fell back to a deterministic skeleton after retries.',
                {
                    reason: result.lastReason ?? 'skeleton-fallback',
                    attempts: result.attempts,
                    sampleMermaid: mermaid,
                    warnings: result.warnings,
                },
            );
            throw err;
        }
        return mermaid;
    }

    /**
     * Generates a presentation deck as a JSON-serialised `PresentationDeck`.
     * Drives Gemini with a presentation-specific prompt + `responseSchema` so
     * the output is a structured deck instead of long-form prose. Falls back
     * to a minimal deck when the model fails or the response is unparseable.
     */
    /**
     * Public entry point for artifact generation. Wraps the internal
     * generation pipeline so that **every** return value (success path,
     * deterministic skeleton, retry fallback, flowchart fallback, etc.) is
     * funnelled through `gateRenderableDiagramContent` before being returned
     * to the caller.
     *
     * Without this wrapper the gate only ran on the final `return raw` of the
     * internal function, leaving 10+ early-return branches (skeleton fallback,
     * post-validation success, flowchart degradation, etc.) able to persist
     * unrenderable content. The user-visible failure mode was: artifact
     * created, header shown, but canvas stayed empty because the persisted
     * Mermaid parsed to zero nodes.
     */
    /**
     * Default Architecture Knowledge Graph block for generation prompts.
     *
     * Resolution order:
     *  1. Persisted graph that is still `current` → use as-is.
     *  2. Stale or missing graph → rebuild in-memory via the deterministic
     *     extractor (`buildArchitectureKnowledgeGraphForProject`); the rebuilt
     *     graph is used for THIS prompt only — persistence stays owned by
     *     AppContext's debounced auto-rebuild.
     *  3. Empty project / any failure → '' (generation proceeds unchanged).
     */
    private resolveDefaultArchitectureGraphBlock(
        project: Project,
        template: ArtifactTemplate,
        settings: Settings,
    ): string {
        try {
            if (!Array.isArray(project.artifacts) || project.artifacts.length === 0) return '';
            const freshness = resolveProjectArchitectureGraphFreshness(project, {
                globalContext: settings.globalContext,
            });
            let graph = project.architectureKnowledgeGraph ?? null;
            let effectiveFreshness = freshness;
            if (!graph || freshness !== 'current') {
                graph = buildArchitectureKnowledgeGraphForProject(project, {
                    globalContext: settings.globalContext,
                    previousGraph: graph ?? undefined,
                });
                effectiveFreshness = 'current';
            }
            const context = buildArtifactGenerationGraphContext(graph, effectiveFreshness, {
                artifactType: template.type,
                intent: template.requestContext?.userRequest ?? template.objective,
                audience: template.requestContext?.audience,
                language: settings.language,
            });
            return context.promptBlock;
        } catch (err) {
            console.warn('[artifactGenerationEngine] No se pudo resolver el grafo de conocimiento para la generación; se continúa sin él.', err);
            return '';
        }
    }

    public async generateArtifactContent(
        project: Project,
        template: ArtifactTemplate,
        settings: Settings,
        previousArtifact: Artifact | undefined,
        opts: ArtifactContentGenerationOptions,
    ): Promise<string> {
        const { onPhase, support } = opts;
        const stageTimings = new Map<string, number>();
        const emit = (event: Omit<ArtifactGenerationPhaseEvent, 'at'>) =>
            emitGenerationPhase(onPhase, event, stageTimings);
        const raw = await this._generateArtifactContentInternal(project, template, settings, previousArtifact, opts);
        try {
            return this.gateRenderableDiagramContent(raw, project, template, support, emit);
        } catch (gateErr) {
            // The gate must NEVER block persistence. If something throws
            // unexpectedly inside it, log and return the raw content so the
            // user at least sees what the model produced — the canvas
            // placeholder will then surface the rendering issue with a clear
            // retry CTA.
            console.warn('[artifactGenerationEngine] Renderability gate threw — returning raw content as last resort.', gateErr);
            return raw;
        }
    }

    /**
     * Internal generation pipeline. Returns whatever the catalog/on-demand/C4
     * paths produce. The public `generateArtifactContent` wrapper is
     * responsible for the final renderability check — do NOT consume this
     * directly from outside the service or you bypass the safety net.
     */
    private async _generateArtifactContentInternal(
        project: Project,
        template: ArtifactTemplate,
        settings: Settings,
        previousArtifact: Artifact | undefined,
        opts: ArtifactContentGenerationOptions,
    ): Promise<string> {
        const { onPhase, support } = opts;
        const stageTimings = new Map<string, number>();
        const emit = (event: Omit<ArtifactGenerationPhaseEvent, 'at'>) =>
            emitGenerationPhase(onPhase, event, stageTimings);

        emit({
            stage: 'prompt',
            status: 'in-progress',
            message: `Preparando prompt para "${template.name}".`,
            detail: template.requestContext
                ? `Modo on-demand · audiencia ${template.requestContext.audience ?? 'mixed'}.`
                : `Modo catálogo · tipo ${template.type}.`,
            meta: {
                onDemand: Boolean(template.requestContext),
                type: template.type,
                phase: template.phase,
            },
        });

        // Stabilization: C4 diagrams (Context/Container/Component/Deployment)
        // always go through the IR-direct self-healing path. The legacy
        // Mermaid prompt accumulates 600+ lines of format instructions on top
        // of the unbounded `projectContext` injection, which saturates the
        // model in the guided-creation flow. By routing here we get the
        // capped prompt + automatic corrective retry + deterministic skeleton
        // fallback so the canvas is never silently empty.
        if (this.isC4ArtifactType(template.type)) {
            emit({
                stage: 'ai-generation',
                status: 'in-progress',
                message: 'Generando C4 vía self-healing IR-direct.',
                detail: 'Usa schema canónico, reintento correctivo y skeleton determinístico.',
                meta: { path: 'c4-self-healing', type: template.type },
            });
            try {
                const mermaid = await this.generateC4ArtifactViaSelfHealing(project, template, settings, support, previousArtifact);
                emit({
                    stage: 'ai-generation',
                    status: 'success',
                    message: 'C4 generado correctamente vía pipeline IR.',
                    meta: { contentLength: mermaid.length },
                });
                return mermaid;
            } catch (err) {
                const detail = err instanceof C4SelfHealingError
                    ? `${err.message} · attempts=${err.attempts} · reason=${err.reason}`
                    : err instanceof Error ? err.message : String(err);
                emit({
                    stage: 'ai-generation',
                    status: 'warning',
                    message: 'C4 cayó en skeleton determinístico tras agotar reintentos.',
                    detail,
                    meta: {
                        fallback: 'skeleton',
                        attempts: err instanceof C4SelfHealingError ? err.attempts : 0,
                        reason: err instanceof C4SelfHealingError ? err.reason : 'transient',
                    },
                });
                if (err instanceof C4SelfHealingError && err.sampleMermaid.trim().length > 0) {
                    return err.sampleMermaid;
                }
                return support.deterministicDiagramSkeleton(project, template);
            }
        }

        // Architecture Knowledge Graph by default: when the caller did not
        // resolve a graph block explicitly (Workspace does), resolve it here
        // so EVERY generation path — Arquitecto Agente, creación guiada, SDD —
        // grounds the model on the project's canonical architectural
        // knowledge. Stale/missing graphs are rebuilt in-memory (deterministic
        // extraction, no AI call) without touching persistence. Never throws.
        if (opts.architectureGraphPromptBlock === undefined) {
            opts = {
                ...opts,
                architectureGraphPromptBlock: this.resolveDefaultArchitectureGraphBlock(project, template, settings),
            };
        }

        // Presentation artefacts get their own generation path: a JSON deck
        // matching `PresentationDeck` instead of the long markdown document
        // the document path would otherwise produce. This is the fix for the
        // "Presentación Ejecutiva renders like a Word document" regression.
        if (isPresentationArtifactType(template.type)) {
            emit({
                stage: 'ai-generation',
                status: 'in-progress',
                message: `Generando presentación (${template.type}) como deck JSON.`,
                detail: 'Usa schema PresentationDeck con responseSchema y parser tolerante.',
                meta: { path: 'presentation-deck', type: template.type },
            });
            try {
                const deckJson = await generatePresentationDeck(project, template, settings, opts.architectureGraphPromptBlock);
                emit({
                    stage: 'ai-generation',
                    status: 'success',
                    message: 'Deck generado correctamente.',
                    meta: { contentLength: deckJson.length },
                });
                return deckJson;
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                emit({
                    stage: 'ai-generation',
                    status: 'warning',
                    message: 'Falló la generación del deck; usando deck mínimo fallback.',
                    detail,
                    meta: { fallback: 'minimal-deck' },
                });
                return buildMinimalPresentationDeck(project, template);
            }
        }

        const isDiagramTemplate = isDiagramArtifactType(template.type);
        const requestedBy = template.requestContext?.userRequest ?? template.objective;
        // The persona is handed in, never looked up: the Office imports this layer (corte 13).
        const baseInstruction = buildBasePromptUtil(project, settings, isDiagramTemplate ? { mode: 'diagram' } : undefined);
        const basePrompt = opts.composePersonaInstruction?.(baseInstruction, requestedBy) ?? baseInstruction;
        // Documents embed excerpts of sibling artifacts so the generated
        // content stays consistent with what already exists (same entities,
        // requirement IDs, system names). Diagrams keep the compact list.
        const artifactsContext = buildArtifactsContextUtil(project, isDiagramTemplate
            ? { mode: 'diagram' }
            : { includeExcerpts: true, excludeVersionGroupId: previousArtifact?.versionGroupId });

        let formatInstructions = `Generate the content for the artifact. Respond ONLY with the raw content (e.g., Markdown, Mermaid syntax, YAML). Do not include any explanations, titles, or code block fences unless it's part of the artifact's syntax itself.`;
        const sddSkillMarkdownGuidance = `
SDD Markdown Quality Standard (Skill-ready):
- Produce operational Markdown intended to be reused as an engineering skill/guide by developers.
- Use clear section hierarchy, explicit acceptance criteria, and verification checklists.
- Avoid filler text; every section must contain concrete, project-specific guidance.
- Include traceability IDs (BR-xxx, UC-xxx, NFR-xxx, TC-xxx) when applicable.
- Keep language precise and implementation-oriented.`;
        
        // Use user-selected model or default
        const modelName = resolveModelForSettings('default', settings).id;
        const userTemp = settings.aiConfig?.temperature ?? 0.7;
        const isDiagramArtifact = isDiagramArtifactType(template.type);
        const temperature = isDiagramArtifact
            ? diagramTemperature(userTemp)
            : userTemp;
        let modelConfig: Record<string, unknown> & {
            temperature: number;
            thinkingConfig?: { thinkingBudget: number };
            topP?: number;
        } = { temperature };

        // For diagram artifacts, attach the canonical system instruction
        // (cacheable across calls — Gemini 2.5+ implicit caching applies) and
        // a controlled thinking budget. The system instruction is kept
        // BYTE-FOR-BYTE STABLE so implicit caching can subsidise the standards
        // across calls; the per-dialect guidance moves into the prompt body
        // below where it does not pollute the cache key.
        let dialectGuidance = '';
        if (isDiagramArtifact) {
            modelConfig.systemInstruction = DIAGRAM_SYSTEM_INSTRUCTION;
            modelConfig.thinkingConfig = { thinkingBudget: THINKING_BUDGET.medium };
            modelConfig.topP = modelConfig.topP ?? 0.9;
            dialectGuidance = buildDialectInstruction(template.type);
        }

        if (template.type.startsWith('mermaid')) {
            formatInstructions += this.getMermaidFormatInstructions(template.type);
            formatInstructions += buildMermaidQualityReinforcement();
        } else if (template.type === 'react-flow-graph') {
            formatInstructions = `Generate a valid JSON object with 'nodes' and 'edges' arrays for React Flow.

NODE REQUIREMENTS:
- type: always 'custom'
- position: {x, y} (initial coordinates, layout engine will reposition)
- data.label: The display name of the component
- data.type: Technology or role keyword that determines the visual icon and color. Use SPECIFIC technology names when possible (e.g., 'PostgreSQL', 'Kafka', 'React', 'API Gateway', 'Lambda', 'Docker', 'Redis'). For actors use 'Person', 'User', 'Admin'. For databases use 'Database', 'PostgreSQL', 'MongoDB', etc.
- data.description: Brief description of what this component does (1-2 sentences)
- data.shape (OPTIONAL): Visual shape hint. Use 'cylinder' for databases/storage, 'hexagon' for microservices/functions, 'cloud' for cloud/external services, 'person' for actors/users, 'diamond' for gateways/routers/decisions, 'tab-box' for containers/namespaces. Default is 'rectangle'.
- data.group (OPTIONAL): Logical zone name to group related nodes (e.g., 'Cloud Infrastructure', 'On-Premise', 'DMZ', 'Frontend Layer', 'Data Layer')
- data.icon (OPTIONAL): Specific technology hint for icon selection (e.g., 'kafka', 'postgresql', 'kubernetes', 'react', 'nginx')

EDGE REQUIREMENTS:
- id, source, target: Required identifiers
- label: Descriptive label for the connection (e.g., 'REST/HTTPS', 'Pub/Sub events', 'SQL queries', 'gRPC')
- edgeType (OPTIONAL): Relationship classification. Use 'sync' for HTTP/REST/gRPC calls, 'async' for events/messages/queues, 'data-flow' for data streams/ETL, 'dependency' for imports/references. Default renders as a standard arrow.

VISUAL STORYTELLING GUIDELINES:
- Create a clear visual hierarchy: primary systems prominent, supporting systems secondary
- Use descriptive labels on edges to show what data/commands flow between components
- Group related nodes logically (all databases together, all frontend components together, etc.)
- Aim for 8-20 nodes for optimal readability
- Every edge should have a meaningful label describing the interaction

Respond ONLY with the JSON object.` + buildMermaidQualityReinforcement();

            // Enhanced schema with optional visual metadata
            modelConfig = {
                ...modelConfig,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'object',
                    properties: {
                        nodes: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    type: { type: 'string' },
                                    position: {
                                        type: 'object',
                                        properties: { x: { type: 'number' }, y: { type: 'number' } },
                                        required: ['x', 'y'],
                                    },
                                    data: {
                                        type: 'object',
                                        properties: {
                                            label: { type: 'string' },
                                            type: { type: 'string' },
                                            description: { type: 'string' },
                                            shape: { type: 'string' },
                                            group: { type: 'string' },
                                            icon: { type: 'string' }
                                        },
                                        required: ['label', 'type', 'description']
                                    }
                                },
                                required: ['id', 'type', 'position', 'data']
                            }
                        },
                        edges: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    source: { type: 'string' },
                                    target: { type: 'string' },
                                    label: { type: 'string' },
                                    edgeType: { type: 'string' }
                                },
                                required: ['id', 'source', 'target']
                            }
                        }
                    },
                    required: ['nodes', 'edges']
                }
            };
        } else if (template.type === 'hybrid-text-diagram') {
            const tname = (template.name ?? '').toLowerCase();
            const isVSM = /flujo\s+de\s+valor|value\s+stream|vsm/.test(tname);
            const isBPMN = /bpmn|proceso\s+de\s+negocio|business\s+process/.test(tname);
            const isDFD = /flujo\s+de\s+datos|data\s+flow|dfd|datos\s+l[oó]gico/.test(tname) || /flujo\s+de\s+datos|data\s+flow|dfd/.test((template.requestContext?.userRequest ?? template.objective ?? '').toLowerCase());
            const dialectGuidance = isDFD
                ? `
LOGICAL DATA FLOW DIAGRAM — DIALECT REQUIREMENTS (MANDATORY):
- Use ONLY Mermaid flowchart LR; do not use experimental DFD syntax or unsupported icons.
- Include at least: 2 external actors/systems as ((Actor)), 4 processes as [Verb + data operation], 2 data stores as [(Store)].
- Use one subgraph named "Límite lógico: <system>" around internal processes and stores.
- Every edge label MUST name the data that moves (e.g. "Reclamo normalizado", "Cobertura vigente", "Orden de pago").
- Avoid blank labels, dangling edges, duplicate IDs and Markdown inside the Mermaid block.
- Keep IDs ASCII/snake_case and labels in Spanish.
- Output a complete Markdown artifact with sections: Propósito, Contrato del DFD lógico, Diagrama renderizable, Notas de trazabilidad.`
                : isVSM
                ? `
VALUE STREAM MAP — DIALECT REQUIREMENTS (MANDATORY):
- Use a flowchart with direction LR.
- Model the END-TO-END flow: Cliente → Solicitud → Proceso 1 → Proceso 2 → … → Entrega → Cliente Final.
- Group steps in subgraphs by ACTOR or DOMAIN: subgraph "Cliente" / "Diseño" / "Producción" / "Logística" / "Soporte".
- Annotate each step with at least one METRIC inside the label or as edge label:
   - Lead Time: "LT 3d"
   - Process Time: "PT 12h"
   - Wait Time: "Wait 2d"
   - Service Level / Volume / Rework when relevant.
- Use diamond {Decisión} for quality gates / approvals.
- Use ((Cliente)) / ((Proveedor)) for actors at the boundaries.
- Highlight bottlenecks/improvement opportunities with classDef warning fill:#fef3c7,stroke:#d97706 then class stepId warning.
- Every edge MUST carry a verb (Solicita / Aprueba / Produce / Empaca / Entrega) and the time metric when known.
- Aim for 6–14 process steps grouped in 3–6 subgraphs.`
                : isBPMN
                    ? `
BPMN-STYLE PROCESS — DIALECT REQUIREMENTS (MANDATORY):
- Use a flowchart with direction LR (or TD when there are many decisions).
- Differentiate ACTORS via subgraph "Actor" blocks (swimlanes).
- Use ((Inicio)) for start events, ((Fin)) for end events.
- Use {Decisión} (diamond) for gateways; label outgoing edges with the decision outcome.
- Use [Actividad] (rectangle) for tasks, [[Subproceso]] (tab-box) for subprocesses.
- Avoid orphan nodes: every node must be part of the sequence.
- Use verbs in every label ("Valida solicitud", "Aprueba pago", "Notifica cliente").`
                    : '';

            formatInstructions += `
Format Requirements:
1. This is a Hybrid artifact. Start with a comprehensive Markdown description/analysis.
2. You MUST include EXACTLY ONE Mermaid diagram block (wrapped in \`\`\`mermaid fence) illustrating the flow, structure, or scenario.
3. Ensure the Mermaid syntax is clean and valid. Do NOT nest fences.
4. The Mermaid block should be placed after the introductory summary but before detailed breakdowns.
5. The Mermaid block is MANDATORY: never produce markdown-only output for this artifact type.

MERMAID DIAGRAM QUALITY STANDARDS (mandatory):
- Choose the most appropriate diagram type: flowchart (graph TD/LR), sequenceDiagram, stateDiagram-v2, or erDiagram.
- Use subgraph blocks or composite states for logical grouping of related elements.
- Apply classDef definitions for semantic color coding when using graph/flowchart:
  classDef frontend fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
  classDef backend fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#1e1b4b
  classDef database fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b
  classDef api fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#2e1065
  classDef queue fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#451a03
  classDef external fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#0f172a
  classDef warning fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#7c2d12
- Use semantic node shapes: [(Cylinder)] for databases, {Diamond} for decisions, ((Circle)) for actors.
- Assign class to every node: class nodeId className
- Include descriptive labels on ALL edges with protocols or actions.
- Aim for 8-15 nodes for optimal readability.
- Output ONLY valid Mermaid v10.9+ syntax inside the fence. Do not add explanations inside the fence.
${dialectGuidance}
`;
            formatInstructions += buildMermaidQualityReinforcement();
        } else if (template.type === 'sdd-brd') {
            formatInstructions = `Generate a comprehensive Business Requirements Document (BRD) following IEEE 830 standard structure.
Use Markdown format with these MANDATORY sections:
# BRD — Business Requirements Document
## 1. Executive Summary
## 2. Business Problem Statement
## 3. Project Objectives (SMART goals)
## 4. Scope
### 4.1 In-Scope
### 4.2 Out-of-Scope
## 5. Stakeholder Analysis
| Stakeholder | Role | Interest | Influence |
## 6. Business Requirements
List each as: **BR-XXX**: [Requirement description] — *Priority: High/Medium/Low*
## 7. Assumptions and Constraints
## 8. Success Criteria and KPIs
## 9. Risks and Mitigation
## 10. Approval and Sign-off
Include specific, measurable, domain-relevant content. No generic placeholders.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-use-case') {
            formatInstructions = `Generate a complete Use Case Specification document following UML 2.5 format.
Use Markdown. For each major use case include:
# Use Case Specifications
## UC-001: [Use Case Name]
- **Actor(s):** Primary and secondary actors
- **Preconditions:** State before execution
- **Postconditions (Success):** System state after success
- **Postconditions (Failure):** System state after failure
- **Main Flow:** Numbered steps (actor/system alternating)
- **Alternative Flows:** Label as AF-001a, AF-001b...
- **Exception Flows:** Label as EX-001a...
- **Business Rules:** Referenced rules (BR-XXX)
- **NFR References:** Performance, security constraints
Generate 5-8 detailed use cases relevant to the project domain. Be specific, not generic.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-user-story') {
            formatInstructions = `Generate a User Story Map with a prioritized product backlog following SAFe/Scrum format.
Use Markdown with this structure:
# User Story Map — [Project Name]
## User Journey Overview
[Brief paragraph describing the user's end-to-end journey]
## Epic Breakdown
### Epic 1: [Name]
**Epic:** As a [role], I want [capability] so that [business benefit]
#### Feature 1.1: [Name]
**Story 1.1.1 (MVP):** As a [role], I want [action] so that [benefit]
  - AC1: Given [context] When [action] Then [outcome]
  - AC2: ...
  - Story Points: [estimate]
  - Priority: Must Have / Should Have / Could Have / Won't Have
Include 4-6 Epics with 3-5 Stories each. Mark MVP stories explicitly. Use the MoSCoW prioritization method.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-domain-model') {
            formatInstructions = `Generate a DDD Domain Model document with a Mermaid diagram.
Use Markdown format:
# Domain Model — DDD
## 1. Subdomain Map
Identify Core Domain, Supporting Subdomains, and Generic Subdomains.
## 2. Bounded Contexts
For each Bounded Context describe its responsibility and team ownership.
## 3. Context Map
Describe relationships: Partnership, Customer-Supplier, Conformist, ACL, Published Language, Shared Kernel.
## 4. Aggregates and Entities
For each Bounded Context, list Aggregates with their Entities and Value Objects.

Then include ONE Mermaid diagram block (\`\`\`mermaid) showing the Bounded Contexts and their relationships using a graph TD or classDiagram.

DDD DIAGRAM QUALITY STANDARDS:
- Use classDiagram for Bounded Context internals: show Aggregates, Entities, Value Objects, and their relationships.
- Use graph TD with subgraph blocks if showing Context Map relationships (Partnership, ACL, Customer-Supplier).
- Apply classDef for semantic color coding when using graph TD:
  classDef core fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
  classDef support fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b
  classDef generic fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#0f172a
  classDef aggregate fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#2e1065
- Label all relationships with their DDD pattern type (e.g., "ACL", "Shared Kernel", "Open Host Service").
- Show cardinality on classDiagram associations.
- Output ONLY valid Mermaid v10.9+ syntax inside the fence.

## 5. Domain Events
List significant domain events (past tense, e.g., PolicyIssued, ClaimApproved).
## 6. Repository Interfaces
Key repository contracts per Aggregate.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-event-storming') {
            formatInstructions = `Generate an Event Storming analysis document with a Mermaid sequence diagram.
Use Markdown format:
# Event Storming — Domain Discovery
## 1. Process Overview
[Describe the business process being modeled]
## 2. Domain Events (Naranja)
List all significant domain events in past tense, grouped by phase.
## 3. Commands (Azul)
For each event, the command that triggered it and who issues it.
## 4. Actors and External Systems
Who or what issues the commands.
## 5. Policies and Business Rules (Lila)
Automated reactions: "When [event] Then [command]"
## 6. Read Models (Verde)
Information views that actors consult before issuing commands.
## 7. Hot Spots and Unknowns (Rojo)
Areas of complexity, conflict, or uncertainty.

Then include ONE Mermaid sequenceDiagram (\`\`\`mermaid) showing the key event flow with actors, commands and events.

SEQUENCE DIAGRAM QUALITY STANDARDS:
- Declare ALL participants at the top with descriptive aliases.
- Use activate/deactivate to show processing time.
- Use Note over to annotate key domain policies or business rules.
- Use alt/else/end blocks to show conditional event flows (success vs error paths).
- Use rect rgb(...) blocks to visually group related command-event pairs.
- Label every message with the event/command name (past tense for events, imperative for commands).
- Output ONLY valid Mermaid v10.9+ sequenceDiagram syntax inside the fence.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-glossary') {
            formatInstructions = `Generate a comprehensive Ubiquitous Language Glossary for DDD.
Use Markdown format:
# Glosario — Lenguaje Ubicuo
## Overview
[Brief paragraph on the purpose and governance of this glossary]
## Términos del Dominio
| Término | Bounded Context | Definición | Alias / Términos a Evitar | Ejemplo de uso |
|---------|----------------|-----------|--------------------------|----------------|
[Fill with 25-40 domain-specific terms]
## Relaciones entre Términos
Describe key conceptual relationships between terms.
## Governance
Rules for maintaining and evolving the glossary.
Be very specific to the project domain. No generic software terms — domain business terms only.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-nfr') {
            formatInstructions = `Generate a Non-Functional Requirements specification following ISO 25010 quality characteristics.
Use Markdown format:
# NFR — Non-Functional Requirements Specification
## Quality Model Reference (ISO 25010)
[Brief overview of characteristics applied]
## NFR Catalog
For each requirement use this format:
**NFR-[ID]**: [Title]
- **Category:** [ISO 25010 characteristic: Performance Efficiency / Security / Reliability / Usability / Maintainability / Portability / Compatibility / Functional Suitability]
- **Statement:** [Precise, measurable requirement]
- **Metric:** [How it is measured]
- **Target:** [Specific threshold, e.g., p95 < 200ms]
- **Priority:** Critical / High / Medium
- **Verification Method:** [Automated test / Load test / Security audit / Manual review]
- **Related Requirements:** [BR-XXX, UC-XXX]
Cover at minimum: Performance (5 NFRs), Security (5 NFRs), Reliability/Availability (3 NFRs), Scalability (3 NFRs), Maintainability (3 NFRs). Total 20+ NFRs.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-bdd') {
            formatInstructions = `Generate BDD acceptance scenarios in Gherkin syntax (Feature/Scenario/Given/When/Then).
Use Markdown with embedded Gherkin blocks:
# BDD Scenarios — Gherkin Specification
## Overview
[Brief description of the features covered]
For each Feature use this format:
\`\`\`gherkin
Feature: [Feature Name]
  As a [role]
  I want [capability]
  So that [benefit]

  Background:
    Given [common precondition]

  Scenario: [Happy path name]
    Given [initial context]
    When [action performed]
    Then [expected outcome]
    And [additional assertion]

  Scenario: [Alternative/Error scenario name]
    Given [context]
    When [action with variation]
    Then [different outcome]

  Scenario Outline: [Parameterized scenario]
    Given [context with <parameter>]
    When [action]
    Then [outcome with <expected>]
    Examples:
      | parameter | expected |
      | value1    | result1  |
\`\`\`
Generate 4-6 Features with 3-5 Scenarios each. Cover happy paths, edge cases and error cases.
${sddSkillMarkdownGuidance}`;
        } else if (template.type === 'sdd-traceability') {
            formatInstructions = `Generate a Requirements Traceability Matrix (RTM) following IEEE 29148.
Use Markdown format:
# Matriz de Trazabilidad de Requisitos (RTM)
## 1. Coverage Summary
| Metric | Count | Coverage % |
|--------|-------|-----------|
| Business Requirements | X | X% |
| Use Cases | X | X% |
| User Stories | X | X% |
| Test Cases | X | X% |
## 2. Forward Traceability Matrix
| BR-ID | Requirement | UC-ID | Use Case | US-ID | User Story | Component | TC-ID | Test Case | Status |
|-------|-------------|-------|----------|-------|------------|-----------|-------|-----------|--------|
[Populate with real project requirements and mappings]
## 3. Reverse Traceability Matrix
| TC-ID | Test Case | US-ID | User Story | UC-ID | Use Case | BR-ID | Business Req |
|-------|-----------|-------|------------|-------|----------|-------|-------------|
[Populated from above matrix, reversed]
## 4. Uncovered Requirements
List any BRs without corresponding test cases.
## 5. Traceability Health Metrics
Coverage percentages and risk assessment.
Generate 15-20 requirements with complete traceability chains. Be domain-specific.
${sddSkillMarkdownGuidance}`;
        }

        const consistencyInstructions = previousArtifact ? `
*** CONSISTENCY UPDATE ***
Update the following PREVIOUS VERSION based on the new context, but PRESERVE specific logic/actors unless contradicted.
PREVIOUS CONTENT:
\`\`\`
${previousArtifact.content}
\`\`\`
` : `*** NEW ARTIFACT *** Create a detailed first version.`;

        const generationContract = template.requestContext?.generationContract;
        const controlledContext = generationContract
            ? support.controlledContext(project, generationContract, 900)
            : null;
        const requestContextInstructions = template.requestContext ? `
*** ON-DEMAND ARTIFACT REQUEST CONTEXT ***
This artifact was explicitly requested by an architect after reviewing a recommendation. Treat this context as primary product intent, not as optional background.
- Original user request: ${template.requestContext.userRequest}
- Matched catalog standard: ${template.requestContext.matchedCatalogTemplateName ?? 'Custom compatible artifact'}
- Intended audience: ${template.requestContext.audience ?? 'mixed'}
- Recommendation rationale: ${template.requestContext.rationale ?? 'Use the selected artifact type to communicate the request clearly.'}
- Approved construction plan:
${(template.requestContext.constructionPlan ?? []).map((step, index) => `  ${index + 1}. ${step}`).join('\n') || '  1. Generate a complete, renderable and editable artifact.'}
${generationContract ? `
*** STRUCTURED ARTIFACT GENERATION CONTRACT ***
- Contract id: ${generationContract.id}
- Normalized intent: ${generationContract.normalizedIntent}
- Audience: ${generationContract.audience}
- Purpose: ${generationContract.purpose}
- Detail level: ${generationContract.detailLevel}
- Artifact family preference: ${generationContract.artifactFamily}
- Quality target: ${generationContract.qualityTarget}/100
- Export targets: ${generationContract.exportTargets.join(', ') || 'not specified'}
- Visual preferences: ${JSON.stringify(generationContract.visualPreferences ?? {})}
- Acceptance criteria (must satisfy every item):
${generationContract.acceptanceCriteria.map((criterion, index) => `  ${index + 1}. ${criterion}`).join('\n') || '  1. Produce a complete, reviewable artifact.'}
- Required source artifact ids: ${generationContract.requiredSourceArtifactIds.join(', ') || 'none'}
- Optional source artifact ids: ${generationContract.optionalSourceArtifactIds.join(', ') || 'none'}
- Excluded source artifact ids: ${generationContract.excludedSourceArtifactIds.join(', ') || 'none'}
` : ''}

MANDATORY: The generated content must directly answer the original user request and must not fall back to a generic catalog example.
ON-DEMAND QUALITY BAR:
- Build the artifact as an architect-ready deliverable, not a first draft. Use project-specific actors, systems, decisions, risks and integration points from the available project context.
- If the contract has selected sources, use only mandatory/optional sources listed in the controlled context section as evidence. Do not use excluded sources.
- Explicitly cover every acceptance criterion and preserve the intended audience, purpose, detail level and output format.
- For process/workflow diagrams, prefer a left-to-right readable flow with 8-14 meaningful nodes, explicit decision branches, short verb-led labels and grouped lanes/boundaries. Avoid tall single-column diagrams unless the user explicitly asks for that orientation.
- For hybrid artifacts, keep the narrative concise and structured: purpose, scope, key decisions/assumptions, diagram, quality notes and next validation steps.
- Make traceability visible: cite which context signals or existing artifacts influenced the artifact and what assumptions should be validated by the architect.
${!isDiagramArtifact ? buildOnDemandDocumentReinforcement(template) : ''}
` : '';

        // Documents born from "Artefacto a solicitud" benefit from a brief
        // thinking pass too — without it the model can produce a flat,
        // bullet-only outline. Cost stays bounded because the prompt is small
        // and the document path uses no responseSchema.
        if (!isDiagramArtifact && template.requestContext) {
            modelConfig.thinkingConfig = modelConfig.thinkingConfig ?? { thinkingBudget: THINKING_BUDGET.low };
            modelConfig.topP = modelConfig.topP ?? 0.92;
        }

        const dialectBlock = dialectGuidance
            ? `\n\nDIALECT GUIDANCE (per-artifact constraint):\n${dialectGuidance}\n`
            : '';

        // Pre-extract structural signals from the full project context. This
        // is a deterministic, regex-based pass that surfaces actors, systems,
        // integrations, data stores, queues and protocols mentioned anywhere
        // in description / projectContext / artifact metadata. Surfacing them
        // explicitly raises diagram quality on saturated infra (the model
        // grabs them faster than it scans free text) AND saves token budget
        // for the actual generation.
        const diagramSignalsBlock = isDiagramArtifact
            ? renderDiagramSignals(extractDiagramSignals(project), template.type)
            : '';

        // Catalog document quality reinforcement applies to every non-diagram
        // catalog artefact (BRD, NFR, glossary, traceability, executive
        // summary, etc.). On-demand documents already get their own bar via
        // requestContextInstructions; we skip the catalog one to avoid
        // duplicating bullet sets in the same prompt.
        const catalogDocumentReinforcement = (!isDiagramArtifact && !template.requestContext)
            ? buildCatalogDocumentReinforcement(template)
            : '';

        // Architecture Context Graph reinforcement: a deterministic, ranked and
        // citable slice of the project's structured context (entities,
        // relationships, decisions, risks, constraints, conflicts). It replaces
        // the habit of dumping raw accumulated text and gives the model a
        // traceable source it must cite. Degrades to '' on any failure so it
        // can never break generation.
        const contextGraphBlock = renderContextGraphReinforcement(
            project,
            settings,
            {
                artifactType: template.type,
                intent: template.requestContext?.userRequest ?? template.objective,
                audience: template.requestContext?.audience,
                architecturalView: template.architecturalView,
                phase: template.phase,
                language: settings.language,
                detailLevel: isDiagramArtifact ? 'minimal' : 'standard',
                relatedArtifactIds: previousArtifact ? [previousArtifact.id] : undefined,
            },
            template.requestContext,
        );

        // Architecture Knowledge Graph reinforcement: the canonical, persisted
        // model of the project's architectural knowledge. The block is built
        // and budgeted by the caller (`buildArtifactGenerationGraphContext`)
        // so the prompt never bloats; an empty string degrades to a no-op.
        const architectureGraphBlock =
            typeof opts.architectureGraphPromptBlock === 'string'
                && opts.architectureGraphPromptBlock.trim().length > 0
                ? `\n\n${opts.architectureGraphPromptBlock}\n`
                : '';

        // Last-line guard: never let an excluded source leak into the prompt
        // as usable evidence. This is non-blocking — it corrects/observes but
        // removes the controlled block if a critical leak is detected.
        let controlledContextPromptBlock = controlledContext?.promptBlock ?? '';
        if (controlledContext) {
            const contextValidation = controlledContext;
            if (!contextValidation.ok) controlledContextPromptBlock = `
## Selección controlada de fuentes/contexto
- Omitida por validación de seguridad: ${contextValidation.errors.join(' · ')}
`;
            if (!contextValidation.ok || contextValidation.warnings.length > 0) {
                emit({
                    stage: 'prompt',
                    status: contextValidation.ok ? 'warning' : 'error',
                    message: contextValidation.ok
                        ? 'Selección de contexto validada con advertencias.'
                        : 'Selección de contexto con errores críticos; se omitió el bloque controlado para evitar fugas.',
                    detail: [...contextValidation.errors, ...contextValidation.warnings].join(' · ').slice(0, 600) || undefined,
                    meta: {
                        controlledContextOk: contextValidation.ok,
                        controlledContextErrors: contextValidation.errors.length,
                        controlledContextWarnings: contextValidation.warnings.length,
                        controlledContextPromptOmitted: !contextValidation.ok,
                    },
                });
            }
        }
        const promptArtifactsContext = generationContract ? '' : artifactsContext;

        // World-class document standard: Markdown deliverables must read like
        // formal consulting documents — executive summary, embedded rendered
        // diagrams, declarative charts and editorial callouts. The renderer
        // (DocumentPaper) turns ```mermaid into a live diagram, ```chart into
        // an SVG chart and `> [!NOTE]`-style quotes into callout cards.
        // YAML artifacts are excluded (visual blocks would corrupt the spec).
        if (template.representation === 'document' && template.type !== 'yaml' && !isDiagramArtifact) {
            const siblingDiagramsBlock = buildSiblingDiagramsPromptBlockUtil(project, {
                excludeVersionGroupId: previousArtifact?.versionGroupId,
            });
            formatInstructions += `

DOCUMENT VISUAL & STRUCTURE STANDARD (world-class deliverable, on par with TOGAF/consulting-grade outputs):
- Open with "## Resumen Ejecutivo" (3-6 lines a C-level reader absorbs in 60 seconds), then the body sections, then "## Próximos Pasos" or a closing section.
- Embed AT LEAST ONE Mermaid diagram in a \`\`\`mermaid fence where architecture, flows or relationships are described (flowchart/sequence as fits). Keep it 5-12 nodes, valid official syntax. Add a one-line italic caption under each diagram ("*Figura N: …*").
- TABLES ARE MANDATORY for enumerable content: any set of 3+ items that share attributes (risks, requirements, components, decisions, integrations, gaps, KPIs) MUST be a Markdown table with meaningful columns (e.g. ID, descripción, impacto, prioridad, responsable) — never a flat bullet list. A substantive document is expected to contain MULTIPLE tables.
- When the content includes quantitative aspects (effort, costs, distribution, risk counts, capacity), include a \`\`\`chart fence with this exact JSON shape:
  { "type": "bar"|"line"|"pie"|"donut", "title": "…", "labels": ["…"], "series": [{ "name": "…", "values": [n, …] }], "unit": "opcional" }
  Values must match labels in length. Use real numbers derived from the content, never invented precision.
- Highlight decisions, risks and caveats with GitHub-style callouts: "> [!IMPORTANT] …", "> [!WARNING] …", "> [!NOTE] …", "> [!TIP] …" (one line each, on their own blockquote).
- Cross-reference sibling artifacts by their exact names when you rely on them, so the reader can navigate the project.
- Never sacrifice substance for visuals: every diagram/chart/table must reflect content already explained in prose.
${siblingDiagramsBlock}`;
        }

        const fullPrompt = `
${basePrompt}
${promptArtifactsContext}
${requestContextInstructions}${controlledContextPromptBlock}${dialectBlock}${diagramSignalsBlock}${contextGraphBlock}${architectureGraphBlock}

Task: Create Artifact
- Name: "${template.name}"
- Type: ${template.type}
- Objective: ${template.objective}
- Key Concepts: ${template.keyConcepts.map(kc => `${kc.term}: ${kc.definition}`).join(', ')}

${consistencyInstructions}

${formatInstructions}
${catalogDocumentReinforcement}
`;

        emit({
            stage: 'prompt',
            status: 'success',
            message: 'Prompt construido y configuración resuelta.',
            detail: `Modelo ${modelName} · temperatura ${modelConfig.temperature.toFixed(2)} · thinkingBudget=${modelConfig.thinkingConfig?.thinkingBudget ?? 'default'}.`,
            meta: {
                model: modelName,
                temperature: Number(modelConfig.temperature.toFixed(2)),
                thinkingBudget: modelConfig.thinkingConfig?.thinkingBudget ?? -1,
                promptLength: fullPrompt.length,
            },
        });

        let raw: string;
        try {
            emit({
                stage: 'ai-generation',
                status: 'in-progress',
                message: `Invocando a Gemini (${modelName}).`,
                detail: template.requestContext
                    ? 'Modo on-demand con timeout reducido y candidatos acotados.'
                    : 'Modo catálogo con cadena de fallback completa.',
                meta: { model: modelName, onDemand: Boolean(template.requestContext) },
            });
            raw = await this.generateTextWithFallback(settings, modelName, fullPrompt, modelConfig, template.requestContext ? {
                // On-demand artefacts: previous limits (45s diagrams, 60s docs)
                // were brushing the edge of the saturated-infra reality where
                // Gemini Flash with thinking can take 35-55s on its own. Give
                // the request a realistic ceiling AND retry the underlying
                // model once on transient blips before falling back.
                timeoutMs: isDiagramArtifact ? 75000 : 90000,
                maxCandidates: isDiagramArtifact ? 3 : 3,
                maxRetries: 2,
            } : {
                // Catalog artefacts also benefit from a couple of retries on
                // transient errors — the user has no reason to be punished by
                // a single 503 when Gemini routinely recovers in 1-3s.
                maxRetries: 2,
            });
            if (!raw || raw.trim().length === 0) {
                console.warn(`[artifactGenerationEngine] Empty generation for "${template.name}"; using deterministic fallback.`);
                emit({
                    stage: 'ai-generation',
                    status: 'warning',
                    message: 'Gemini devolvió contenido vacío; aplicando fallback determinístico.',
                });
                return support.deterministicArtifact(project, template);
            }
            emit({
                stage: 'ai-generation',
                status: 'success',
                message: `Respuesta recibida: ${raw.length} caracteres.`,
                meta: { contentLength: raw.length },
            });
        } catch (error) {
            if (this.isLocalGenerationFallbackCandidate(error)) {
                const friendly = classifyAIError(error);
                console.warn(
                    `[artifactGenerationEngine] Artifact generation used local fallback for "${template.name}" (${friendly.category}).`,
                    friendly.message,
                );
                const rawMessage = friendly.message?.toString().slice(0, 320) ?? '';
                emit({
                    stage: 'ai-generation',
                    status: 'warning',
                    message: `Gemini falló (${friendly.category}); generando fallback local determinístico para no dejar el canvas vacío.`,
                    detail: rawMessage
                        ? `${friendly.userMessage} · Detalle del SDK: ${rawMessage}`
                        : friendly.userMessage,
                    meta: {
                        errorCategory: friendly.category,
                        status: friendly.status ?? 0,
                        rawMessage,
                    },
                });
                return support.deterministicArtifact(project, template);
            }
            const fallbackRaw = error instanceof Error ? error.message : String(error);
            emit({
                stage: 'ai-generation',
                status: 'error',
                message: 'Error no recuperable durante la generación con Gemini.',
                detail: fallbackRaw,
                meta: { rawMessage: fallbackRaw.slice(0, 320) },
            });
            throw error;
        }

        // Post-LLM validation for diagram outputs.  If the model returned Mermaid
        // that does not yield a parseable IR, attempt up to two retries with
        // increasingly explicit fallback instructions.  React-Flow JSON is
        // already schema-validated by the SDK.
        if (template.type.startsWith('mermaid') || template.type === 'hybrid-text-diagram') {
            const firstAssessment = this.assessMermaidArtifact(raw, template.type);
            if (firstAssessment.ok) return raw;

            console.warn(
                `[artifactGenerationEngine] Diagram artifact "${template.name}" failed post-LLM validation:`,
                firstAssessment.reason,
            );

            // Attempt 1: stricter regeneration in the same dialect.
            const reinforcedPrompt = `${fullPrompt}

PREVIOUS ATTEMPT FAILED PARSING (${firstAssessment.reason}). Regenerate ensuring:
 - The Mermaid header line is present (e.g. "C4Container", "flowchart TD", "sequenceDiagram").
 - At least 4 unique nodes AND at least 3 relationships are declared.
 - Every declaration uses the exact official Mermaid syntax for the chosen dialect.
 ${template.type === 'hybrid-text-diagram' ? '- Return complete Markdown with EXACTLY ONE fenced ```mermaid block, preserving the hybrid artifact contract.' : '- Do NOT wrap the response in markdown fences — output only the raw Mermaid.'}
 - Do NOT include invalid Mermaid comments or explanatory prose inside the diagram block.`;
            try {
                const retry = await this.generateTextWithFallback(settings, modelName, reinforcedPrompt, modelConfig);
                const retryAssessment = this.assessMermaidArtifact(retry, template.type);
                if (retryAssessment.ok) return retry;
                console.warn(
                    `[artifactGenerationEngine] Diagram retry still invalid (${retryAssessment.reason}); attempting flowchart fallback.`,
                );

                // Attempt 2: degrade to the most permissive dialect (flowchart)
                // so the artifact is at least viewable while the user can ask
                // for a regeneration in the original dialect.
                if (template.type.startsWith('mermaid') || template.type === 'hybrid-text-diagram') {
                    const fallbackPrompt = this.buildFlowchartFallbackPrompt(template, basePrompt, promptArtifactsContext, consistencyInstructions);
                    try {
                        const fallback = await this.generateTextWithFallback(settings, modelName, fallbackPrompt, {
                            ...modelConfig,
                            temperature: 0.2,
                        });
                        const normalizedFallback = template.type === 'hybrid-text-diagram'
                            ? buildHybridMarkdownFromMermaid(template, fallback)
                            : fallback;
                        const fallbackAssessment = this.assessMermaidArtifact(normalizedFallback, template.type === 'hybrid-text-diagram' ? 'hybrid-text-diagram' : 'mermaid-graph');
                        if (fallbackAssessment.ok) {
                            console.warn(
                                `[artifactGenerationEngine] Returned flowchart fallback for "${template.name}" — original dialect failed twice.`,
                            );
                            return normalizedFallback;
                        }
                        console.warn(
                            `[artifactGenerationEngine] Flowchart fallback for "${template.name}" also failed:`,
                            fallbackAssessment.reason,
                        );
                    } catch (fallbackErr) {
                        console.warn('[artifactGenerationEngine] Flowchart fallback threw:', fallbackErr);
                    }
                }

                // Return whichever output had the most nodes — better something
                // partial than nothing at all (the canvas surfaces a quality
                // warning either way).
                const best = retryAssessment.nodeCount >= firstAssessment.nodeCount ? retry : raw;
                const bestAssessment = retryAssessment.nodeCount >= firstAssessment.nodeCount
                    ? retryAssessment
                    : firstAssessment;
                // If even the best AI attempt has zero parseable nodes, return
                // a deterministic skeleton so the canvas never stays blank.
                if (bestAssessment.nodeCount === 0 && (template.type.startsWith('mermaid') || template.type === 'hybrid-text-diagram')) {
                    console.warn(
                        `[artifactGenerationEngine] All AI attempts produced zero nodes for "${template.name}"; emitting deterministic skeleton.`,
                    );
                    return support.deterministicDiagramSkeleton(project, template);
                }
                return best;
            } catch (retryErr) {
                console.warn('[artifactGenerationEngine] Diagram retry failed entirely:', retryErr);
                // The retry threw before we could measure it. Use the raw
                // first-attempt output if it has any content; otherwise drop
                // back to the deterministic skeleton.
                if (firstAssessment.nodeCount > 0) return raw;
                if (template.type.startsWith('mermaid') || template.type === 'hybrid-text-diagram') {
                    return support.deterministicDiagramSkeleton(project, template);
                }
                return raw;
            }
        }

        // Document quality gate (non-diagram artifacts). Mirrors the diagram
        // self-healing philosophy: assess deterministically, retry ONCE with
        // explicit corrective instructions when the output is truncated or
        // structurally unusable, and keep the better of the two attempts.
        // Diagrams never reach this branch (handled above); the wrapper's
        // renderability gate still runs afterwards.
        const expectVisualEnrichment = template.representation === 'document' && template.type !== 'yaml';
        const firstDocAssessment = assessDocumentArtifact(raw, {
            expectStructuredDocument: template.representation === 'document',
            expectVisualEnrichment,
        });
        if (template.representation !== 'diagram' && !firstDocAssessment.ok) {
            emit({
                stage: 'validation',
                status: 'warning',
                message: firstDocAssessment.truncated
                    ? 'El documento parece truncado; reintentando con instrucciones correctivas.'
                    : 'El documento no pasó la validación estructural; reintentando.',
                detail: firstDocAssessment.issues.map((i) => i.code).join(', '),
                meta: { score: firstDocAssessment.score, truncated: firstDocAssessment.truncated },
            });
            const correctivePrompt = `${fullPrompt}

PREVIOUS ATTEMPT WAS REJECTED BY THE QUALITY GATE (${firstDocAssessment.issues.map((i) => i.message).join(' · ')}).
Regenerate the COMPLETE artifact ensuring:
 - The document is fully finished: it must end with a complete closing section/sentence, never mid-phrase, mid-table or inside an unclosed code fence.
 - Every fenced code block is properly closed with \`\`\`.
 - The document has a clear heading structure (##) with substantive content per section.
 - It meets the visual standard: at least one valid \`\`\`mermaid diagram AND Markdown tables for every enumeration of 3+ comparable items.
 - Do not summarise or apologise — output only the complete artifact content.`;
            try {
                const retryDoc = await this.generateTextWithFallback(settings, modelName, correctivePrompt, modelConfig);
                const retryAssessment = assessDocumentArtifact(retryDoc, {
                    expectStructuredDocument: template.representation === 'document',
                    expectVisualEnrichment,
                });
                const useRetry = retryAssessment.ok || retryAssessment.score > firstDocAssessment.score;
                emit({
                    stage: 'validation',
                    status: (useRetry ? retryAssessment.ok : firstDocAssessment.ok) ? 'success' : 'warning',
                    message: useRetry
                        ? `Reintento correctivo aplicado (score ${retryAssessment.score} vs ${firstDocAssessment.score}).`
                        : `Se conserva el primer intento (score ${firstDocAssessment.score}); el reintento no mejoró.`,
                    meta: { firstScore: firstDocAssessment.score, retryScore: retryAssessment.score },
                });
                return useRetry ? retryDoc : raw;
            } catch (retryErr) {
                console.warn('[artifactGenerationEngine] Document corrective retry failed; keeping first attempt.', retryErr);
                return raw;
            }
        }

        // Final return — the public `generateArtifactContent` wrapper applies
        // the renderability gate, so we just hand the raw content back.
        return raw;
    }

    /**
     * Renderability gate — last-mile check that runs *before* the generated
     * content is persisted to Firestore.
     *
     * The user-facing failure mode we are eliminating: the canvas shows the
     * dotted-grid background with NO nodes and NO error overlay because:
     *  - the model returned text the deterministic parser silently rejected;
     *  - no exception was thrown, so the catch block never engaged;
     *  - the artifact was persisted with that broken content;
     *  - the renderer's placeholder fallback couldn't display either because
     *    the content WAS technically Mermaid-shaped but parsed to zero nodes.
     *
     * This gate runs `mermaidToIR` on the candidate content and, if the
     * resulting IR has < 2 nodes, replaces the content with the deterministic
     * skeleton (which is unit-tested as parseable). Only diagram artifacts go
     * through here; document/yaml/markdown content is untouched.
     */
    private gateRenderableDiagramContent(
        raw: string,
        project: Project,
        template: ArtifactTemplate,
        support: ArtifactGenerationSupport,
        emit: (event: Omit<ArtifactGenerationPhaseEvent, 'at'>) => ArtifactGenerationPhaseEvent,
    ): string {
        const isDiagramArtifact = isDiagramArtifactType(template.type);
        if (!isDiagramArtifact) return raw;
        if (template.type === 'react-flow-graph') {
            // ReactFlow JSON is validated by the SDK responseSchema. If we got
            // empty text or invalid JSON we still return raw to surface the
            // failure visually via the canvas placeholder rather than masking
            // it behind a Mermaid skeleton.
            return raw;
        }
        if (!raw || raw.trim().length === 0) {
            const skeleton = support.deterministicDiagramSkeleton(project, template);
            emit({
                stage: 'validation',
                status: 'warning',
                message: 'Contenido vacío detectado en compuerta de renderabilidad; usando skeleton determinista.',
                meta: { contentLength: 0, fallback: 'skeleton' },
            });
            return skeleton;
        }
        let body = raw;
        if (template.type === 'hybrid-text-diagram') {
            const match = raw.match(/```mermaid\s*([\s\S]*?)\s*```/i);
            if (match && match[1]) body = match[1];
        }
        try {
            const ir = mermaidToIR(body);
            const nodeCount = ir?.nodes?.length ?? 0;
            const edgeCount = ir?.edges?.length ?? 0;
            // Treat <2 nodes as unrenderable. Even a system-context diagram
            // needs at least an actor + system to be meaningful.
            if (nodeCount < 2) {
                const skeleton = support.deterministicDiagramSkeleton(project, template);
                emit({
                    stage: 'validation',
                    status: 'warning',
                    message: `Compuerta de renderabilidad: contenido parseó a ${nodeCount} nodo(s). Sustituyendo por skeleton determinista para evitar canvas vacío.`,
                    detail: `nodeCount=${nodeCount} edgeCount=${edgeCount} contentLen=${raw.length}`,
                    meta: { nodeCount, edgeCount, fallback: 'skeleton' },
                });
                return skeleton;
            }
            emit({
                stage: 'validation',
                status: 'success',
                message: `Compuerta de renderabilidad superada: ${nodeCount} nodos, ${edgeCount} aristas.`,
                meta: { nodeCount, edgeCount },
            });
            return raw;
        } catch (err) {
            const skeleton = support.deterministicDiagramSkeleton(project, template);
            emit({
                stage: 'validation',
                status: 'warning',
                message: 'Compuerta de renderabilidad: parser arrojó excepción. Sustituyendo por skeleton determinista.',
                detail: err instanceof Error ? err.message : String(err),
                meta: { fallback: 'skeleton', parserError: err instanceof Error ? err.message : 'unknown' },
            });
            return skeleton;
        }
    }

    /**
     * Build a degraded prompt that asks for a flowchart equivalent of the
     * requested C4/hybrid artifact. Flowcharts use the most permissive Mermaid
     * dialect, so this serves as a final safety net before the artifact is
     * persisted with empty content.
     */
    private buildFlowchartFallbackPrompt(
        template: ArtifactTemplate,
        basePrompt: string,
        artifactsContext: string,
        consistencyInstructions: string,
    ): string {
        return `${basePrompt}
${artifactsContext}

Task: Re-create the artifact "${template.name}" as a Mermaid FLOWCHART so the canvas can render it.
Original artifact type: ${template.type}.
Objective: ${template.objective}.

${consistencyInstructions}

Produce ONLY raw Mermaid using the flowchart dialect. Mandatory shape:
- First line: "flowchart TD" (or "flowchart LR" if the flow is conversational).
- Use [Rectangle], (Rounded), {Diamond}, [(Cylinder)], ((Circle)) shapes to convey semantic intent.
- Include subgraph blocks for boundaries (e.g. "subgraph SB[Sistema]").
- Use classDef + class assignments to colour by role: frontend/backend/database/external.
- Every edge must have a verb-action label (\`-->|"Verbo objeto"|\`).
- 6 to 14 nodes, 5 to 18 edges.
- Output the diagram only — no fences, no commentary.`;
    }

    /**
     * Inspect a Mermaid (or hybrid) artifact and report whether it is usable.
     * Returns a structured assessment so callers can log meaningful diagnostics
     * and decide whether to retry / fall back.
     */
    private assessMermaidArtifact(
        raw: string,
        templateType: string,
    ): { ok: boolean; reason?: string; nodeCount: number; edgeCount: number } {
        if (!raw) {
            return { ok: false, reason: 'empty response', nodeCount: 0, edgeCount: 0 };
        }
        let body = raw;
        if (templateType === 'hybrid-text-diagram') {
            const match = raw.match(/```mermaid\s*([\s\S]*?)\s*```/i);
            if (!match) {
                return { ok: false, reason: 'hybrid response missing ```mermaid fence', nodeCount: 0, edgeCount: 0 };
            }
            body = match[1];
        } else {
            // Diagram artifacts: tolerate a stray fence the AI may add anyway.
            const fenced = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
            if (fenced && /^(graph|flowchart|sequenceDiagram|classDiagram|C4|stateDiagram|erDiagram|gantt|journey|mindmap)/im.test(fenced[1])) {
                body = fenced[1];
            }
        }

        let ir;
        try {
            ir = mermaidToIR(body);
        } catch (err) {
            return { ok: false, reason: `parser threw: ${(err as Error).message}`, nodeCount: 0, edgeCount: 0 };
        }

        const nodeCount = ir.nodes.length;
        const edgeCount = ir.edges.length;

        // C4 / container / component / context / deployment diagrams are useless
        // with a single node — require at least 2 nodes AND 1 edge.
        const requiresRichGraph = templateType.startsWith('mermaid-c4-')
            || templateType === 'hybrid-text-diagram'
            || templateType === 'react-flow-graph';
        const minNodes = requiresRichGraph ? 2 : 1;
        const minEdges = requiresRichGraph ? 1 : 0;

        if (nodeCount < minNodes) {
            return { ok: false, reason: `parsed only ${nodeCount} node(s); need ≥ ${minNodes}`, nodeCount, edgeCount };
        }
        if (edgeCount < minEdges) {
            return { ok: false, reason: `parsed ${nodeCount} nodes but only ${edgeCount} edge(s); need ≥ ${minEdges}`, nodeCount, edgeCount };
        }

        return { ok: true, reason: undefined, nodeCount, edgeCount };
    }

    private getMermaidFormatInstructions(type: string): string {
        const crossCuttingGuidance = `

CRITICAL QUALITY STANDARDS (apply to ALL Mermaid diagrams):
- Output ONLY valid Mermaid v10.9+ syntax. Do NOT use deprecated directives.
- Do NOT wrap output in markdown fences (\`\`\`mermaid). The application handles fencing.
- Escape special characters in labels: use #quot; for quotes, #lpar; #rpar; for parentheses inside labels if needed.
- Aim for 8-20 nodes/elements for optimal readability. Prioritize clarity over completeness.
- Use descriptive labels on ALL relationships/edges — include protocols, data types, or actions.
- Use %% comments sparingly for diagram metadata or section separators.
- Validate that the output is syntactically correct before responding.`;

        switch (type) {
            case 'mermaid-c4-context':
                return ` Generate a professional C4 Context (Level 1) diagram using Mermaid's NATIVE C4 syntax.

MANDATORY STRUCTURE:
- Start with: C4Context
- Use title directive: title System Context Diagram — [System Name]
- Declare all actors with Person(alias, "Name", "Description") or Person_Ext(alias, "Name", "Description")
- Declare internal systems with System(alias, "Name", "Description")
- Declare external systems with System_Ext(alias, "Name", "Description")
- Group related elements inside Enterprise_Boundary(alias, "Enterprise Name") { ... }
- Define relationships with Rel(from, to, "Label", "Technology/Protocol")
- Use BiRel() for bidirectional communication
- Use Rel_D(), Rel_U(), Rel_L(), Rel_R() to control arrow direction (Down, Up, Left, Right)

PROFESSIONAL QUALITY:
- Every Rel() MUST include the protocol/technology in the 4th parameter: Rel(user, api, "Sends requests", "HTTPS/REST")
- Use UpdateRelStyle(from, to, "color", "dashArray", "textColor") to visually differentiate sync vs async:
  - Synchronous: solid lines (default)
  - Asynchronous/Events: UpdateRelStyle with appropriate styling
- Include ALL relevant actors: end users, admin users, external systems, partner systems
- Group systems logically inside System_Boundary or Enterprise_Boundary
- Descriptions should be concise but informative (max 60 chars)
- Use Person_Ext for actors outside the enterprise boundary
${crossCuttingGuidance}`;

            case 'mermaid-c4-container':
                return ` Generate a professional C4 Container (Level 2) diagram using Mermaid's NATIVE C4 syntax.

MANDATORY STRUCTURE:
- Start with: C4Container
- Use title directive: title Container Diagram — [System Name]
- Declare containers with Container(alias, "Name", "Technology", "Description")
- Use ContainerDb(alias, "Name", "Technology", "Description") for databases
- Use ContainerQueue(alias, "Name", "Technology", "Description") for message queues
- Use Container_Ext(alias, "Name", "Technology", "Description") for external containers
- Group containers inside System_Boundary(alias, "System Name") { ... }
- Show external actors with Person(alias, "Name", "Description")
- Show external systems with System_Ext(alias, "Name", "Description")
- Define relationships with Rel(from, to, "Label", "Protocol")

PROFESSIONAL QUALITY:
- EVERY container MUST include the technology stack: Container(api, "API Application", "Java, Spring Boot 3.2", "Handles REST API requests")
- Differentiate container types: ContainerDb for ALL databases/caches, ContainerQueue for ALL message brokers
- Use Rel() with protocol details: Rel(spa, api, "Makes API calls", "HTTPS/JSON")
- Group by deployment boundary: System_Boundary for main system, show external dependencies outside
- Include data stores, caches, CDNs, and message queues — not just application containers
- Show the flow from user through the system to data layer
${crossCuttingGuidance}`;

            case 'mermaid-c4-component':
                return ` Generate a professional C4 Component (Level 3) diagram using Mermaid's NATIVE C4 syntax.

MANDATORY STRUCTURE:
- Start with: C4Component
- Use title directive: title Component Diagram — [Container Name]
- Declare components with Component(alias, "Name", "Technology", "Description")
- Use ComponentDb(alias, "Name", "Technology", "Description") for data access components
- Use ComponentQueue(alias, "Name", "Technology", "Description") for messaging components
- Group components inside Container_Boundary(alias, "Container Name") { ... }
- Show external containers and systems for context
- Define relationships with Rel(from, to, "Label", "Protocol/Method")

PROFESSIONAL QUALITY:
- Annotate descriptions with design patterns: Component(repo, "User Repository", "Spring Data JPA", "Repository Pattern — CRUD for User aggregate")
- Show internal layers: Controllers, Services, Repositories, Domain Models
- Include interface/protocol details: Rel(ctrl, svc, "Calls", "Method invocation")
- Nest components inside Container_Boundary to show what belongs where
- Show dependencies on external containers (databases, queues, other services)
${crossCuttingGuidance}`;

            case 'mermaid-c4-deployment':
                return ` Generate a professional C4 Deployment (Level 4) diagram using Mermaid's NATIVE C4 syntax.

MANDATORY STRUCTURE:
- Start with: C4Deployment
- Use title directive: title Deployment Diagram — [System Name] [Environment]
- Declare deployment nodes with Deployment_Node(alias, "Name", "Technology/Specs")
- Nest nodes to show hierarchy: Cloud Region > VPC > Subnet > Instance/Container
- Place containers inside deployment nodes with Container(alias, "Name", "Technology", "Description")
- Show database instances with ContainerDb()
- Define network relationships with Rel(from, to, "Label", "Protocol/Port")

PROFESSIONAL QUALITY:
- Include infrastructure details: cloud provider, region, instance types, scaling config
- Nest Deployment_Node to show hierarchy: Deployment_Node(aws, "AWS", "Cloud") { Deployment_Node(vpc, "VPC", "10.0.0.0/16") { ... } }
- Show load balancers, CDNs, DNS, firewalls as deployment nodes
- Include port numbers and protocols: Rel(lb, api, "Forwards traffic", "HTTPS:443")
- Show replicas/scaling: Deployment_Node(cluster, "ECS Cluster", "3x t3.medium, auto-scaling")
- Differentiate environments: production, staging, DR site
${crossCuttingGuidance}`;

            case 'mermaid-sequence':
                return ` Generate a professional UML Sequence Diagram using Mermaid syntax.

MANDATORY STRUCTURE:
- Start with: sequenceDiagram
- Declare ALL participants at the top with aliases: participant A as "User Browser"
- Use actor keyword for human actors: actor U as "End User"
- Show activation/deactivation for processing time: activate/deactivate or +/- notation
- Use proper arrow types:
  - ->>  Synchronous request (solid arrow)
  - -->> Synchronous response (dashed arrow)
  - -)   Asynchronous message (open arrow)
  - --)  Asynchronous response (dashed open arrow)

PROFESSIONAL QUALITY:
- Add Notes for important architectural decisions: Note over A,B: OAuth 2.0 PKCE flow
- Use rect rgb(240, 248, 255) ... end blocks to group related interactions visually
- Use alt/else/end for conditional flows (error handling, feature flags)
- Use loop ... end for retry logic or polling
- Use opt ... end for optional flows
- Use par ... and ... end for parallel processing
- Include protocol details in messages: A->>B: POST /api/orders [JSON]
- Show error/exception paths: A-->>B: 401 Unauthorized
- Use break ... end for exception flows that terminate the sequence
- Keep participant declarations ordered left-to-right matching the typical flow direction
- Use activate/deactivate to show processing time clearly
${crossCuttingGuidance}`;

            case 'mermaid-state':
                return ` Generate a professional State Machine Diagram using Mermaid syntax.

MANDATORY STRUCTURE:
- Start with: stateDiagram-v2
- Use [*] for initial and final states
- Declare state aliases for readability: state "Pending Review" as pending_review
- Define transitions with guards and actions: state1 --> state2 : event [guard] / action

PROFESSIONAL QUALITY:
- Use <<choice>> for decision/branch points: state decision_point <<choice>>
- Use <<fork>> and <<join>> for concurrent/parallel states
- Use composite/nested states for complex states: state Active { [*] --> SubState1 ... }
- Add notes for business rules: note right of StateX : Business rule explanation
- Use the -- separator for state internal activities
- Group related states with composite states to reduce visual complexity
- Show ALL transitions including self-transitions (e.g., retry loops)
- Include entry/exit actions where relevant
- Use direction LR or direction TB for optimal layout
- Label transitions with event names, guard conditions [in brackets], and actions /after slash
- Highlight the happy path vs error/exception paths clearly
${crossCuttingGuidance}`;

            case 'mermaid-graph':
                return ` Generate a professional Flowchart/Graph Diagram using Mermaid syntax.

MANDATORY STRUCTURE:
- Start with: graph TD (top-down) or graph LR (left-right) — choose based on the flow nature
- Use subgraph blocks to group related nodes: subgraph "Layer Name" ... end
- Use semantic node shapes:
  - [Rectangle] for processes/services
  - (Rounded) for actions/steps
  - {Diamond} for decisions
  - [(Cylinder)] for databases/data stores
  - ((Circle)) for start/end points or actors
  - >Asymmetric] for inputs/outputs
  - {{Hexagon}} for preparation/microservices

PROFESSIONAL QUALITY — STYLING IS MANDATORY:
- Define classDef for semantic color coding:
  classDef frontend fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
  classDef backend fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#1e1b4b
  classDef database fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b
  classDef api fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#2e1065
  classDef queue fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#451a03
  classDef external fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#0f172a
  classDef security fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#7f1d1d
  classDef cloud fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0c4a6e
- Assign classes to every node: class nodeId frontend
- Use subgraph blocks with styled titles for logical grouping (e.g., "Frontend Layer", "Data Layer")
- Use descriptive edge labels with protocols: A -->|"REST/HTTPS"| B
- Use dotted arrows for async: A -.->|"Event"| B
- Use thick arrows for critical paths: A ==>|"Main flow"| B
- Style subgraphs to be visually distinct zones
${crossCuttingGuidance}`;

            case 'mermaid-gantt':
                return ` Generate a professional Gantt Chart using Mermaid syntax.

MANDATORY STRUCTURE:
- Start with: gantt
- Add title: title Project Timeline — [Project Name]
- Set dateFormat: dateFormat YYYY-MM-DD
- Set axisFormat: axisFormat %b %d
- Organize tasks in section blocks: section Phase Name

PROFESSIONAL QUALITY:
- Use section blocks to group tasks by phase: section Discovery, section Design, section Development, etc.
- Mark critical path items: crit, task_name, after dependency, duration
- Mark active/in-progress items: active, task_name, date, duration
- Mark milestones: milestone, milestone_name, after dependency, 0d
- Use dependencies: task2 : after task1, 5d
- Include excludes weekends for realistic scheduling
- Use realistic durations — not all tasks the same length
- Show parallel workstreams (tasks starting at the same time in different sections)
- Include review/QA checkpoints as milestones
- Group phases logically: Planning > Design > Development > Testing > Deployment
- Use done for completed tasks in current-state charts
- Add tickInterval 1week or similar for readable x-axis
${crossCuttingGuidance}`;

            case 'mermaid-erd':
                return ` Generate a professional Entity-Relationship Diagram using Mermaid syntax.

MANDATORY STRUCTURE:
- Start with: erDiagram
- Define entities with attributes:
  ENTITY_NAME {
      type attribute_name PK "comment"
      type attribute_name FK "references TABLE"
      type attribute_name UK "unique constraint"
      type attribute_name "nullable"
  }
- Use proper cardinality notation:
  - ||--o{ one to many (zero or more)
  - ||--|{ one to many (one or more)
  - ||--|| one to one
  - }o--o{ many to many
- Add relationship labels: ENTITY1 ||--o{ ENTITY2 : "relationship_verb"

PROFESSIONAL QUALITY:
- Include primary keys (PK), foreign keys (FK), and unique keys (UK) annotations
- Use specific data types: string, int, uuid, timestamp, boolean, decimal, jsonb, text
- Include important constraints as comments: "NOT NULL", "DEFAULT now()", "CHECK > 0"
- Name relationships with verbs: CUSTOMER ||--o{ ORDER : "places"
- Include audit fields where relevant: created_at, updated_at, created_by
- Model junction/bridge tables for many-to-many relationships
- Include enum/type entities for domain-specific classifications
- Show 6-15 entities for optimal readability — focus on the core domain model
- Group related entities visually (Mermaid handles auto-layout, but declare related entities near each other)
${crossCuttingGuidance}`;

            default:
                // Fallback for any future mermaid-* types
                return ` The content should be valid Mermaid v10.9+ syntax for a ${type.split('-').slice(1).join(' ')} diagram. Use professional styling including classDef for color coding, subgraph for grouping, and descriptive labels on all relationships.${crossCuttingGuidance}`;
        }
    }

    /**
     * Asks Gemini to *propose improvements* to a deterministic artifact brief.
     *
     * This is intentionally a thin, resilient proposer: it goes through the
     * shared `generateContentWithFallback` pipeline (model fallback + retry +
     * timeout), returns a partial contract proposal and never merges or
     * validates — that orchestration lives in `artifactBriefExtractionService`
     * so the AI hop stays optional, non-blocking and fully testable.
     *
     * It never throws for an empty/malformed response: callers receive an
     * empty proposal and degrade to the deterministic contract.
     */
    // Review, improvements and test cases are `generation/artifactReview.ts`
    // (F5-01, corte 11). Image, speech and SVG generation left with them:
    // nothing in the repository called any of the three. The brief proposal
    // is `generation/artifactBriefProposal.ts` and the presentation deck
    // `generation/presentationDeck.ts` (corte 12); the minimal fallback deck,
    // which calls no model, is `services/presentation/presentationFallback.ts`.

    // ── LMS ───────────────────────────────────────────────────────────────
    //
    // The Training Center's ten generation methods used to live here. They are
    // now `services/ai/generation/learning/`, reached through
    // `learningService`, and this file no longer knows the LMS exists.
    //
    // This was the first vertical of the strangler migration, chosen because
    // it was measurably self-contained: zero callers inside this class, and
    // three engine dependencies that each already had a neutral equivalent.
    // Do not add LMS generation here again.


    // The assistant is `services/ai/generation/assistant/` now (F5-01, cortes
    // 7 y 8). The three turns that speak as an agent are composed outside this
    // layer — the agent's by `services/agent`, the project chat's by the Office
    // — and reach the vertical with their instruction already written.

}

export const artifactGenerationEngine = new ArtifactGenerationEngine();
