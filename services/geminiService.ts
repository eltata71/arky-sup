
import { GoogleGenAI, Modality } from "@google/genai";
import { createGeminiAIClient } from "./ai/providers/gemini/geminiClient";
import { Settings, ArtifactTemplate, ConsistencySuggestion, ChatModalPurpose, UploadedFile } from '../types';
import { emitGenerationPhase, type Artifact, type ArtifactGenerationPhaseEvent, type ArtifactGenerationPhaseListener } from '../lib/artifacts';
import type { Project } from './architectureProjects';
import type { ArtifactReviewSuggestion } from './review';
import type { ChatMessage } from './chat';
import type { DiagramAudience, DiagramIR, DiagramFailureReason } from '../lib/diagram';
import { cleanJsonString as cleanJsonStringUtil } from '../utils';
import {
  buildGlobalPrompt as buildGlobalPromptUtil,
  buildBasePrompt as buildBasePromptUtil,
  buildArtifactsContext as buildArtifactsContextUtil,
  buildSiblingDiagramsPromptBlock as buildSiblingDiagramsPromptBlockUtil,
  buildLMSTutorPersona as buildLMSTutorPersonaUtil,
  type BasePromptOptions,
  type ArtifactsContextOptions,
} from './ai/prompts/projectPrompts';
import { buildAgentSystemInstruction, prepareChatHistoryForModel } from './agent/agentContextComposer';
import { MODEL_TIERS, IMAGE_MODEL, TTS_MODEL, type ModelTier } from '../lib/ai/modelCatalog';
import { resolveModelForSettings, resolveProviderId } from './ai/catalog';
import { activeProviderCapabilities } from './ai/capabilities';
import { MODIFY_ARTIFACT_TOOL } from './ai/tools';
import {
    effectiveGeminiApiKey,
    LegacyGenerationTransport,
    type LegacyGenerationOptions,
    type LegacyGenerationResult,
} from './ai/generation/legacyTransport';
import { renderContextGraphReinforcement } from './contextGraph';
import { assessDocumentArtifact, assessPresentationDeck } from './quality/documentAcceptability';
import {
    buildArchitectureKnowledgeGraphForProject,
    buildArtifactGenerationGraphContext,
    resolveProjectArchitectureGraphFreshness,
} from './architectureKnowledgeGraph';
import {
    buildAutoFixPrompt,
    buildMermaidQualityReinforcement,
    buildDiagramIRSchema,
    buildDialectInstruction,
    buildIRDirectGenerationPrompt,
    buildIRCritiquePrompt,
    buildIRRefinePrompt,
    buildCorrectiveDiagramPrompt,
    buildSkeletonIRFromArtifact,
    DIAGRAM_SYSTEM_INSTRUCTION,
} from './ai/prompts/diagramPrompts';


/**
 * Refuse a non-text modality the active provider does not offer.
 *
 * Throws the canonical `AIServiceError` so the failure travels the same
 * path as any other AI error and surfaces a message a user can act on, rather
 * than a provider SDK exception about an unrecognised response modality.
 */
const assertModalitySupported = (settings: Settings, modality: 'images' | 'audio'): void => {
    const capabilities = activeProviderCapabilities(settings);
    if (capabilities[modality]) return;
    const what = modality === 'images' ? 'imágenes' : 'audio';
    throw new AIServiceError(
        'invalid-request',
        undefined,
        `Provider ${capabilities.provider} does not support ${modality} generation.`,
        `El proveedor de IA activo no puede generar ${what}. Cambia a Gemini en Configuración > IA para usar esta función.`,
        false,
        undefined,
        undefined,
        { source: 'configuration', errorCode: 'modality_not_supported' },
    );
};

export interface ArtifactContentCritiqueRequest {
    project: Project;
    template: ArtifactTemplate;
    settings: Settings;
    content: string;
    mode: 'document' | 'diagram' | 'hybrid' | 'table';
    score: number;
    issues: string[];
}

export interface ArtifactContentRefinementRequest extends ArtifactContentCritiqueRequest {
    critique?: string;
}

/**
 * The error surface moved to `services/ai/errors/aiServiceError.ts`.
 *
 * `services/ai/index.ts` used to re-export these three from here, which meant
 * the provider-agnostic layer's public API resolved to the engine it exists to
 * hide. They are imported back for this file's own use and re-exported for the
 * call sites that still name the engine's surface directly.
 */
import {
    AIServiceError,
    C4SelfHealingError,
    classifyAIError,
    isTransientGeminiError,
} from './ai/errors';
/**
 * The deterministic fallbacks moved to `services/artifacts`. They are pure
 * functions over a project and a template — no model call anywhere in them —
 * and the engine is a *caller* of that path, not its owner.
 */
import {
    buildDeterministicArtifactFallback,
    buildDeterministicDiagramSkeleton,
    markMermaidAsSkeletonFallback,
} from './artifacts/deterministicArtifactFallbacks';
export { AIServiceError, C4SelfHealingError, classifyAIError, isTransientGeminiError };
export type { AIErrorCategory, AIErrorSource } from './ai/core';
import { isPresentationArtifactType } from '../lib/artifacts/artifactKind';
import { buildPresentationPromptInstructions, PRESENTATION_RESPONSE_SCHEMA } from './presentation/presentationPrompt';
import { parsePresentationDeck, PRESENTATION_SCHEMA_VERSION } from './presentation/presentationSchema';
import { mermaidToIR } from './diagram/mermaidToIR';
import { detectArchitecturalViolations } from './diagram/guardrails';
import { analyzeDiagramQuality } from './diagram/quality/diagramQualityService';
import { irToMermaid } from './diagram/irToMermaid';
import { runDiagramQualityGate } from './diagram/qualityGate';
import { extractDiagramSignals, renderDiagramSignals } from './diagram/diagramSignalExtractor';
import { selectArtifactGenerationContext, validateControlledContextForPrompt } from './artifacts/artifactContextSelectionService';
import type { ArtifactGenerationContract, ArtifactGenerationContractProposal } from './artifacts/artifactGenerationContract';
import { SKELETON_FALLBACK_MARKER } from './artifacts/artifactFallbackDetection';
import { buildOfficePersonaInstruction, resolveOfficeAgentMention, buildOfficePersonaBriefing, OFFICE_AGENT_PERSONAS, type OfficeAgentId } from './architectureOffice/officeAgentPersonas';
import { getOfficeArchitectureContext } from './architectureOffice/officeArchitectureKnowledge';

/** Returns true when an ArtifactTemplate.type requires diagram-flavoured generation. */
function isDiagramArtifactType(type: string): boolean {
    return type.startsWith('mermaid') || type === 'react-flow-graph' || type === 'hybrid-text-diagram';
}

/** Cap generation temperature for diagram artifacts.
 *  Lower values reduce creative drift on structural output. */
function diagramTemperature(userTemp: number | undefined): number {
    const base = typeof userTemp === 'number' ? userTemp : 0.7;
    return Math.min(base, 0.3);
}




/**
 * Marker prepended to every deterministic skeleton body so downstream
 * consumers (renderer, badges, audits) can identify content that was NOT
 * authored by Gemini. The marker is a Mermaid comment, so it is stripped
 * cleanly by `mermaidToIR` while staying detectable by a simple `String#
 * includes` check on `artifact.content`.
 *
 * The canonical literal lives in `artifactFallbackDetection.ts` (the central
 * fallback-detection module); it is re-exported here so existing importers
 * stay stable.
 */
export { SKELETON_FALLBACK_MARKER };





// Configuration. The generation loop's own constants moved with the transport
// (`services/ai/generation/legacyTransport.ts`, F5-01), and the engine's own
// `retryWithBackoff` went with the last caller that used it (corte 4).

// ─── Error classification ─────────────────────────────────────────────────
// ─── Error classification ─────────────────────────────────────────────────
//
// `AIServiceError`, `classifyAIError` and `isTransientGeminiError` are now
// `services/ai/errors/aiServiceError.ts`; they are imported at the top of this
// file and re-exported there.

/**
 * Per-task thinking budget for Gemini 2.5+ models. Mechanical/structural
 * tasks turn thinking OFF, while creative generation gets a bounded
 * budget — enough for the model to plan a coherent diagram without
 * silently spending on long chains of thought.
 *
 * IMPORTANT: Gemini 2.5 Flash-Lite accepts only 0 (off), -1 (dynamic) or
 * budgets from 512 to 24576. Keep the lowest enabled bucket at 512 so every
 * call path remains valid when the app routes work to Flash-Lite or falls
 * back to it. A previous 256 value caused 400 INVALID_ARGUMENT responses
 * during artifact generation.
 */
const THINKING_BUDGET: Record<'off' | 'low' | 'medium' | 'high', number> = {
    off:    0,
    low:    512,
    medium: 1024,
    high:   4096,
};

/**
 * Centralised builder for diagram-related Gemini configs. A single source
 * of truth means we get consistent caching keys (systemInstruction is
 * identical byte-for-byte across calls), uniform thinking budgets and a
 * single place to evolve the diagram standard surface.
 */
interface DiagramConfigOptions {
    /** Sampling temperature; defaults to the diagram-safe cap (0.3). */
    temperature?: number;
    /** topP override; defaults to 0.9 for structured outputs. */
    topP?: number;
    /** Optional schema (Gemini's `responseSchema` format). */
    responseSchema?: unknown;
    /** Defaults to 'application/json' when a schema is supplied. */
    responseMimeType?: string;
    /** Thinking budget bucket (see `THINKING_BUDGET`). */
    thinking?: keyof typeof THINKING_BUDGET;
    /** Extra system instruction appended after the canonical one. */
    extraSystemInstruction?: string;
}

export function buildDiagramGenerationConfig(opts: DiagramConfigOptions = {}): Record<string, any> {
    const {
        temperature = 0.3,
        topP = 0.9,
        responseSchema,
        responseMimeType,
        thinking = 'low',
        extraSystemInstruction,
    } = opts;

    const config: Record<string, any> = {
        systemInstruction: extraSystemInstruction
            ? `${DIAGRAM_SYSTEM_INSTRUCTION}\n\n${extraSystemInstruction}`
            : DIAGRAM_SYSTEM_INSTRUCTION,
        temperature,
        topP,
        thinkingConfig: { thinkingBudget: THINKING_BUDGET[thinking] },
    };
    if (responseSchema) {
        config.responseSchema = responseSchema;
        config.responseMimeType = responseMimeType ?? 'application/json';
    }
    return config;
}




export function buildHybridMarkdownFromMermaid(template: ArtifactTemplate, mermaid: string): string {
    const trimmed = mermaid.trim().replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const request = template.requestContext?.userRequest ?? template.objective;
    const plan = template.requestContext?.constructionPlan?.length
        ? `\n\n## Plan de construcción\n${template.requestContext.constructionPlan.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
        : '';
    const rationale = template.requestContext?.rationale
        ? `\n\n## Justificación arquitectónica\n${template.requestContext.rationale}`
        : '';
    const actors = /farmacia|receta|reclamo|asegur/i.test(request)
        ? ['Paciente / Afiliado', 'Farmacia', 'Switch / PBM', 'Aseguradora', 'Banco / Pagos']
        : ['Solicitante', 'Equipo responsable', 'Sistema de soporte', 'Control / aprobación'];
    return `# ${template.name}

## Resumen
${template.objective}

## Alcance del proceso
Artefacto híbrido generado para cubrir la solicitud original con explicación textual y diagrama Mermaid renderizable.

## Actores / lanes
${actors.map(actor => `- ${actor}`).join('\n')}

## Solicitud original
${request}${rationale}

## Diagrama renderizable
\`\`\`mermaid
${trimmed}
\`\`\`${plan}

## Notas de lectura y supuestos
- El diagrama usa sintaxis Mermaid compatible con el parser local.
- Si la salida provino de fallback, el contenido queda editable y trazable desde el canvas.
- Validar nombres de actores y reglas de negocio con el dueño del proceso.`;
}



/**
 * Reinforcement block appended to non-diagram on-demand artifacts so document
 * generations carry the same level of structural rigor as their diagram
 * counterparts. The block is intentionally short — Gemini's implicit cache
 * keeps system instruction cost low; this tail just nudges the model toward
 * a richer, sectioned, decision-grade output that matches the architect's
 * approved construction plan.
 */
export function buildOnDemandDocumentReinforcement(template: ArtifactTemplate): string {
    if (!template.requestContext) return '';
    const audience = template.requestContext.audience ?? 'mixed';
    const audienceHint = audience === 'executive'
        ? 'Audiencia ejecutiva: estructura tipo memo (TL;DR, decisiones, riesgos, próximos pasos); evita jerga técnica innecesaria.'
        : audience === 'technical'
            ? 'Audiencia técnica: profundiza en arquitectura, contratos, integraciones, NFRs, supuestos y validaciones.'
            : 'Audiencia mixta: combina visión ejecutiva al inicio y profundidad técnica en secciones posteriores claramente separadas.';
    return `

ON-DEMAND DOCUMENT QUALITY BAR (mandatory):
- Cubre TODA la solicitud original del arquitecto sin truncar; si una sección requiere extensión, déjala completa antes de pasar a la siguiente.
- Estructura el documento con encabezados claros (## / ###) y listas accionables; nunca devuelvas un único párrafo monolítico.
- Cada sección debe contener contenido específico al proyecto y a la solicitud — prohibido el placeholder genérico "Ejemplo de cliente".
- Cierra con un bloque "Validaciones recomendadas" enumerando supuestos a confirmar con stakeholders y dependencias activas.
- ${audienceHint}
- Cita explícitamente qué señales del contexto del proyecto influyeron cada decisión clave (ej: "Basado en la integración con WeeCompany PBM declarada en el contexto…").`;
}

/**
 * Quality reinforcement applied to ALL non-diagram catalog artefacts.
 *
 * Documents historically had inconsistent quality vs. on-demand documents
 * because the on-demand path got a tailored "QUALITY BAR" suffix while the
 * catalog path relied on the per-template format instructions only. This
 * reinforcement closes that gap with a stable, project-grounded output
 * standard that complements (does not duplicate) the per-template SDD/BRD
 * structures already in place.
 */
export function buildCatalogDocumentReinforcement(template: ArtifactTemplate): string {
    return `

CATALOG DOCUMENT QUALITY BAR (mandatory — apply on top of the per-template structure above):
- Personaliza CADA sección con detalles concretos del proyecto: nombres reales, integraciones declaradas, fases registradas, restricciones del contexto. Prohibido contenido genérico ("Empresa X", "Sistema legacy").
- Mantén títulos en jerarquía consistente (# > ## > ###); nunca devuelvas un único párrafo monolítico.
- Toda lista numerada o con viñetas debe contener al menos 3 elementos cuando aplique.
- Si el artefacto es ${template.type}, respeta exactamente la plantilla declarada arriba — no remueves secciones, no las renombras.
- Cuando referencias trazabilidad (BR-, UC-, NFR-, TC-), usa identificadores monotónicos y consistentes a lo largo del documento.
- Cierra con un breve bloque "Próximos pasos" con 2-4 acciones recomendadas.
- Idioma: español por defecto (el contexto global del proyecto manda); evita anglicismos cuando exista término establecido en la industria aseguradora.`;
}

export const __test__ = {
    buildDiagramGenerationConfig,
    THINKING_BUDGET,
    buildDeterministicArtifactFallback,
    buildHybridMarkdownFromMermaid,
    markMermaidAsSkeletonFallback,
    buildOnDemandDocumentReinforcement,
    buildCatalogDocumentReinforcement,
};

class GeminiService {
    // Note: We no longer store `this.ai` or `this.apiKey` as static properties on the class
    // because we need to decide which key to use (global or user) at runtime based on settings.

    /**
     * The generation transport, with this engine's own client factory so the
     * public `getAIClient` stays the one seam tests replace (F5-01).
     */
    private readonly transport = new LegacyGenerationTransport({
        getClient: (settings) => this.getAIClient(settings),
    });

    /**
     * Helper: Creates a new GoogleGenAI instance on demand.
     */
    public getAIClient(settings: Settings): GoogleGenAI {
        return createGeminiAIClient({ apiKey: effectiveGeminiApiKey(settings) });
    }

    /**
     * True when the user has selected OpenRouter as the active AI provider.
     * Callers use this to gate provider-specific behaviour without importing
     * provider internals.
     */
    public isOpenRouterConfigured(settings: Settings): boolean {
        return resolveProviderId(settings) === 'openrouter';
    }

    private isLocalGenerationFallbackCandidate(error: unknown): boolean {
        const friendly = classifyAIError(error);
        return friendly.category === 'timeout'
            || friendly.category === 'network'
            || friendly.category === 'overloaded'
            || friendly.category === 'rate-limit';
    }

    /**
     * The retry/timeout/model-fallback loop, now in the transport
     * (`legacyTransport`, F5-01). Kept as a delegate because a dozen prompt
     * methods below call it with their own SDK request.
     */
    private runWithModelFallback<T>(
        settings: Settings,
        preferredModel: string,
        runOne: (modelId: string, ai: GoogleGenAI, signal: AbortSignal) => Promise<T>,
        options: LegacyGenerationOptions = {}
    ): Promise<T> {
        return this.transport.runWithModelFallback(settings, preferredModel, runOne, options);
    }

    private generateTextWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: string,
        config: Record<string, any>,
        options: LegacyGenerationOptions = {}
    ): Promise<string> {
        return this.transport.generateTextWithFallback(settings, preferredModel, contents, config, options);
    }

    /**
     * Public entry point for arbitrary text/chat generation with the full
     * model-fallback pipeline. The pipeline itself is the transport
     * (`services/ai/generation/legacyTransport.ts`); a caller that composes its
     * own prompt uses `aiGateway` and never loads this engine.
     */
    public generateContentWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: unknown,
        config: Record<string, any> = {},
        options: LegacyGenerationOptions = {}
    ): Promise<LegacyGenerationResult> {
        return this.transport.generateContentWithFallback(settings, preferredModel, contents, config, options);
    }

    public async critiqueArtifactContent(request: ArtifactContentCritiqueRequest): Promise<string> {
        const model = resolveModelForSettings('default', request.settings).id;
        const prompt = `Eres un revisor senior de arquitectura de software y calidad documental.
Evalúa el artefacto antes de persistirlo y devuelve una crítica breve, accionable y segura.

Proyecto: ${request.project.name}
Descripción: ${request.project.description || '(sin descripción)'}
Tipo de artefacto: ${request.template.type}
Modo: ${request.mode}
Audiencia: ${request.template.requestContext?.audience ?? 'técnica'}
Objetivo: ${request.template.objective}
Score actual: ${request.score}/100
Issues detectados:
${request.issues.length > 0 ? request.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') : '- Sin issues formales, buscar mejoras marginales.'}

Restricciones:
- No propongas eliminar contenido crítico.
- No propongas reducir nodos/aristas en diagramas.
- Para híbridos debe conservarse exactamente un bloque Mermaid.
- Mantén idioma español y tono profesional.

Contenido actual:
---
${request.content.slice(0, 18000)}
---

Devuelve sólo una lista breve de recomendaciones concretas. No devuelvas el artefacto completo.`;
        const result = await this.generateContentWithFallback(
            request.settings,
            model,
            prompt,
            { temperature: 0.2 },
            { maxRetries: 1, maxCandidates: 2 },
        );
        return result.text.trim();
    }

    /**
     * Refines artifact content with Gemini only when the orchestrator has
     * decided AI adds value. The response must be the final artifact content;
     * caller-side safety gates decide whether to accept or discard it.
     */
    public async refineArtifactContent(request: ArtifactContentRefinementRequest): Promise<string> {
        const model = resolveModelForSettings('default', request.settings).id;
        const expectedFormat = request.mode === 'diagram'
            ? 'Mermaid válido o JSON ReactFlow válido según el tipo original'
            : request.mode === 'hybrid'
                ? 'Markdown completo con exactamente un bloque ```mermaid válido'
                : 'Markdown completo';
        const prompt = `Eres un arquitecto de soluciones senior especializado en documentos y diagramas renderizables.
Refina el artefacto antes de persistirlo, preservando su semántica y aumentando claridad, trazabilidad y presentación.

Proyecto: ${request.project.name}
Descripción: ${request.project.description || '(sin descripción)'}
Contexto del proyecto:
${request.project.projectContext.slice(0, 8).map((item) => `- ${item}`).join('\n') || '- Sin contexto adicional'}
Tipo de artefacto: ${request.template.type}
Modo: ${request.mode}
Audiencia: ${request.template.requestContext?.audience ?? 'técnica'}
Objetivo: ${request.template.objective}
Formato esperado: ${expectedFormat}
Score actual: ${request.score}/100
Issues detectados:
${request.issues.length > 0 ? request.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') : '- Sin issues formales.'}
Crítica previa:
${request.critique || '(sin crítica previa)'}

Reglas estrictas:
- Devuelve SÓLO el contenido final del artefacto; sin prefacios, sin explicación, sin markdown extra envolvente.
- Preserva significado, decisiones, restricciones y datos existentes.
- No elimines secciones, nodos, relaciones, tablas ni trazabilidad útil.
- No inventes datos específicos; si falta información, agrega supuestos explícitos.
- Documentos: Markdown en español con título, propósito/resumen, alcance, supuestos, riesgos/consideraciones y próximos pasos cuando aplique.
- Diagramas: conserva renderabilidad Mermaid/ReactFlow, etiquetas descriptivas y relaciones válidas.
- Híbridos: conserva exactamente un bloque Mermaid válido y narrativa antes o después.

Contenido actual:
---
${request.content.slice(0, 24000)}
---`;
        const result = await this.generateContentWithFallback(
            request.settings,
            model,
            prompt,
            { temperature: 0.25 },
            { maxRetries: 1, maxCandidates: 2 },
        );
        return result.text.trim();
    }

    /** Streaming counterpart of {@link generateContentWithFallback}. */
    public generateContentStreamWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: unknown,
        config: Record<string, any> = {},
        options: LegacyGenerationOptions = {}
    ): Promise<AsyncIterable<unknown>> {
        return this.transport.generateContentStreamWithFallback(settings, preferredModel, contents, config, options);
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

    private buildLMSTutorPersona(settings: Settings): string {
        return buildLMSTutorPersonaUtil(settings);
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
    private artifactStubFromTemplate(template: ArtifactTemplate, project: Project, previousArtifact?: Artifact): Artifact {
        const now = new Date().toISOString();
        const contract = template.requestContext?.generationContract;
        let controlledContext = '';
        if (contract) {
            const selection = selectArtifactGenerationContext(project, contract, { maxOptionalSources: 3, maxContextItems: 5, sourceSummaryChars: 700 });
            const validation = validateControlledContextForPrompt(selection);
            controlledContext = validation.ok ? selection.promptBlock : `
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
        previousArtifact?: Artifact,
    ): Promise<string> {
        const stub = this.artifactStubFromTemplate(template, project, previousArtifact);
        const result = await this.generateDiagramIRWithSelfHealing(stub, project, settings);
        const mermaid = result.fallback === 'skeleton'
            ? markMermaidAsSkeletonFallback(irToMermaid(result.ir))
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
    private async generatePresentationDeck(
        project: Project,
        template: ArtifactTemplate,
        settings: Settings,
        architectureGraphPromptBlock?: string,
    ): Promise<string> {
        const modelName = resolveModelForSettings('default', settings).id;
        const userTemp = settings.aiConfig?.temperature ?? 0.7;
        const basePrompt = buildBasePromptUtil(project, settings);
        // Presentations summarise the architecture: feeding real excerpts of
        // the sibling artifacts keeps slide content consistent with the
        // documents/diagrams it presents instead of re-inventing them.
        const artifactsContext = buildArtifactsContextUtil(project, { includeExcerpts: true });
        const contextBlock = architectureGraphPromptBlock && architectureGraphPromptBlock.trim().length > 0
            ? architectureGraphPromptBlock
            : artifactsContext;
        const instructions = buildPresentationPromptInstructions(template, {
            contextBlock,
            language: settings.language,
        });
        const fullPrompt = `${basePrompt}\n\n${instructions}\n\nTASK: Create the deck for "${template.name}" matching the contract above. Return JSON only.`;
        const modelConfig: Record<string, unknown> = {
            temperature: Math.min(userTemp, 0.7),
            topP: 0.9,
            responseMimeType: 'application/json',
            responseSchema: PRESENTATION_RESPONSE_SCHEMA,
        };
        const raw = await this.generateTextWithFallback(settings, modelName, fullPrompt, modelConfig, {
            timeoutMs: 90000,
            maxRetries: 2,
        });
        let parsed = parsePresentationDeck(raw, { artifactType: template.type, artifactName: template.name });
        // Deck quality gate: structural assessment + ONE corrective retry.
        // Catches decks that parse but are unusable (empty content slides,
        // 1-slide decks) before they reach the viewer/exporters.
        const firstDeckAssessment = assessPresentationDeck(JSON.stringify(parsed.deck));
        if (!firstDeckAssessment.ok) {
            console.warn(
                `[geminiService] Presentation deck failed quality gate (${firstDeckAssessment.issues.map((i) => i.code).join(', ')}); corrective retry.`,
            );
            const correctivePrompt = `${fullPrompt}

PREVIOUS ATTEMPT WAS REJECTED (${firstDeckAssessment.issues.map((i) => i.message).join(' · ')}).
Regenerate the COMPLETE deck ensuring:
 - At least 5 slides, each with a title.
 - Every non-title slide has at least one substantive contentBlock (text, bullets, table, kpi or diagram).
 - JSON only, matching the contract exactly.`;
            try {
                const retryRaw = await this.generateTextWithFallback(settings, modelName, correctivePrompt, modelConfig, {
                    timeoutMs: 90000,
                    maxRetries: 1,
                });
                const retryParsed = parsePresentationDeck(retryRaw, { artifactType: template.type, artifactName: template.name });
                const retryAssessment = assessPresentationDeck(JSON.stringify(retryParsed.deck));
                if (retryAssessment.ok || retryAssessment.score > firstDeckAssessment.score) {
                    parsed = retryParsed;
                }
            } catch (retryErr) {
                console.warn('[geminiService] Deck corrective retry failed; keeping first attempt.', retryErr);
            }
        }
        // Always re-stringify the parsed deck so the persisted content matches
        // the canonical schema even if the model drifted slightly.
        const deck = parsed.deck;
        deck.metadata = {
            ...(deck.metadata ?? {}),
            templateId: template.type,
            generatedAt: new Date().toISOString(),
            projectId: project.id,
            preferredExports: template.preferredExports ?? ['pptx', 'pdf'],
        };
        deck.version = deck.version || PRESENTATION_SCHEMA_VERSION;
        return JSON.stringify(deck, null, 2);
    }

    /**
     * Minimal deck used when presentation generation fails or returns empty
     * content. Always produces a parseable PresentationDeck so the slide
     * viewer never blanks out and the user gets a clear nudge to regenerate.
     */
    private buildMinimalPresentationDeck(project: Project, template: ArtifactTemplate): string {
        const audience: 'executive' | 'technical' | 'mixed' = template.type === 'presentation-technical'
            ? 'technical'
            : (template.type === 'presentation-executive' || template.type === 'presentation-summary' ? 'executive' : 'mixed');
        const deck = {
            kind: 'presentation' as const,
            version: PRESENTATION_SCHEMA_VERSION,
            title: template.name,
            audience,
            theme: 'dark' as const,
            slides: [
                {
                    id: 'slide-1',
                    slideNumber: 1,
                    title: template.name,
                    subtitle: project.name,
                    layout: 'titleSlide' as const,
                    keyMessage: 'Deck mínimo generado tras fallo de IA. Regenera para obtener un deck completo.',
                    contentBlocks: [],
                    visualHints: [],
                },
                {
                    id: 'slide-2',
                    slideNumber: 2,
                    title: 'Objetivo',
                    layout: 'executiveSummary' as const,
                    contentBlocks: [
                        { type: 'text' as const, content: template.objective },
                    ],
                    speakerNotes: 'Slide derivada del objetivo del template.',
                },
                {
                    id: 'slide-3',
                    slideNumber: 3,
                    title: 'Próximos pasos',
                    layout: 'closingSlide' as const,
                    contentBlocks: [
                        { type: 'bullets' as const, content: ['Regenerar el deck con más contexto del proyecto', 'Validar audiencia objetivo', 'Definir mensajes clave'] },
                    ],
                },
            ],
            metadata: {
                templateId: template.type,
                generatedAt: new Date().toISOString(),
                projectId: project.id,
                preferredExports: template.preferredExports ?? ['pptx', 'pdf'],
            },
        };
        return JSON.stringify(deck, null, 2);
    }

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
            console.warn('[geminiService] No se pudo resolver el grafo de conocimiento para la generación; se continúa sin él.', err);
            return '';
        }
    }

    public async generateArtifactContent(
        project: Project,
        template: ArtifactTemplate,
        settings: Settings,
        previousArtifact?: Artifact,
        opts: { onPhase?: ArtifactGenerationPhaseListener; architectureGraphPromptBlock?: string } = {}
    ): Promise<string> {
        const { onPhase } = opts;
        const stageTimings = new Map<string, number>();
        const emit = (event: Omit<ArtifactGenerationPhaseEvent, 'at'>) =>
            emitGenerationPhase(onPhase, event, stageTimings);
        const raw = await this._generateArtifactContentInternal(project, template, settings, previousArtifact, opts);
        try {
            return this.gateRenderableDiagramContent(raw, project, template, emit);
        } catch (gateErr) {
            // The gate must NEVER block persistence. If something throws
            // unexpectedly inside it, log and return the raw content so the
            // user at least sees what the model produced — the canvas
            // placeholder will then surface the rendering issue with a clear
            // retry CTA.
            console.warn('[geminiService] Renderability gate threw — returning raw content as last resort.', gateErr);
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
        previousArtifact?: Artifact,
        opts: { onPhase?: ArtifactGenerationPhaseListener; architectureGraphPromptBlock?: string } = {}
    ): Promise<string> {
        const { onPhase } = opts;
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
                const mermaid = await this.generateC4ArtifactViaSelfHealing(project, template, settings, previousArtifact);
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
                return buildDeterministicDiagramSkeleton(project, template);
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
                const deckJson = await this.generatePresentationDeck(project, template, settings, opts.architectureGraphPromptBlock);
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
                return this.buildMinimalPresentationDeck(project, template);
            }
        }

        const isDiagramTemplate = isDiagramArtifactType(template.type);
        const requestedBy = template.requestContext?.userRequest ?? template.objective;
        const basePrompt = buildOfficePersonaInstruction(
            buildBasePromptUtil(project, settings, isDiagramTemplate ? { mode: 'diagram' } : undefined),
            resolveOfficeAgentMention(requestedBy),
        );
        // Documents embed excerpts of sibling artifacts so the generated
        // content stays consistent with what already exists (same entities,
        // requirement IDs, system names). Diagrams keep the compact list.
        const artifactsContext = buildArtifactsContextUtil(project, isDiagramTemplate
            ? { mode: 'diagram' }
            : { includeExcerpts: true, excludeVersionGroupId: previousArtifact?.versionGroupId });

        let formatInstructions = `Generate the content for the artifact. Respond ONLY with the raw content (e.g., Markdown, Mermaid syntax, YAML). Do not include any explanations, titles, or code block fences unless it's part of the artifact's syntax itself.`;
        let modelConfig: any = {};
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

        modelConfig.temperature = temperature;

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
        const controlledContextSelection = generationContract
            ? selectArtifactGenerationContext(project, generationContract, { maxOptionalSources: 3, maxContextItems: 5, sourceSummaryChars: 900 })
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
        let controlledContextPromptBlock = controlledContextSelection?.promptBlock ?? '';
        if (controlledContextSelection) {
            const contextValidation = validateControlledContextForPrompt(controlledContextSelection);
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
                console.warn(`[geminiService] Empty generation for "${template.name}"; using deterministic fallback.`);
                emit({
                    stage: 'ai-generation',
                    status: 'warning',
                    message: 'Gemini devolvió contenido vacío; aplicando fallback determinístico.',
                });
                return buildDeterministicArtifactFallback(project, template);
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
                    `[geminiService] Artifact generation used local fallback for "${template.name}" (${friendly.category}).`,
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
                return buildDeterministicArtifactFallback(project, template);
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
                `[geminiService] Diagram artifact "${template.name}" failed post-LLM validation:`,
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
                    `[geminiService] Diagram retry still invalid (${retryAssessment.reason}); attempting flowchart fallback.`,
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
                                `[geminiService] Returned flowchart fallback for "${template.name}" — original dialect failed twice.`,
                            );
                            return normalizedFallback;
                        }
                        console.warn(
                            `[geminiService] Flowchart fallback for "${template.name}" also failed:`,
                            fallbackAssessment.reason,
                        );
                    } catch (fallbackErr) {
                        console.warn('[geminiService] Flowchart fallback threw:', fallbackErr);
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
                        `[geminiService] All AI attempts produced zero nodes for "${template.name}"; emitting deterministic skeleton.`,
                    );
                    return buildDeterministicDiagramSkeleton(project, template);
                }
                return best;
            } catch (retryErr) {
                console.warn('[geminiService] Diagram retry failed entirely:', retryErr);
                // The retry threw before we could measure it. Use the raw
                // first-attempt output if it has any content; otherwise drop
                // back to the deterministic skeleton.
                if (firstAssessment.nodeCount > 0) return raw;
                if (template.type.startsWith('mermaid') || template.type === 'hybrid-text-diagram') {
                    return buildDeterministicDiagramSkeleton(project, template);
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
                console.warn('[geminiService] Document corrective retry failed; keeping first attempt.', retryErr);
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
            const skeleton = buildDeterministicDiagramSkeleton(project, template);
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
                const skeleton = buildDeterministicDiagramSkeleton(project, template);
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
            const skeleton = buildDeterministicDiagramSkeleton(project, template);
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

    public async parseMermaidToReactFlow(
        mermaidSyntax: string,
        settings: Settings
    ): Promise<{ nodes: any[], edges: any[] } | null> {
        const prompt = `Convert this Mermaid syntax to ReactFlow JSON. Mechanical mapping only — preserve every node and edge.

NODES: type='custom', data must include:
- label: display name
- type: specific technology or role keyword (e.g., 'PostgreSQL', 'API Gateway', 'Person', 'Kafka'). Infer from Mermaid node labels and context.
- description: brief 1-2 sentence description inferred from context
- shape (optional): 'cylinder' for databases, 'hexagon' for microservices/functions, 'cloud' for cloud/external, 'person' for actors, 'diamond' for gateways, 'tab-box' for containers
- icon (optional): technology hint for icon (e.g., 'kafka', 'react', 'postgresql')

EDGES: include:
- label: relationship description from Mermaid arrow labels
- edgeType (optional): 'sync' for HTTP/REST, 'async' for events/messages, 'data-flow' for data, 'dependency' for references

Respond ONLY with JSON.

Mermaid:
${mermaidSyntax}`;

        const responseSchema = {
             type: 'object',
             properties: {
                 nodes: {
                     type: 'array',
                     items: {
                         type: 'object',
                         properties: {
                             id: {type:'string'},
                             type:{type:'string'},
                             position:{type:'object', properties:{x:{type:'number'},y:{type:'number'}}, required:['x','y']},
                             data: {
                                 type:'object',
                                 properties: {
                                     label:{type:'string'},
                                     type:{type:'string'},
                                     description:{type:'string'},
                                     shape:{type:'string'},
                                     icon:{type:'string'}
                                 },
                                 required: ['label', 'type', 'description']
                             }
                         },
                         required: ['id', 'type', 'data', 'position']
                     }
                 },
                 edges: {
                     type: 'array',
                     items: {
                         type: 'object',
                         properties: {
                             id:{type:'string'},
                             source:{type:'string'},
                             target:{type:'string'},
                             label:{type:'string'},
                             edgeType:{type:'string'}
                         },
                         required: ['id', 'source', 'target']
                     }
                 }
             },
             required: ['nodes', 'edges']
        };

        // Mechanical conversion: no creativity needed → flash-lite + thinking
        // OFF cuts the cost ~75% versus the previous flash + implicit-thinking
        // route while keeping the same quality on this bounded task.
        const modelName = MODEL_TIERS.quick;

        try {
            const { text } = await this.generateContentWithFallback(settings, modelName, prompt, buildDiagramGenerationConfig({
                temperature: 0.1,
                thinking: 'off',
                responseSchema,
            }));
            const cleanJson = this.cleanJsonString(text || '');
            return JSON.parse(cleanJson || '{"nodes":[], "edges":[]}');
        } catch (error) {
            console.error("Mermaid Parse Error:", error);
            // Return null so UI handles it gracefully instead of crashing
            return null;
        }
    }

    /**
     * Generate a complete DiagramIR for an artifact in one shot.
     *
     * This is the **preferred** path for new diagram generation: Gemini emits
     * the canonical IR directly (validated by the SDK against
     * `buildDiagramIRSchema`), and downstream renderers (`irToReactFlow`,
     * `irToMermaid`, `irToExcalidraw`) consume it without any second AI hop.
     *
     * Compared with the legacy "generate Mermaid → parse Mermaid → render"
     * pipeline this:
     *   - eliminates the Mermaid hallucination failure mode (unparseable
     *     dialect, missing closing braces, wrong syntax for the chosen
     *     header) entirely;
     *   - emits richer metadata per node (technology, kind enum, group);
     *   - opens the door to deterministic round-tripping back to Mermaid via
     *     `irToMermaid` for users who still want the source.
     */
    public async generateDiagramIR(
        artifact: Artifact,
        project: Project,
        settings: Settings,
        opts: { audience?: DiagramAudience; previousIR?: DiagramIR } = {},
    ): Promise<DiagramIR | null> {
        const audience: DiagramAudience = opts.audience ?? artifact.audience ?? 'technical';
        const dialect = buildDialectInstruction(artifact.type);
        const responseSchema = buildDiagramIRSchema({ withReview: true });

        const config = buildDiagramGenerationConfig({
            temperature: diagramTemperature(settings.aiConfig?.temperature),
            thinking: 'medium',
            responseSchema,
            extraSystemInstruction: dialect || undefined,
        });

        const prompt = buildIRDirectGenerationPrompt({
            artifact,
            project,
            audience,
            settings,
            previousIR: opts.previousIR,
        });

        const modelName = resolveModelForSettings('default', settings).id;

        try {
            const text = await this.generateTextWithFallback(settings, modelName, prompt, config);
            const cleanJson = this.cleanJsonString(text || '');
            if (!cleanJson) return null;
            const parsed = JSON.parse(cleanJson) as Partial<DiagramIR> & { error?: string };
            if (parsed.error) {
                console.warn('[geminiService.generateDiagramIR] Model declined:', parsed.error);
                return null;
            }
            if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
            if (parsed.nodes.length === 0) {
                console.warn('[geminiService.generateDiagramIR] Empty IR returned by model.');
                return null;
            }

            // Drop edges whose endpoints are not declared as nodes — this
            // prevents the "phantom edge" rendering issue where the canvas
            // shows edges into thin air after a partial structured-output
            // response.
            const nodeIds = new Set(parsed.nodes.map(n => n.id));
            const cleanEdges = parsed.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
            if (cleanEdges.length !== parsed.edges.length) {
                console.warn(
                    '[geminiService.generateDiagramIR] Dropped edges with dangling endpoints.',
                    { dropped: parsed.edges.length - cleanEdges.length },
                );
            }

            // Same defence for groups: drop nodeIds that don't exist.
            const cleanGroups = (Array.isArray(parsed.groups) ? parsed.groups : [])
                .map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => nodeIds.has(id)) }))
                .filter(g => g.nodeIds.length > 0);

            return {
                nodes: parsed.nodes,
                edges: cleanEdges,
                groups: cleanGroups,
                metadata: {
                    sourceFormat: 'unknown',
                    audience,
                    generatedAt: new Date().toISOString(),
                    ...(parsed.metadata ?? {}),
                },
            } as DiagramIR;
        } catch (err) {
            console.error('[geminiService.generateDiagramIR] failed', err);
            return null;
        }
    }

    /**
     * Self-healing variant of {@link generateDiagramIR}. Runs up to three
     * attempts:
     *   1. Standard `generateDiagramIR` with full project-context cap.
     *   2. Corrective prompt (smaller context, explicit failure reason)
     *      when the first attempt returns null / empty / malformed IR.
     *   3. Deterministic skeleton derived from `artifact.keyConcepts` so the
     *      canvas never appears empty.
     *
     * Returns the IR plus a small diagnostics record (attempts, fallback
     * status, reason) so callers can surface a precise message to the user
     * and persist `lastDiagramError` on the artifact.
     */
    public async generateDiagramIRWithSelfHealing(
        artifact: Artifact,
        project: Project,
        settings: Settings,
        opts: { audience?: DiagramAudience; previousIR?: DiagramIR; skipCorrective?: boolean } = {},
    ): Promise<{
        ir: DiagramIR;
        attempts: number;
        fallback: 'none' | 'skeleton';
        warnings: string[];
        lastReason?: DiagramFailureReason;
    }> {
        const audience: DiagramAudience = opts.audience ?? artifact.audience ?? 'technical';
        const warnings: string[] = [];

        if (!opts.skipCorrective) {
            const first = await this.generateDiagramIR(artifact, project, settings, { audience, previousIR: opts.previousIR });
            if (first && first.nodes.length > 0) {
                return { ir: first, attempts: 1, fallback: 'none', warnings };
            }
            warnings.push('[diagram-retry] attempt 1 failed (empty or null IR)');
            console.warn('[diagram-retry] attempt 1 failed', {
                artifactId: artifact.id,
                type: artifact.type,
                reason: first ? 'empty-ir' : 'no-mermaid',
            });
        }

        // Attempt 2: corrective retry.
        const lastFailureReason = opts.skipCorrective
            ? (artifact.lastDiagramError?.reason ?? 'empty-ir')
            : 'empty-ir';
        const correctiveIR = await this.generateDiagramIRCorrective(artifact, project, settings, audience, lastFailureReason);
        if (correctiveIR && correctiveIR.nodes.length > 0) {
            warnings.push('[diagram-retry] attempt 2 (corrective) succeeded');
            return { ir: correctiveIR, attempts: opts.skipCorrective ? 1 : 2, fallback: 'none', warnings, lastReason: lastFailureReason };
        }
        warnings.push('[diagram-retry] attempt 2 (corrective) failed; falling back to deterministic skeleton');
        console.warn('[diagram-retry] attempt 2 (corrective) failed', { artifactId: artifact.id, type: artifact.type });

        // Attempt 3: deterministic skeleton.
        const skeleton = buildSkeletonIRFromArtifact(artifact, project);
        return {
            ir: skeleton,
            attempts: opts.skipCorrective ? 2 : 3,
            fallback: 'skeleton',
            warnings,
            lastReason: 'skeleton-fallback',
        };
    }

    /**
     * Internal: run the corrective prompt that tells the model exactly what
     * went wrong on the previous attempt and asks for a slimmer payload.
     */
    private async generateDiagramIRCorrective(
        artifact: Artifact,
        project: Project,
        settings: Settings,
        audience: DiagramAudience,
        lastFailureReason: DiagramFailureReason,
    ): Promise<DiagramIR | null> {
        const dialect = buildDialectInstruction(artifact.type);
        const responseSchema = buildDiagramIRSchema({ withReview: false });
        const config = buildDiagramGenerationConfig({
            temperature: diagramTemperature(settings.aiConfig?.temperature),
            thinking: 'low',
            responseSchema,
            extraSystemInstruction: dialect || undefined,
        });
        const prompt = buildCorrectiveDiagramPrompt({
            artifact,
            project,
            audience,
            lastFailureReason,
            previousResponseSample: artifact.lastDiagramError?.sample,
        });
        const modelName = resolveModelForSettings('default', settings).id;
        try {
            const text = await this.generateTextWithFallback(settings, modelName, prompt, config);
            const cleanJson = this.cleanJsonString(text || '');
            if (!cleanJson) return null;
            const parsed = JSON.parse(cleanJson) as Partial<DiagramIR> & { error?: string };
            if (parsed.error) return null;
            if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
            const nodeIds = new Set(parsed.nodes.map((n) => n.id));
            const cleanEdges = (parsed.edges ?? []).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
            return {
                nodes: parsed.nodes,
                edges: cleanEdges,
                groups: Array.isArray(parsed.groups) ? parsed.groups.filter((g) => g.nodeIds?.length) : [],
                metadata: {
                    sourceFormat: 'unknown',
                    audience,
                    generatedAt: new Date().toISOString(),
                    ...(parsed.metadata ?? {}),
                },
            };
        } catch (err) {
            console.warn('[diagram-retry] corrective attempt threw', err);
            return null;
        }
    }

    /**
     * Multi-pass diagram generation: draft → deterministic auto-repair →
     * AI critique → AI refine.  This is the highest-quality entry point and
     * what new call sites should prefer when latency budget allows.
     *
     * Stages:
     *   1. **Draft**         — `generateDiagramIR()` (existing single-shot).
     *   2. **Auto-repair**   — deterministic fixes for known violations
     *                          (generic labels, missing protocols, layer
     *                          violations, missing groups, illegal cycles).
     *                          No AI call. ~5 ms.
     *   3. **Critique**      — AI reviewer flags remaining issues using the
     *                          10-D rubric, fed with the static analyser
     *                          report and remaining architectural violations.
     *   4. **Refine**        — AI applies the critique surgically, returning
     *                          a higher-quality IR.
     *
     * Each stage can be skipped via `opts` so callers control the latency /
     * cost / quality trade-off.  Stages 3 + 4 are skipped automatically when
     * the post-repair quality score already passes the target threshold.
     */
    public async generateAndRefineDiagramIR(
        artifact: Artifact,
        project: Project,
        settings: Settings,
        opts: {
            audience?: DiagramAudience;
            previousIR?: DiagramIR;
            /** Default: true. Skip auto-repair when false. */
            enableAutoRepair?: boolean;
            /** Default: true. Skip the AI critique+refine pass when false. */
            enableRefinement?: boolean;
            /**
             * Quality score (0–100) above which we skip the AI critique+refine
             * pass entirely. Default: 85.
             */
            skipRefinementAboveScore?: number;
        } = {},
    ): Promise<DiagramIR | null> {
        const {
            audience = artifact.audience ?? 'technical',
            previousIR,
            enableAutoRepair = true,
            enableRefinement = true,
            skipRefinementAboveScore = 85,
        } = opts;

        // Stage 1: draft.
        const draft = await this.generateDiagramIR(artifact, project, settings, { audience, previousIR });
        if (!draft) return null;

        // Stage 2: deterministic quality gate (architectural + structural
        // repairs).  Runs even when `enableAutoRepair` is false because the
        // gate guarantees a renderable IR with sane metadata, regardless of
        // whether the model emitted them.
        let working: DiagramIR = draft;
        if (enableAutoRepair) {
            const gate = runDiagramQualityGate(working, {
                artifact,
                audience,
                targetScore: 90,
                maxPasses: 3,
                // Generation is the right time to fully polish the diagram:
                // descriptions, label humanisation and id normalisation all
                // run so the persisted artifact starts at world-class.
                aggressive: true,
            });
            working = gate.ir;
            console.info('[geminiService.generateAndRefineDiagramIR] quality-gate', {
                applied: gate.changes.length,
                bestScore: gate.quality.score,
                reachedTarget: gate.reachedTarget,
                history: gate.history,
            });
        }

        // Early-out: if the repaired diagram is already excellent, skip refinement.
        const localQuality = analyzeDiagramQuality(working);
        if (!enableRefinement || localQuality.score >= skipRefinementAboveScore) {
            return this.attachQualityMetadata(working, localQuality);
        }

        // Stage 3+4: AI critique + refine.
        const remainingViolations = detectArchitecturalViolations(working, { type: artifact.type, audience });
        const refined = await this.runCritiqueAndRefine(
            working,
            artifact,
            audience,
            settings,
            remainingViolations,
            localQuality.issues,
        );
        if (!refined) return this.attachQualityMetadata(working, localQuality);

        // Re-run the deterministic gate over the refined IR so any regressions
        // the LLM introduced (broken refs, missing metadata, generic labels
        // re-injected into a previously fixed edge) are caught before persist.
        const postGate = runDiagramQualityGate(refined, {
            artifact,
            audience,
            targetScore: 90,
            maxPasses: 2,
            aggressive: true,
        });

        // Defensive: never let refinement *lower* the score by more than 5 points
        // — if it does, we keep the auto-repaired version instead.
        if (postGate.quality.score < localQuality.score - 5) {
            console.warn('[geminiService.generateAndRefineDiagramIR] refinement regressed score; keeping repaired draft', {
                draftScore: localQuality.score,
                refinedScore: postGate.quality.score,
            });
            return this.attachQualityMetadata(working, localQuality);
        }
        return this.attachQualityMetadata(postGate.ir, postGate.quality);
    }

    private attachQualityMetadata(ir: DiagramIR, quality: ReturnType<typeof analyzeDiagramQuality>): DiagramIR {
        const metadata = { ...(ir.metadata ?? {}) };
        metadata.qualityReview = {
            score: quality.score,
            issues: quality.issues.map((i) => ({
                severity: i.severity,
                message: i.message,
                recommendation: i.recommendation,
            })),
        };
        return { ...ir, metadata };
    }

    private async runCritiqueAndRefine(
        ir: DiagramIR,
        artifact: Artifact,
        audience: DiagramAudience,
        settings: Settings,
        architecturalViolations: ReturnType<typeof detectArchitecturalViolations>,
        detectedIssues: ReturnType<typeof analyzeDiagramQuality>['issues'],
    ): Promise<DiagramIR | null> {
        const modelName = resolveModelForSettings('default', settings).id;

        // Pass 3: critique (JSON only, low thinking — pure analysis).
        const critiquePrompt = buildIRCritiquePrompt({
            ir,
            artifact,
            audience,
            detectedIssues: detectedIssues.map((i) => ({
                severity: i.severity,
                message: i.message,
                recommendation: i.recommendation,
            })),
            architecturalViolations,
        });
        const critiqueConfig = buildDiagramGenerationConfig({
            temperature: 0.2,
            thinking: 'low',
            responseMimeType: 'application/json',
        });
        let critique: unknown = null;
        try {
            const text = await this.generateTextWithFallback(settings, modelName, critiquePrompt, critiqueConfig);
            const cleanJson = this.cleanJsonString(text || '');
            if (cleanJson) critique = JSON.parse(cleanJson);
        } catch (err) {
            console.warn('[geminiService.runCritiqueAndRefine] critique pass failed; skipping refine', err);
            return null;
        }
        if (!critique) return null;

        // Pass 4: refine (returns full IR with embedded review).
        const responseSchema = buildDiagramIRSchema({ withReview: true });
        const refinePrompt = buildIRRefinePrompt({ ir, critique, artifact, audience });
        const refineConfig = buildDiagramGenerationConfig({
            temperature: diagramTemperature(settings.aiConfig?.temperature),
            thinking: 'low',
            responseSchema,
            extraSystemInstruction: buildDialectInstruction(artifact.type) || undefined,
        });
        try {
            const text = await this.generateTextWithFallback(settings, modelName, refinePrompt, refineConfig);
            const cleanJson = this.cleanJsonString(text || '');
            if (!cleanJson) return null;
            const parsed = JSON.parse(cleanJson) as Partial<DiagramIR> & { error?: string };
            if (parsed.error || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || parsed.nodes.length === 0) {
                return null;
            }
            const nodeIds = new Set(parsed.nodes.map((n) => n.id));
            const cleanEdges = parsed.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
            const cleanGroups = (Array.isArray(parsed.groups) ? parsed.groups : [])
                .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => nodeIds.has(id)) }))
                .filter((g) => g.nodeIds.length > 0);
            return {
                nodes: parsed.nodes,
                edges: cleanEdges,
                groups: cleanGroups,
                metadata: {
                    ...(ir.metadata ?? {}),
                    ...(parsed.metadata ?? {}),
                    sourceFormat: 'unknown',
                    audience,
                    generatedAt: new Date().toISOString(),
                },
            } as DiagramIR;
        } catch (err) {
            console.error('[geminiService.runCritiqueAndRefine] refine pass failed', err);
            return null;
        }
    }

    public async convertToExcalidrawJSON(
        mermaidContent: string,
        settings: Settings,
        isDark: boolean = false
    ): Promise<{ elements: unknown[] } | null> {
        // Semantic color palette — chosen to be vivid and readable in both modes
        const colors = isDark ? {
            person:   { bg: '#1e3a5f', stroke: '#60a5fa', text: '#bfdbfe' },
            api:      { bg: '#2e1065', stroke: '#c084fc', text: '#e9d5ff' },
            service:  { bg: '#1e1b4b', stroke: '#818cf8', text: '#c7d2fe' },
            database: { bg: '#064e3b', stroke: '#34d399', text: '#a7f3d0' },
            external: { bg: '#451a03', stroke: '#fbbf24', text: '#fde68a' },
            queue:    { bg: '#3b2200', stroke: '#fcd34d', text: '#fef9c3' },
            cloud:    { bg: '#0c4a6e', stroke: '#38bdf8', text: '#bae6fd' },
            generic:  { bg: '#1e293b', stroke: '#94a3b8', text: '#e2e8f0' },
        } : {
            person:   { bg: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
            api:      { bg: '#ede9fe', stroke: '#7c3aed', text: '#2e1065' },
            service:  { bg: '#e0e7ff', stroke: '#4f46e5', text: '#1e1b4b' },
            database: { bg: '#d1fae5', stroke: '#059669', text: '#064e3b' },
            external: { bg: '#fef3c7', stroke: '#d97706', text: '#451a03' },
            queue:    { bg: '#fef9c3', stroke: '#ca8a04', text: '#713f12' },
            cloud:    { bg: '#e0f2fe', stroke: '#0284c7', text: '#0c4a6e' },
            generic:  { bg: '#f1f5f9', stroke: '#64748b', text: '#0f172a' },
        };

        const arrowColor = isDark ? '#94a3b8' : '#64748b';
        const asyncArrowColor = isDark ? '#fbbf24' : '#d97706';

        const prompt = `You are a professional software architecture diagram designer. Convert this Mermaid diagram into a visually attractive Excalidraw JSON diagram with professional styling.

ARCHITECTURE ELEMENT COLORS (use exact hex values based on the element's role):
- Person/Actor/User: backgroundColor="${colors.person.bg}", strokeColor="${colors.person.stroke}"
- API/Gateway/Proxy/Load-Balancer: backgroundColor="${colors.api.bg}", strokeColor="${colors.api.stroke}"
- Service/Backend/System/Module/Application: backgroundColor="${colors.service.bg}", strokeColor="${colors.service.stroke}"
- Database/Cache/Store/Redis/SQL/Mongo: backgroundColor="${colors.database.bg}", strokeColor="${colors.database.stroke}"
- External/Third-Party/Legacy/Vendor: backgroundColor="${colors.external.bg}", strokeColor="${colors.external.stroke}"
- Queue/Broker/Kafka/RabbitMQ/Event: backgroundColor="${colors.queue.bg}", strokeColor="${colors.queue.stroke}"
- Cloud/SaaS/AWS/Azure/GCP: backgroundColor="${colors.cloud.bg}", strokeColor="${colors.cloud.stroke}"
- Generic fallback: backgroundColor="${colors.generic.bg}", strokeColor="${colors.generic.stroke}"

SHAPE RULES:
- Persons/Actors → type="ellipse"
- Databases/Caches → type="rectangle" (cylinder-style with thicker border, strokeWidth=3)
- API Gateways/Decision nodes → type="diamond"
- Everything else → type="rectangle"

NODE LAYOUT RULES (CRITICAL — must produce readable, non-overlapping diagrams):
- Node width: 260px, height: 100px (ellipses: 180x80)
- Horizontal gap between columns: 320px (center-to-center)
- Vertical gap between rows: 200px (center-to-center)
- Layer 0 (top): Persons/Actors — start at x=200, y=80
- Layer 1: API Gateways / Entry Points — start at x=200, y=280
- Layer 2: Core Services/Systems — start at x=200, y=480
- Layer 3 (bottom): Databases, Queues, External — start at x=200, y=680
- Spread each layer horizontally: first node at column 0, next at column 1 (x+=320), etc.
- Center the layers: if 3 nodes in a layer, offset starting x so they are centered around x=600

NODE TEXT (required fields):
- text: the node label (title only, max 30 chars)
- fontSize: 15
- fontFamily: 1
- textAlign: "center"
- verticalAlign: "middle"
- strokeWidth: 2 (use 3 for databases)
- roughness: 0
- fillStyle: "solid"
- opacity: 100

SUBTITLE TEXT ELEMENTS (for each node, add a subtitle text element below the label):
- type="text", fontSize=11, text=technology/role keyword (e.g. "REST API", "PostgreSQL", "React SPA")
- Position: same x as node center, y = node.y + 28
- strokeColor="${isDark ? '#94a3b8' : '#64748b'}", backgroundColor="transparent"
- width = node width, height = 20

ARROW RULES:
- type="arrow"
- strokeColor="${arrowColor}" for synchronous, "${asyncArrowColor}" for async/event-driven
- strokeWidth: 2 for sync, 2.5 for async
- strokeDasharray for async arrows: set roughness=1 (this signals async visually)
- width=0, height=0 (arrows don't have width/height)
- points: calculate from source node center to target node center, e.g. [[0,0],[dx,dy]]
- startBinding: { "elementId": "<source-node-id>", "focus": 0, "gap": 10 }
- endBinding: { "elementId": "<target-node-id>", "focus": 0, "gap": 10 }

ARROW LABELS:
- For each arrow with a label: add a type="text" element at the midpoint between source and target
- fontSize=11, strokeColor="${isDark ? '#94a3b8' : '#475569'}", backgroundColor="${isDark ? '#1e293b' : '#f8fafc'}"
- Keep labels short (max 25 chars), trim if needed

LAYER FRAME BACKGROUNDS (CRITICAL for visual grouping):
- For EACH logical layer (e.g., "Actors", "API Gateway", "Services", "Data Layer"), create a background rectangle:
  - type="rectangle", positioned to encompass ALL nodes in that layer
  - x = leftmost node x - 40, y = layer y - 30
  - width = (rightmost node x + node width) - leftmost node x + 80
  - height = node height + 60
  - backgroundColor="${isDark ? 'rgba(30,41,59,0.15)' : 'rgba(241,245,249,0.5)'}"
  - strokeColor="${isDark ? '#334155' : '#e2e8f0'}", strokeWidth=1, strokeDasharray (dashed outline)
  - roughness=0, fillStyle="solid", opacity=40
  - PLACE these frame rectangles FIRST in the elements array (so they render behind nodes)
- Add a type="text" label for each frame at the top-left corner (x + 10, y + 5):
  - text = layer name (e.g., "Actors", "Core Services", "Data Layer")
  - fontSize=12, fontFamily=1, strokeColor="${isDark ? '#64748b' : '#94a3b8'}"

TECHNOLOGY SUBTITLES (MANDATORY for every node):
- Below each node label, add a type="text" subtitle element:
  - text = specific technology with version when possible (e.g., "PostgreSQL 15", "Spring Boot 3.x", "React 18", "Kafka 3.6")
  - Position: node center x, y = node.y + 28
  - fontSize=10, fontFamily=1, strokeColor="${isDark ? '#64748b' : '#94a3b8'}", backgroundColor="transparent"
  - width = node width, height = 16

COLOR LEGEND (bottom-right corner):
- Add a small legend group at x = max_x + 100, y = max_y - 120:
  - Title text: "Legend", fontSize=13, fontFamily=1
  - For each role used in the diagram, add a small colored rectangle (20x14) + text label:
    - Person (${colors.person.bg}), API (${colors.api.bg}), Service (${colors.service.bg})
    - Database (${colors.database.bg}), Queue (${colors.queue.bg}), External (${colors.external.bg})
  - Space items vertically by 22px

ARROW ROUTING:
- Arrows MUST NOT visually cross through node bodies. Route arrows around obstacles if needed.
- For arrows between nodes on the same horizontal level, add a midpoint bend to create a slight arc.
- Maintain minimum 20px gap between parallel arrows.

TITLE ELEMENT:
- Add a type="text" element at x=50, y=20 with the diagram title (inferred from context)
- fontSize=20, strokeColor="${isDark ? '#e2e8f0' : '#0f172a'}", fontFamily=1

OUTPUT FORMAT:
Respond ONLY with valid JSON: { "elements": [...] }
Do NOT include markdown fences or explanations.
Place frame background rectangles FIRST, then nodes, then subtitle texts, then arrows, then arrow labels, then legend.

MERMAID DIAGRAM TO CONVERT:
${mermaidContent}`;

        const responseSchema = {
            type: 'object',
            properties: {
                elements: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            type: { type: 'string' },
                            x: { type: 'number' },
                            y: { type: 'number' },
                            width: { type: 'number' },
                            height: { type: 'number' },
                            angle: { type: 'number' },
                            strokeColor: { type: 'string' },
                            backgroundColor: { type: 'string' },
                            fillStyle: { type: 'string' },
                            strokeWidth: { type: 'number' },
                            roughness: { type: 'number' },
                            opacity: { type: 'number' },
                            text: { type: 'string' },
                            fontSize: { type: 'number' },
                            fontFamily: { type: 'number' },
                            textAlign: { type: 'string' },
                            verticalAlign: { type: 'string' }
                        },
                        required: ['id', 'type', 'x', 'y', 'width', 'height', 'strokeColor', 'backgroundColor']
                    }
                }
            },
            required: ['elements']
        };

        try {
            // Excalidraw conversion is layout-and-style mapping rather than
            // reasoning. Quick tier + thinking off is plenty. Routed through the
            // model-fallback pipeline so a 429 on flash-lite falls back instead
            // of returning null and blanking the Excalidraw view.
            const { text } = await this.generateContentWithFallback(
                settings,
                resolveModelForSettings('quick', settings).id,
                prompt,
                buildDiagramGenerationConfig({
                    temperature: 0.2,
                    thinking: 'off',
                    responseSchema,
                }),
            );
            const cleanJson = this.cleanJsonString(text || '');
            return JSON.parse(cleanJson || '{"elements":[]}');
        } catch (error) {
            console.error("Excalidraw conversion error:", error);
            return null;
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
    public async proposeArtifactBriefContract(
        project: Project,
        request: string,
        deterministic: ArtifactGenerationContract,
        settings: Settings,
        opts: { timeoutMs?: number } = {},
    ): Promise<{ proposal: ArtifactGenerationContractProposal; rawResponse: string }> {
        const modelName = resolveModelForSettings('quick', settings).id;
        const prompt = `${this.buildBasePrompt(project, settings, { mode: 'diagram', maxContextItems: 4, maxDescriptionChars: 600 })}

You are refining a STRUCTURED ARTIFACT GENERATION BRIEF for a software architecture tool.
A deterministic extractor already produced a trusted baseline contract. Return ONLY a
partial proposal for fields you can make more precise; otherwise omit the field.

ORIGINAL USER REQUEST:
"""
${request.trim().slice(0, 1600)}
"""

DETERMINISTIC BASELINE CONTRACT (JSON):
${JSON.stringify({
            normalizedIntent: deterministic.normalizedIntent,
            audience: deterministic.audience,
            artifactFamily: deterministic.artifactFamily,
            purpose: deterministic.purpose,
            detailLevel: deterministic.detailLevel,
            acceptanceCriteria: deterministic.acceptanceCriteria,
            exportTargets: deterministic.exportTargets,
            qualityTarget: deterministic.qualityTarget,
        })}

RULES:
- Do NOT change the meaning of the original request. normalizedIntent must still cover it.
- Do NOT invent source artifacts. Do NOT reference excluded sources.
- Do NOT lower qualityTarget below ${deterministic.qualityTarget}.
- audience ∈ executive|technical|operations|business|mixed
- artifactFamily ∈ auto|document|diagram|hybrid|table|matrix|presentation
- purpose ∈ decision|explanation|design|implementation|analysis|governance|comparison|validation|communication
- detailLevel ∈ executive|conceptual|logical|physical|technical|deep-technical
- acceptanceCriteria: keep every baseline criterion, you may add sharper ones.

Return ONLY valid JSON compatible with this partial shape (no prose, omit unknown fields):
{
  "normalizedIntent": "string",
  "audience": "one enum value",
  "artifactFamily": "one enum value",
  "purpose": "one enum value",
  "detailLevel": "one enum value",
  "acceptanceCriteria": ["string"],
  "exportTargets": ["string"],
  "requiredContextItems": ["string"],
  "excludedContextItems": ["string"],
  "qualityTarget": ${deterministic.qualityTarget}
}`;

        let raw = '';
        try {
            const response = await this.generateContentWithFallback(
                settings,
                modelName,
                prompt,
                { temperature: 0.15, topP: 0.85, maxOutputTokens: 900 },
                { timeoutMs: opts.timeoutMs ?? 30000, maxRetries: 1 },
            );
            raw = response.text ?? '';
        } catch (error) {
            console.warn('[geminiService] proposeArtifactBriefContract: AI proposal failed, degrading to deterministic.', error);
            return { proposal: {}, rawResponse: raw };
        }

        const cleanJson = this.cleanJsonString(raw || '');
        if (!cleanJson) return { proposal: {}, rawResponse: raw };
        try {
            const parsed = JSON.parse(cleanJson) as Record<string, unknown>;
            const proposal: ArtifactGenerationContractProposal = {};
            if (typeof parsed.normalizedIntent === 'string') proposal.normalizedIntent = parsed.normalizedIntent;
            if (typeof parsed.audience === 'string') proposal.audience = parsed.audience as ArtifactGenerationContract['audience'];
            if (typeof parsed.artifactFamily === 'string') proposal.artifactFamily = parsed.artifactFamily as ArtifactGenerationContract['artifactFamily'];
            if (typeof parsed.purpose === 'string') proposal.purpose = parsed.purpose as ArtifactGenerationContract['purpose'];
            if (typeof parsed.detailLevel === 'string') proposal.detailLevel = parsed.detailLevel as ArtifactGenerationContract['detailLevel'];
            if (Array.isArray(parsed.acceptanceCriteria)) proposal.acceptanceCriteria = parsed.acceptanceCriteria.filter((item): item is string => typeof item === 'string');
            if (Array.isArray(parsed.exportTargets)) proposal.exportTargets = parsed.exportTargets.filter((item): item is string => typeof item === 'string');
            if (Array.isArray(parsed.requiredContextItems)) proposal.requiredContextItems = parsed.requiredContextItems.filter((item): item is string => typeof item === 'string');
            if (Array.isArray(parsed.excludedContextItems)) proposal.excludedContextItems = parsed.excludedContextItems.filter((item): item is string => typeof item === 'string');
            if (typeof parsed.qualityTarget === 'number' && Number.isFinite(parsed.qualityTarget)) proposal.qualityTarget = parsed.qualityTarget;
            return { proposal, rawResponse: raw };
        } catch (error) {
            console.warn('[geminiService] proposeArtifactBriefContract: malformed JSON, degrading to deterministic.', error);
            return { proposal: {}, rawResponse: raw };
        }
    }


    public async processAssistantChat(
        project: Project,
        activeArtifact: Artifact | null,
        history: ChatMessage[],
        question: string,
        settings: Settings
    ): Promise<{ text: string, functionCall?: any }> {
        // Single source of truth for the Arquitecto Agente system instruction:
        // base persona → Memoria del Agente → AI config → Global → Project →
        // Project-agent → Artifact → execution rules. The composer applies
        // per-scope budgets and relevance selection so token usage stays
        // predictable as memories grow.
        const systemInstruction = buildAgentSystemInstruction({
            project,
            activeArtifact,
            settings,
            userQuery: question,
            persona: buildOfficePersonaBriefing(resolveOfficeAgentMention(question).id),
        });

        const includeChatHistory = settings.aiConfig?.includeChatHistoryByDefault === true;
        const chatHistory = prepareChatHistoryForModel({ history, includeChatHistory });
        const modelName = resolveModelForSettings('default', settings).id;

        const result = await this.generateContentWithFallback(
            settings,
            modelName,
            [...chatHistory, { role: 'user', parts: [{ text: question }] }],
            {
                systemInstruction,
                temperature: settings.aiConfig?.temperature ?? 0.7,
                tools: activeArtifact ? [MODIFY_ARTIFACT_TOOL] : undefined,
            },
            { maxRetries: 1 },
        );
        if (result.functionCalls && result.functionCalls.length > 0) {
            const call = result.functionCalls[0];
            return { text: result.text, functionCall: { name: call.name, args: call.args } };
        }
        return { text: result.text };
    }

    /**
     * Streaming variant of {@link processAssistantChat}.
     *
     * Calls `generateContentStream` and forwards each chunk of text to
     * `onDelta(fullText, deltaText)` so the UI can render token-by-token
     * progress.  Function calls are surfaced once the stream finishes
     * (Gemini emits the full function call in the final chunk's accumulated
     * payload, not interleaved with text).
     *
     * Errors from the underlying SDK are still retried by the transport
     * — but only for the *initial* connection attempt.  Once the stream is
     * open we don't retry, because partial output may already be on screen.
     */
    public async processAssistantChatStream(
        project: Project,
        activeArtifact: Artifact | null,
        history: ChatMessage[],
        question: string,
        settings: Settings,
        onDelta: (fullText: string, deltaText: string) => void,
    ): Promise<{ text: string; functionCall?: { name: string; args: Record<string, unknown> } }> {
        // Same composition contract as the non-streaming variant — keeping the
        // two methods in lock-step means the model never sees a different
        // identity depending on whether the UI used streaming.
        const systemInstruction = buildAgentSystemInstruction({
            project,
            activeArtifact,
            settings,
            userQuery: question,
            persona: buildOfficePersonaBriefing(resolveOfficeAgentMention(question).id),
        });

        const includeChatHistory = settings.aiConfig?.includeChatHistoryByDefault === true;
        const chatHistory = prepareChatHistoryForModel({ history, includeChatHistory });
        const modelName = resolveModelForSettings('default', settings).id;

        // Open the stream — guarded by the unified model-fallback pipeline so
        // 429/overloaded responses on the preferred model fall through to the
        // next candidate before the user ever sees a hard error. Mid-stream
        // failures (after first chunk) are NOT retried because partial output
        // may already be rendered.
        const stream = await this.generateContentStreamWithFallback(
            settings,
            modelName,
            [...chatHistory, { role: 'user', parts: [{ text: question }] }],
            {
                systemInstruction,
                temperature: settings.aiConfig?.temperature ?? 0.7,
                tools: activeArtifact ? [MODIFY_ARTIFACT_TOOL] : undefined,
            },
            { maxRetries: 1 },
        );

        let fullText = '';
        let lastFunctionCall: { name: string; args: Record<string, unknown> } | undefined;

        try {
            for await (const chunk of stream) {
                // Function calls arrive on a separate field; capture the
                // first non-empty one we see (Gemini emits at most one per
                // turn for our tool schema).
                const calls = (chunk as { functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> }).functionCalls;
                if (calls && calls.length > 0 && !lastFunctionCall) {
                    const call = calls[0];
                    if (call.name) {
                        lastFunctionCall = { name: call.name, args: call.args ?? {} };
                    }
                }
                const delta = (chunk as { text?: string }).text ?? '';
                if (delta) {
                    fullText += delta;
                    onDelta(fullText, delta);
                }
            }
        } catch (err) {
            // Mid-stream failures: rewrap so the UI gets a clean userMessage.
            throw classifyAIError(err);
        }

        return lastFunctionCall ? { text: fullText, functionCall: lastFunctionCall } : { text: fullText };
    }

    public async analyzeChatForContext(
        history: ChatMessage[],
        latestUserMessage: string,
        latestAiResponse: string,
        settings: Settings
    ): Promise<string | null> {
        const prompt = `Analyze conversation. Did user define a KEY constraint/tech choice? If yes, summarize in 1 sentence for context. If no, return "NO_CONTEXT".
        
        Last interaction:
        User: ${latestUserMessage}
        AI: ${latestAiResponse}`;

        try {
            // Honour the user's model preference and route through the model-
            // fallback pipeline so a 429 on the preferred model degrades to the
            // next model instead of silently dropping context extraction.
            const { text: raw } = await this.generateContentWithFallback(
                settings,
                resolveModelForSettings('default', settings).id,
                prompt,
                {},
                { maxRetries: 1 },
            );
            const text = raw?.trim();
            return (text && text !== "NO_CONTEXT") ? text : null;
        } catch { return null; }
    }

    public async runConsistencyCheck(project: Project, settings: Settings): Promise<ConsistencySuggestion[]> {
        const prompt = `
${this.buildBasePrompt(project, settings)}
Analyze ALL artifacts for inconsistencies/contradictions.
Artifacts: ${JSON.stringify(project.artifacts.map(a => ({id: a.id, name: a.name, content: a.content.substring(0, 1000)})))}

Return JSON Array: [{ "id": "1", "inconsistency": "desc", "suggestion": "fix", "isApplied": false, "changes": [{ "artifactId": "id", "oldContentSnippet": "...", "newContent": "FULL NEW CONTENT" }] }]
Return [] if none.
`;
        const modelName = resolveModelForSettings('default', settings).id;

        try {
            const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: {type:'string'}, inconsistency:{type:'string'}, suggestion:{type:'string'}, isApplied:{type:'boolean'},
                            changes: { type: 'array', items: { type: 'object', properties: { artifactId:{type:'string'}, oldContentSnippet:{type:'string'}, newContent:{type:'string'} } } }
                        }
                    }
                }
            }, { timeoutMs: 300000 });
            const cleanJson = this.cleanJsonString(text || '');
            return JSON.parse(cleanJson || '[]');
        } catch (e) {
            console.error("Consistency Check Error:", e);
            return [];
        }
    }

    public async processMultimodalChat(
        purpose: ChatModalPurpose,
        history: ChatMessage[],
        question: string,
        files: UploadedFile[],
        settings: Settings,
        projects?: Project[],
        courses?: any[]
    ): Promise<string> {
        let instruction = "";
        if (purpose === 'guided-creation') instruction = "Guide user to define project. Once clear (3-4 q's), return JSON: {\"action\": \"createProject\", \"data\": {\"name\": \"...\", \"description\": \"...\", \"projectContext\": [...], \"initialArtifacts\": [...]}}. Else, converse.";
        else if (purpose === 'analyze-document') instruction = "Analyze docs. Return JSON: {\"action\": \"createProject\", \"data\": {\"name\": \"...\", \"description\": \"...\", \"projectContext\": [...], \"initialArtifacts\": [...]}}.";
        else {
            instruction = `You are an expert solution architect, acting as Arquitecto Agente.
            
CRITICAL INDUSTRY CONTEXT:
This platform is a service provided to an Insurance Company that offers Life and Health products. 
Whenever you are answering ANY question, you MUST take this into account. 
You must adhere to the highest standards of the Life and Health Insurance industry, as well as the best standards in Technology.

Global Context/Standards:
${settings.globalContext.map(c => `- ${c}`).join('\n')}

Review architecture and provide feedback. If the user asks specific information about a project or a course, you MUST use the provided context below to answer. If the user asks general questions, provide advice based on your knowledge as Arquitecto Agente.

`;
            if (projects && projects.length > 0) {
                instruction += `\n\n--- EXISTING PROJECTS CONTEXT ---\n`;
                projects.forEach(p => {
                    instruction += `Project: ${p.name}\nDescription: ${p.description}\nArtifacts:\n${p.artifacts.map(a => `- ${a.name} (${a.type}): ${a.objective}`).join('\n')}\n\n`;
                });
            }
            if (courses && courses.length > 0) {
                instruction += `\n\n--- EXISTING COURSES CONTEXT ---\n`;
                courses.forEach(c => {
                    instruction += `Course: ${c.title}\nDescription: ${c.description}\nCategory: ${c.category}\nLevel: ${c.level}\nKnowledge Cards (Lessons):\n${c.modules?.map((m: any) => m.lessons?.map((l: any) => `- ${l.title}: ${l.description}`).join('\n')).join('\n')}\n\n`;
                });
            }
        }

        const tone = settings.aiConfig?.tone || 'Professional';
        instruction += ` Tone: ${tone}.`;

        const contents = history.map((message, index) => {
            const isLastUserTurn = index === history.length - 1 && message.role === 'user';
            return {
                role: message.role,
                parts: [
                    { text: message.content },
                    ...(isLastUserTurn ? files.map(f => ({ inlineData: { mimeType: f.type, data: f.base64Data } })) : []),
                ],
            };
        });

        const modelName = resolveModelForSettings('default', settings).id;

        const result = await this.generateContentWithFallback(
            settings,
            modelName,
            contents,
            {
                systemInstruction: instruction,
                temperature: settings.aiConfig?.temperature ?? 0.7,
            },
            { maxRetries: 1 },
        );
        return result.text;
    }

    public async convertDiagramToDocument(artifact: Artifact, project: Project, settings: Settings): Promise<string> {
        const prompt = `${this.buildBasePrompt(project, settings)}\nConvert this diagram to a detailed Markdown document:\n${artifact.content}`;
        const modelName = resolveModelForSettings('default', settings).id;
        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
            temperature: settings.aiConfig?.temperature ?? 0.7
        });
        return text;
    }

    public async generateImageForArtifact(artifact: Artifact, project: Project, settings: Settings): Promise<string> {
        // Image generation is a Gemini capability, not a universal one. Checking
        // first turns "the button failed with an SDK error" into a stated limit
        // the UI can also read via `canGenerateImages(settings)` and disable
        // ahead of time.
        assertModalitySupported(settings, 'images');
        const prompt = `Abstract, high-tech architectural visualization for: ${artifact.name}. Objective: ${artifact.objective}. No text.`;
        const ai = this.getAIClient(settings);
        const response = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: { parts: [{ text: prompt }] },
            config: { responseModalities: [Modality.IMAGE] }
        });
        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error("No image generated");
        return data;
    }

    public async generateSpeechForArtifact(artifact: Artifact, settings: Settings): Promise<string> {
        assertModalitySupported(settings, 'audio');
        const text = artifact.representation === 'document' 
            ? `Reading ${artifact.name}. ${artifact.content.substring(0, 1000)}...`
            : `Describing diagram ${artifact.name}. ${artifact.objective}. Content analysis: ${artifact.content.substring(0, 500)}...`;
            
        const ai = this.getAIClient(settings);
        const response = await ai.models.generateContent({
            model: TTS_MODEL,
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
            }
        });
        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error("No audio generated");
        return data;
    }

    public async getInitialArtifactsForTemplate(templateName: string, settings: Settings): Promise<string[]> {
        const prompt = `Suggest 3-5 artifact template names for project type: "${templateName}". Return JSON Array of strings.`;
        try {
            const { text } = await this.generateContentWithFallback(settings, resolveModelForSettings('default', settings).id, prompt, {
                responseMimeType: 'application/json', responseSchema: { type: 'array', items: { type: 'string' } }
            });
            const cleanJson = this.cleanJsonString(text || '');
            return JSON.parse(cleanJson || '[]');
        } catch { return ["Diagrama de Contexto (C4-N1)", "Visión de la Arquitectura"]; }
    }

    public async generateSvgForArtifact(artifact: Artifact, project: Project, settings: Settings): Promise<string> {
        const prompt = `Generate a clean, professional SVG for this architecture artifact. ONLY raw SVG code. No markdown blocks.\n\n${artifact.content}`;
        const modelName = resolveModelForSettings('default', settings).id;
        const { text: rawText } = await this.generateContentWithFallback(settings, modelName, prompt, {});

        const text = rawText || '';
        const match = text.match(/<svg[\s\S]*?>[\s\S]*?<\/svg>/);
        return match ? match[0] : text.replace(/```svg|```/g, '').trim();
    }

    // --- Artifact Review & Improvement ---

    public async reviewArtifact(artifact: Artifact, project: Project, settings: Settings): Promise<ArtifactReviewSuggestion[]> {
        const basePrompt = this.buildBasePrompt(project, settings);
        
        const prompt = `
${basePrompt}

TASK: Review this specific artifact and suggest tangible improvements based on industry best practices, security, scalability, and clarity.
Artifact Name: ${artifact.name}
Type: ${artifact.type}
Content:
${artifact.content}

Return a JSON Array of improvements: [{ "id": "uuid", "title": "short title", "description": "detailed explanation", "category": "Security" | "Performance" | "Scalability" | "Best Practices" | "Clarity" }]
`;
        const modelName = resolveModelForSettings('default', settings).id;

        try {
            const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            title: { type: 'string' },
                            description: { type: 'string' },
                            category: { type: 'string', enum: ['Security', 'Performance', 'Scalability', 'Best Practices', 'Clarity'] }
                        },
                        required: ['id', 'title', 'description', 'category']
                    }
                }
            });
            const cleanJson = this.cleanJsonString(text || '');
            return JSON.parse(cleanJson || '[]');
        } catch (e) {
            console.error("Artifact Review Error:", e);
            return [];
        }
    }

    public async applyArtifactImprovements(
        artifact: Artifact,
        selectedImprovements: ArtifactReviewSuggestion[],
        project: Project,
        settings: Settings
    ): Promise<string> {
        const basePrompt = this.buildBasePrompt(project, settings);

        const prompt = `
${basePrompt}

TASK: Rewrite the following artifact content to incorporate SPECIFIC improvements.
Original Content:
${artifact.content}

Selected Improvements to Apply:
${selectedImprovements.map(imp => `- [${imp.category}] ${imp.title}: ${imp.description}`).join('\n')}

INSTRUCTIONS:
1. Maintain the original format (Markdown, Mermaid, JSON, etc.).
2. Apply ONLY the selected improvements.
3. Return ONLY the full, updated content code. No explanations.
`;
        // Route through the shared model-fallback pipeline: a quota/rate-limit
        // on the user's preferred model rotates to the next model in
        // MODEL_FALLBACK_CHAIN instead of surfacing a hard error.
        const preferredModel = resolveModelForSettings('default', settings).id;
        const result = await this.generateContentWithFallback(
            settings,
            preferredModel,
            prompt,
            { temperature: 0.3 },
            { maxRetries: 1, maxCandidates: 4 },
        );
        return result.text || artifact.content;
    }

    public async generateTestCases(artifact: Artifact, project: Project, settings: Settings): Promise<string> {
        const basePrompt = this.buildBasePrompt(project, settings);
        const language = settings.language === 'es' ? 'Spanish' : 'English';

        const prompt = `
${basePrompt}

TASK: Generate a comprehensive set of AUTOMATED TEST CASES for the following architectural artifact.
Artifact Name: ${artifact.name}
Type: ${artifact.type}
Objective: ${artifact.objective}
Content:
${artifact.content}

INSTRUCTIONS:
1. Provide a mix of Unit, Integration, and E2E test cases where applicable.
2. Use a structured format (e.g., Gherkin/Cucumber for behavior, or a technical test plan).
3. Include:
   - Test Case ID and Title
   - Pre-conditions
   - Test Steps
   - Expected Result
   - Automated Snippet (e.g., Jest, Playwright, or Gherkin)
4. Focus on the architectural constraints and objectives defined in the artifact.
5. Respond ONLY with the Markdown content.
6. Language: ${language}.
`;
        const modelName = resolveModelForSettings('default', settings).id;

        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
            temperature: 0.7
        });
        return text || "Error generating test cases.";
    }

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


    public async chatWithProject(
        project: Project,
        message: string,
        history: { role: 'user' | 'model', parts: { text: string }[] }[],
        settings: Settings,
        /**
         * Explicit persona for this turn. The Architecture Office runner passes
         * it so the specialist is bound by the caller, not inferred from the
         * message text — a coordination brief that happens to contain an
         * `@Alias` must never hijack the persona of a downstream workstream.
         */
        personaOverride?: OfficeAgentId,
        /** Tier for this turn — the Office resolves it from the agent's card. */
        modelTier: ModelTier = 'default',
    ): Promise<string> {
        const basePrompt = this.buildBasePrompt(project, settings);
        // Build a summary of all artifacts to give the AI global context
        const artifactsSummary = project.artifacts.map(a => 
            `--- Artifact: ${a.name} (${a.type}) ---\nObjective: ${a.objective}\nContent Snippet: ${a.content.substring(0, 500)}...\n`
        ).join('\n');

        const projectInstruction = `
${basePrompt}

You are the Chief Software Architect for this project. You have GLOBAL CONTEXT of all the artifacts in the system.
The user is asking a question or requesting an action that may span multiple artifacts or require understanding the system as a whole.

PROJECT ARTIFACTS SUMMARY:
${artifactsSummary}

INSTRUCTIONS:
1. Answer the user's question based on the global context of the project.
2. If the user asks about the impact of a change, analyze how it affects different artifacts.
3. Be concise, technical, and authoritative.
4. If you need to suggest code or configuration (like docker-compose, Kubernetes manifests, etc.), provide it in standard Markdown code blocks.
`;
        const officeContext = getOfficeArchitectureContext();
        const systemInstruction = buildOfficePersonaInstruction(
            `${projectInstruction}\n\nARCHITECTURE OFFICE STANDARDS:\n${officeContext.promptContext.map((item) => `- ${item}`).join('\n')}`,
            personaOverride ? OFFICE_AGENT_PERSONAS[personaOverride] : resolveOfficeAgentMention(message),
        );

        const modelName = resolveModelForSettings(modelTier, settings).id;

        // Format history into the prompt to ensure context is kept across model fallbacks.
        const historyText = history.map(h => `${h.role === 'user' ? 'User' : 'Architect'}: ${h.parts[0].text}`).join('\n\n');
        const fullMessage = historyText ? `Previous Conversation:\n${historyText}\n\nUser: ${message}` : message;

        const result = await this.generateContentWithFallback(
            settings,
            modelName,
            fullMessage,
            {
                systemInstruction,
                temperature: settings.aiConfig?.temperature ?? 0.7,
            },
            { maxRetries: 1 },
        );
        return result.text;
    }

    public async fixDiagramError(
        artifact: Artifact,
        errorDetails: string,
        project: Project,
        settings: Settings
    ): Promise<string> {
        const hasMermaidFence = artifact.content.includes('```mermaid');
        const isReactFlow = artifact.type.includes('react-flow');
        const isMermaidArtifact = artifact.type.startsWith('mermaid') || hasMermaidFence;

        // Prefer the canonical auto-fix prompt for any Mermaid-bearing artifact.
        // Falls back to a minimal instruction prompt for pure JSON artifacts.
        let prompt: string;
        if (isMermaidArtifact) {
            // Extract the mermaid body so the auto-fix prompt stays surgical.
            const fenceMatch = artifact.content.match(/```mermaid\s*([\s\S]*?)\s*```/);
            const mermaidBody = fenceMatch ? fenceMatch[1] : artifact.content;
            prompt = buildAutoFixPrompt({ mermaid: mermaidBody, error: errorDetails });
        } else {
            const basePrompt = this.buildBasePrompt(project, settings);
            prompt = `${basePrompt}

TASK: SELF-HEALING DIAGRAM.
The following diagram code generated a syntax or rendering error. You must fix it.

Artifact Name: ${artifact.name}
Type: ${artifact.type}

ERROR DETAILS:
${errorDetails}

CURRENT BROKEN CODE:
${artifact.content}

INSTRUCTIONS:
1. Analyze the error and the broken code.
2. Fix the syntax error so the diagram renders correctly.
3. Return ONLY valid JSON for ReactFlow. No markdown blocks, no explanations.`;
        }

        // Surgical syntax fix is mechanical → cheap tier + thinking off.
        const modelName = MODEL_TIERS.quick;

        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, buildDiagramGenerationConfig({
            temperature: 0.1,
            thinking: 'off',
        }));

        {
            let fixedContent = text || artifact.content;
            if (isMermaidArtifact) {
                // Strip any accidental fences the model still added.
                fixedContent = fixedContent.replace(/```mermaid\s*/gi, '').replace(/```\s*$/g, '').trim();
                if (hasMermaidFence) {
                    fixedContent = `\`\`\`mermaid\n${fixedContent}\n\`\`\``;
                }
            } else if (isReactFlow) {
                fixedContent = this.cleanJsonString(fixedContent);
            }
            return fixedContent;
        }
    }


    // --- LMS Methods ---
    



    public async synthesizeSmartNote(content: string, settings: Settings): Promise<string> {
        const prompt = `
        Synthesize the following content into an ultra-short mnemonic format (max 150 words).
        Use bullet points, golden rules, and bold text for key concepts.
        
        Content:
        ${content}
        `;

        const modelName = resolveModelForSettings('default', settings).id;

        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
            temperature: 0.3
        });
        return text;
    }

    /**
     * Practical lab (#3): generates a diagram-design challenge for a lesson.
     * The student must respond with a Mermaid diagram, which is then evaluated
     * by {@link evaluateDiagramChallenge} against the diagram-quality rubric.
     */

    /**
     * Practical lab (#3): evaluates a student's Mermaid diagram against the
     * canonical 10-dimension diagram-quality rubric and returns a structured,
     * per-dimension assessment.
     */

    /**
     * Adaptive learning (#2): generates a short multiple-choice skill diagnostic
     * for an architect role, covering distinct competency areas.
     */

    // ─────────────────────────────────────────────────────────────────────────
    // SDD — Specification-Driven Development Functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Generates a full SDD process plan tailored to the project context.
     * Returns a structured Markdown document describing all 5 SDD phases
     * with artifact recommendations, priorities, and sequencing.
     */
    public async generateSDDProcessPlan(project: Project, settings: Settings): Promise<string> {
        const basePrompt = this.buildBasePrompt(project, settings);
        const artifactsContext = this.buildArtifactsContext(project);
        const modelName = resolveModelForSettings('default', settings).id;

        const prompt = `
${basePrompt}
${artifactsContext}

You are a senior SDD (Specification-Driven Development) architect. Generate a tailored SDD process plan for this project.

The plan must cover all 5 SDD phases with specific recommendations based on the project domain, existing artifacts, and gaps.

Output a comprehensive Markdown document with this structure:

# Plan SDD — ${project.name}

## Executive Summary
[2-3 sentences on why SDD is critical for this project and what the plan achieves]

## SDD Maturity Assessment
[Assess current state: what specifications exist, what is missing, overall SDD readiness score 0-100]

## Phase 1: Requirements Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- BRD (Business Requirements Document) — [status and priority]
- Use Case Specifications — [status and priority]
- User Story Map — [status and priority]
### Recommended Next Steps:
[Specific actions for this project]

## Phase 2: Architecture Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- Domain Model DDD — [status and priority]
- Event Storming — [status and priority]
- Ubiquitous Language Glossary — [status and priority]
- Architecture Decision Records (ADR) — [status and priority]
### Recommended Next Steps:

## Phase 3: Component Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- OpenAPI Contract — [status and priority]
- Component Specifications — [status and priority]
- Database Schema — [status and priority]
### Recommended Next Steps:

## Phase 4: Quality Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- NFR Specification (ISO 25010) — [status and priority]
- BDD Scenarios (Gherkin) — [status and priority]
- Test Plan — [status and priority]
### Recommended Next Steps:

## Phase 5: Deployment Specification
### Status: [Complete/Partial/Missing]
### Required Artifacts:
- Infrastructure Specification — [status and priority]
- CI/CD Pipeline — [status and priority]
### Recommended Next Steps:

## Traceability Overview
- Requirements Traceability Matrix status
- Coverage gaps identified

## Recommended Generation Order
[Numbered list of which artifacts to generate first, with rationale based on dependencies]

## SDD Compliance Checklist
[Checkbox list of all SDD requirements for this project]

Be specific to the project domain. Reference existing artifacts by name where applicable.
`;

        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
            temperature: 0.5
        });
        return text;
    }

    /**
     * Analyzes a set of SDD artifacts to assess their completeness and
     * cross-artifact consistency from a specification perspective.
     * Returns an SDD health report in Markdown.
     */
    public async generateSDDHealthReport(project: Project, settings: Settings): Promise<string> {
        const basePrompt = this.buildBasePrompt(project, settings);
        const artifactsContext = this.buildArtifactsContext(project);
        const modelName = resolveModelForSettings('default', settings).id;

        const sddArtifacts = project.artifacts.filter(a => a.type.startsWith('sdd-'));
        const sddArtifactNames = sddArtifacts.map(a => a.name).join(', ') || 'None yet';

        const prompt = `
${basePrompt}
${artifactsContext}

You are an SDD Quality Auditor. Analyze the project's SDD artifacts and produce a health report.

Current SDD artifacts: ${sddArtifactNames}

Generate a Markdown health report:

# SDD Health Report — ${project.name}

## Overall SDD Score: [X/100]

## Completeness Analysis
| SDD Phase | Required Artifacts | Present | Missing | Score |
|-----------|-------------------|---------|---------|-------|
| Phase 1: Requirements | BRD, Use Cases, User Stories | X | X | X% |
| Phase 2: Architecture | Domain Model, Event Storming, Glossary | X | X | X% |
| Phase 3: Components | API Spec, DB Schema, Component Specs | X | X | X% |
| Phase 4: Quality | NFR, BDD Scenarios, Test Plan | X | X | X% |
| Phase 5: Deployment | Infra Spec, CI/CD | X | X | X% |

## Cross-Artifact Consistency
[Identify any conflicts, gaps, or inconsistencies between existing specifications]

## Traceability Coverage
[Assess how well requirements are traced through to architecture and tests]

## Critical Missing Specifications
[List top 3 most critical missing specs with business impact explanation]

## Recommended Immediate Actions
[3-5 concrete next steps prioritized by impact]

## SDD Compliance Status
[Pass/Fail for each SDD principle]
`;

        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
            temperature: 0.4
        });
        return text;
    }

    public async consultArchitecture(challenge: string, settings: Settings): Promise<string> {
        const prompt = `
        ${this.buildLMSTutorPersona(settings)}

        A client from the health and life insurance industry has presented the following architectural challenge:
        "${challenge}"

        As the Architect-Professor and Principal Architect Consultant, provide a strategic, structured solution proposal.
        Every recommendation must justify the **¿Qué problema de negocio resuelve esta decisión arquitectónica?** question.

        Structure your response in Markdown with these sections:
        1. **Resumen Ejecutivo** — Strategic framing: the business problem, the architectural opportunity, and the expected outcome for the insurer
        2. **Arquitectura Propuesta** — High-level architecture with key components, integration patterns, and data flows relevant to the insurance context
        3. **Análisis de Trade-offs** — Honest evaluation: technical advantages, operational risks, business implications, and what you are explicitly NOT recommending and why
        4. **Principios Arquitectónicos Clave** — 3-5 architectural principles derived from this solution that the architect should internalize
        5. **Cursos y Temas Recomendados** — Specific learning topics to deepen expertise for implementing this solution
        `;

        const modelName = resolveModelForSettings('default', settings).id;

        const { text } = await this.generateContentWithFallback(settings, modelName, prompt, {
            temperature: 0.7
        });
        return text;
    }

    /**
     * Extrae apuntes/notas relevantes desde un documento subido por el usuario
     * para alimentar al Centro de Memoria. Devuelve una lista corta y depurada
     * de bullets listos para añadirse como entradas de memoria en el ámbito
     * solicitado (global, proyecto, agente, captura inicial, artefacto).
     */
    public async extractMemoryEntriesFromDocument(
        file: { name: string; type: string; base64Data: string },
        scope: 'global' | 'project' | 'agent' | 'initial-capture' | 'artifact',
        contextHint: string,
        settings: Settings,
    ): Promise<string[]> {
        const scopeGuidance: Record<typeof scope, string> = {
            'global': 'estándares corporativos, tecnologías preferidas, principios técnicos aplicables a TODOS los proyectos',
            'project': 'requisitos, restricciones, decisiones y supuestos específicos del proyecto actual',
            'agent': 'preferencias del usuario, lecciones aprendidas y reglas que el agente debe recordar para este proyecto',
            'initial-capture': 'información inicial relevante capturada al crear el proyecto: objetivos, alcance, stakeholders, riesgos iniciales',
            'artifact': 'notas, requisitos o restricciones específicas para el artefacto indicado',
        };

        const prompt = `Eres un analista experto en arquitectura de software para una compañía de seguros de Vida y Salud.
Analiza el documento adjunto y extrae únicamente los apuntes, hechos, decisiones y notas RELEVANTES para alimentar la memoria del agente en el ámbito: "${scope}".

Foco del ámbito: ${scopeGuidance[scope]}.

Contexto adicional del usuario:
${contextHint || '(sin contexto adicional)'}

Reglas estrictas:
- NO copies texto literal del documento. Interpreta, resume y reescribe cada apunte en una sola línea clara.
- Cada entrada debe ser autocontenida, accionable o informativa, NO ambigua, máximo 220 caracteres.
- Evita redundancias; agrupa ideas equivalentes.
- Descarta marketing, introducciones, índices, tablas de contenidos y agradecimientos.
- Si el documento no aporta nada relevante para el ámbito, devuelve un array vacío.
- Devuelve EXCLUSIVAMENTE JSON válido con la forma: {"entries": ["..."]}. Sin texto adicional, sin markdown.`;

        const modelName = resolveModelForSettings('default', settings).id;

        const result = await this.generateContentWithFallback(
            settings,
            modelName,
            [
                {
                    role: 'user',
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: file.type || 'application/octet-stream', data: file.base64Data } },
                    ],
                },
            ],
            {
                temperature: 0.3,
                responseMimeType: 'application/json',
            },
            { maxRetries: 1 },
        );

        const cleaned = this.cleanJsonString(result.text || '{"entries":[]}');
        try {
            const parsed = JSON.parse(cleaned) as { entries?: unknown };
            const raw = Array.isArray(parsed.entries) ? parsed.entries : [];
            return raw
                .filter((item): item is string => typeof item === 'string')
                .map(item => item.trim())
                .filter(item => item.length > 0 && item.length <= 400)
                .slice(0, 50);
        } catch (error) {
            console.error('extractMemoryEntriesFromDocument: failed to parse JSON', error);
            return [];
        }
    }
}

export const geminiService = new GeminiService();
