/**
 * Canonical prompt library for diagram-related Gemini calls.
 *
 * The strings here are the refreshed 16.1–16.4 prompts from the April 2026
 * visual-pipeline audit.  They:
 *   - Ask Gemini to return DiagramIR JSON (not Mermaid) whenever possible.
 *   - Carry the 10-dimension quality rubric so the model can self-evaluate.
 *   - Reference design tokens instead of hard-coding colours.
 *   - Produce executive, technical and operations variants on demand.
 *   - Embed the self-review step so downstream consumers receive both the
 *     artifact and a JSON `review` block.
 *
 * The prompts are grouped by intent; call sites import the builder they need.
 */

import type { ArtifactType, Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { DiagramAudience, DiagramIR } from '../../../lib/diagram';
import { extractDiagramSignals, renderDiagramSignals } from '../../diagram/diagramSignalExtractor';
import { METADATA_CONTRACT, METADATA_SCHEMA, STORY_INSTRUCTIONS } from './diagramStorySchema';

/**
 * Ten-dimension rubric used across every diagram prompt. Exported so legacy
 * Mermaid prompts can reinforce the same evaluation criteria without
 * duplicating copy.
 */
export const RUBRIC = `Evalúa siempre el resultado en estas 10 dimensiones (0–10 cada una):
1. claridadSemantica — ¿cada nodo tiene un rol inequívoco?
2. consistenciaArquitectonica — ¿respeta el estándar C4/SDD elegido?
3. jerarquiaVisual — ¿hay agrupación / orden que guíe la lectura?
4. legibilidad — ¿labels cortos, sin jerga innecesaria?
5. narrativa — ¿las etiquetas en las aristas cuentan una historia?
6. atractivoVisual — ¿es limpio, usa colores semánticos?
7. preparacionEjecutiva — ¿un C-level lo entiende en 60 s?
8. preparacionTecnica — ¿un arquitecto puede implementarlo?
9. exportabilidad — ¿funciona sin contexto extra en PNG/Lucid?
10. mantenibilidadPipeline — ¿es fácil de regenerar/editar?
Devuelve además un breakdown numérico y un score total ponderado (0–100).`;

export const SEMANTIC_ROLES = `Los roles canónicos disponibles son: person, system, gateway, data, messaging, external, service, process, generic.

Además, asigna SIEMPRE un \`semanticType\` con la taxonomía profesional completa:
 - Actores y roles: human-actor, business-role
 - Sistemas: internal-system, external-system, legacy-system, application, c4-container, component
 - Canales / Portales: portal, digital-channel
 - APIs / Servicios: api, service, microservice
 - Datos: database, document-repository, data-product, analytics-system, report, dashboard
 - Integración / Mensajería: integration-platform, messaging, batch-file
 - Cloud / Plataforma: cloud-service
 - Seguridad / Reglas: security-service, rules-engine, notification-service
 - Negocio / Proveedores: business-process, external-provider
 - Fallback controlado: generic (usar solo si no hay evidencia)

Para los \`edges\`, asigna también un \`semanticType\` específico cuando aplique:
 rest-api, soap, graphql, event, async-messaging, batch, file-transfer, query,
 publish, subscribe, authentication, authorization, notification, data-transfer,
 synchronization, orchestration, composition, dependency, business-flow,
 data-flow, control-flow, generic.

Cada relación crítica DEBE declarar protocolo (REST/HTTPS, Kafka, SQS, EDI…),
direction (unidirectional / bidirectional) y, cuando aplique, criticality
(low / medium / high / critical) y dataSensitivity (public / internal /
confidential / restricted) para que el inspector pueda mostrarlas.

NO especifiques colores ni tamaños: el renderer los aplica usando tokens.`;

/**
 * Refuerzo ligero para prompts que siguen emitiendo Mermaid. Añade la rúbrica
 * y reglas de narrativa sin obligar al modelo a cambiar el formato de salida.
 * Usarlo como *suffix* del prompt actual para subir calidad sin romper la
 * cadena de consumo existente.
 */
export function buildMermaidQualityReinforcement(opts: { audience?: DiagramAudience } = {}): string {
    const audienceHint = opts.audience
        ? opts.audience === 'executive'
            ? 'Audiencia objetivo: comité ejecutivo (≤ 8 nodos, labels de negocio, cero jerga).'
            : opts.audience === 'operations'
                ? 'Audiencia objetivo: operaciones (resaltar colas, jobs, timers, reintentos).'
                : 'Audiencia objetivo: arquitectos e ingenieros (detalle técnico con protocolos).'
        : 'Audiencia objetivo: arquitectos senior (nivel técnico, detalle con protocolos).';

    return `

REFUERZO DE CALIDAD (aplica siempre):
${audienceHint}

${RUBRIC}

Reglas narrativas estrictas (dimensión 5 — narrativa):
 - Cada arista DEBE tener label con verbo accionable ("Autentica", "Consulta catálogo", "Publica evento").
 - Prefiere verbo + objeto corto (≤ 4 palabras) sobre sustantivos genéricos ("call", "data").
 - En flujos asíncronos, antepón * o usa relación asíncrona para diferenciar visualmente.

Reglas de legibilidad (dimensión 4):
 - Labels de nodos ≤ 24 caracteres cuando sea posible.
 - Expandir acrónimos la primera vez ("ADF: Azure Data Factory").
 - Usar grupos/boundaries cuando haya ≥ 5 nodos para mostrar jerarquía.

Entrega SOLO el código solicitado en el formato indicado arriba — sin markdown fences extra, sin comentarios en prosa.`;
}

const IR_SCHEMA = `Devuelve EXCLUSIVAMENTE JSON con esta forma:
{
  "nodes": [{
    "id": string,
    "label": string,
    "kind": string,
    "semanticType"?: string,
    "description"?: string,
    "group"?: string,
    "shape"?: "rectangle" | "cylinder" | "hexagon" | "cloud" | "person" | "diamond" | "tab-box",
    "technology"?: string,
    "owner"?: string,
    "domain"?: string,
    "dataClassification"?: "public" | "internal" | "confidential" | "restricted" | "pii" | "phi" | "pci",
    "securityLevel"?: "none" | "standard" | "elevated" | "critical",
    "compliance"?: string[],
    "criticality"?: "low" | "medium" | "high" | "critical",
    "trust"?: "internal" | "partner" | "external" | "public",
    "businessMeaning"?: string,
    "technicalMeaning"?: string
  }],
  "edges": [{
    "id": string,
    "source": string,
    "target": string,
    "label"?: string,
    "relation"?: "sync" | "async" | "data-flow" | "dependency" | "inheritance" | "default",
    "semanticType"?: string,
    "protocol"?: string,
    "direction"?: "unidirectional" | "bidirectional",
    "criticality"?: "low" | "medium" | "high" | "critical",
    "dataSensitivity"?: "public" | "internal" | "confidential" | "restricted" | "pii" | "phi" | "pci",
    "retryPolicy"?: string,
    "frequency"?: "real-time" | "near-real-time" | "batch" | "on-demand" | "periodic",
    "synchrony"?: "sync" | "async" | "fire-and-forget" | "request-reply",
    "security"?: string,
    "payload"?: string,
    "trust"?: "internal" | "partner" | "external" | "public",
    "businessMeaning"?: string,
    "technicalMeaning"?: string,
    "observability"?: string,
    "sla"?: string,
    "errorHandling"?: string
  }],
  "groups": [{
    "id": string,
    "label": string,
    "nodeIds": string[],
    "kind"?: "swimlane" | "system-boundary" | "enterprise" | "security" | "external-provider" | "data" | "cloud" | "legacy" | "integration" | "cluster",
    "purpose"?: string,
    "boundaryType"?: "trust" | "network" | "data" | "organizational" | "process" | "compliance",
    "owner"?: string,
    "trust"?: "internal" | "partner" | "external" | "public"
  }],
${METADATA_CONTRACT}
  "review": {
    "breakdown": { "claridadSemantica": number, "consistenciaArquitectonica": number, "jerarquiaVisual": number, "legibilidad": number, "narrativa": number, "atractivoVisual": number, "preparacionEjecutiva": number, "preparacionTecnica": number, "exportabilidad": number, "mantenibilidadPipeline": number },
    "score": number,
    "issues": [{ "severity": "critical"|"high"|"medium"|"low", "message": string, "recommendation": string }]
  }
}`;

export interface CanonicalGenerateOptions {
    artifact: Artifact;
    project: Project;
    audience: DiagramAudience;
    settings: Settings;
}

export function buildCanonicalGenerationPrompt(opts: CanonicalGenerateOptions): string {
    const { artifact, project, audience } = opts;
    return `Eres el Principal Software Architect de Arky 10.
Contexto del proyecto: ${project.description}.
Audiencia objetivo: ${audience.toUpperCase()}.
Artefacto solicitado: ${artifact.name} (${artifact.type}).
Objetivo: ${artifact.objective}.

${SEMANTIC_ROLES}

${RUBRIC}

${IR_SCHEMA}

Reglas estrictas:
 - No escribas texto fuera del JSON.
 - Mantén la información de la audiencia: el board ejecutivo necesita menos de 8 nodos; técnico puede tener hasta 40.
 - Las relaciones deben contar la historia: cada label en una arista es verbo + objeto + protocolo/canal (ej: "Consulta póliza · REST/HTTPS", "Publica evento · Kafka").
 - Para diagramas de integración/contexto, prioriza dirección unidireccional y evita etiquetas largas (>40 chars) en el canvas.
 - Marca información inferida con trust="inferred"; si falta información crítica usa trust="unknown" y evita inventar datos.
 - Si el dato de entrada es insuficiente, responde con {"error": "<motivo>"} y nada más.
`;
}

export interface CanonicalReviewOptions {
    ir: unknown;
    audience: DiagramAudience;
}

export function buildCanonicalReviewPrompt(opts: CanonicalReviewOptions): string {
    return `Revisa este DiagramIR como revisor senior. Aplica el rúbrica de 10 dimensiones.

DiagramIR actual (JSON):
${JSON.stringify(opts.ir, null, 2)}

Audiencia declarada: ${opts.audience}.

${RUBRIC}

Responde SOLO JSON:
{
  "breakdown": { ... },
  "score": number,
  "issues": [{ "severity": ..., "message": ..., "recommendation": ... }],
  "fixes": [{ "target": "<nodeId|edgeId|groups[0]>", "change": "<instrucción quirúrgica>" }]
}`;
}

export interface ExecutivePrompt {
    projectDescription: string;
    ir: unknown;
}

export function buildExecutiveNarrativePrompt(opts: ExecutivePrompt): string {
    return `Transforma el siguiente DiagramIR en una narrativa de 120 palabras para un comité ejecutivo.
No uses jerga técnica. No menciones herramientas específicas. Habla de valor, riesgo y evolución.
Entrega JSON { "title": string, "narrative": string, "callouts": string[] } donde callouts son máximo 3 frases de una línea.

Contexto del proyecto: ${opts.projectDescription}
Diagrama:
${JSON.stringify(opts.ir, null, 2)}
`;
}

export interface AutoFixPrompt {
    mermaid: string;
    error: string;
}

export function buildAutoFixPrompt(opts: AutoFixPrompt): string {
    return `El siguiente código Mermaid falló al renderizar con el error: "${opts.error}".
Corrige EL MÍNIMO número de líneas necesarias. Mantén la semántica original.
Devuelve SOLO el Mermaid corregido, sin comentarios, sin markdown, sin explicaciones.

\`\`\`mermaid
${opts.mermaid}
\`\`\``;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM INSTRUCTION & GENERATION CONFIG (Gemini 2.5+, cacheable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * System instruction that travels in **every** diagram-related Gemini call.
 *
 * Why a system instruction (and not concatenated to the prompt)?
 *  1. Implicit caching: Gemini 2.5 caches identical leading content across
 *     requests for free, cutting input cost up to ~75% on repeated standards.
 *  2. Reusability: every diagram (C4, sequence, ERD, flow…) shares the same
 *     architectural rubric, role taxonomy and quality gate.
 *  3. Less prompt drift: callers stop duplicating ~600 tokens of standards.
 *
 * Keep this string **stable** across calls — every byte change invalidates
 * the implicit cache.
 */
export const DIAGRAM_SYSTEM_INSTRUCTION = `You are the Principal Software Architect of Arky 10.

Your role: produce world-class architecture diagrams that are visually clean, narratively rich and cognitively light. Every diagram you emit is reviewed against the 10-dimension Arky rubric below.

────────────────────────────────────────────────────────────────────
SEMANTIC ROLE TAXONOMY (use exactly these for the "kind" field)
────────────────────────────────────────────────────────────────────
person     — humans, actors, customers, operators
system     — software systems / bounded contexts (C4 L1/L2)
gateway    — API gateways, BFF, ingress, load balancers
data       — databases, caches, lakes, warehouses, file stores
messaging  — queues, topics, brokers, event buses, streams
external   — third-party SaaS / partner clouds out of scope to operate
service    — internal microservices, workers, lambdas, modules
process    — orchestrations, batch jobs, workflows, pipelines
generic    — only when none of the above truly fits

Never invent colours, sizes or stroke widths: those come from the renderer's
design tokens. Your output describes structure and meaning only.

────────────────────────────────────────────────────────────────────
ARKY 10-DIMENSION RUBRIC (0-10 each, 0-100 weighted)
────────────────────────────────────────────────────────────────────
1. claridadSemantica         — every node has an unambiguous role.
2. consistenciaArquitectonica — respects C4/SDD/UML conventions.
3. jerarquiaVisual           — grouping & order guide the reader's eye.
4. legibilidad               — labels short (≤24 chars), no jargon.
5. narrativa                 — edge labels are actionable verbs.
6. atractivoVisual           — clean, semantic, no clutter.
7. preparacionEjecutiva      — a C-level grasps it in 60 seconds.
8. preparacionTecnica        — an architect can implement it.
9. exportabilidad            — survives PNG / Lucid export with no context.
10. mantenibilidadPipeline   — easy to regenerate / edit.

────────────────────────────────────────────────────────────────────
HARD RULES (apply to every artifact)
────────────────────────────────────────────────────────────────────
• Every edge MUST carry an actionable verb label with an explicit protocol/channel
  ("Autentica · HTTPS", "Consulta catálogo · REST/HTTPS", "Publica evento · Kafka"). Avoid generic nouns like "data" / "call".
• Node labels ≤ 24 characters when possible; expand acronyms on first use.
• Group / boundary blocks are mandatory when there are ≥ 5 nodes.
• Audience-aware sizing:
    – executive  : 4–8 nodes, no jargon, business verbs only.
    – technical  : 8–24 nodes, protocol/channel details on every edge and technology hints on platform nodes.
    – operations : 6–18 nodes, surface queues, retries, schedules.
• Use deterministic, kebab/snake-cased ids — never timestamps or UUIDs.
• If the input is genuinely insufficient, emit ONLY {"error":"<reason>"}.

Output exactly the format requested by the user prompt. Do not wrap in
markdown fences. Do not add prose, headings or commentary outside the
requested envelope.`;

/**
 * Per-artifact-type guidance that complements the system instruction.
 * Kept very short on purpose — the system instruction holds the standards;
 * this string only carries the dialect-specific constraints.
 *
 * Returning an empty string when there is no extra guidance lets callers
 * append it unconditionally without producing trailing whitespace.
 */
export function buildDialectInstruction(type: ArtifactType): string {
    if (type.startsWith('mermaid-c4-')) {
        return `Mermaid dialect: C4 (Person/System/Container/Component/Deployment + Boundaries). Every Container/Component MUST declare its technology stack as the 3rd argument. Every Rel() MUST include the protocol as the 4th argument.`;
    }
    if (type === 'mermaid-sequence') {
        return `Mermaid dialect: sequenceDiagram. Declare every participant up-front; use "->>" for sync, "-)" for async, "rect rgb(...)" to group, alt/opt/loop for conditional flows.`;
    }
    if (type === 'mermaid-state') {
        return `Mermaid dialect: stateDiagram-v2. Use [*] for initial/final, <<choice>> for decisions, composite states for nesting.`;
    }
    if (type === 'mermaid-erd') {
        return `Mermaid dialect: erDiagram. Always declare PK/FK/UK; use proper cardinality notation; label every relationship with a verb.`;
    }
    if (type === 'mermaid-graph') {
        return `Mermaid dialect: flowchart. Use shapes semantically: [Rectangle] services, [(Cylinder)] data, {Diamond} decisions, ((Circle)) actors. Apply classDef + class for semantic colour.`;
    }
    if (type === 'mermaid-gantt') {
        return `Mermaid dialect: gantt. Group tasks in section blocks; mark crit/active/milestone; include realistic durations and dependencies.`;
    }
    if (type === 'react-flow-graph') {
        return `Output dialect: ReactFlow JSON ({nodes,edges}). Use type='custom' for every node; data.label / data.type / data.description are mandatory.`;
    }
    if (type === 'hybrid-text-diagram') {
        return `Hybrid output: Markdown narrative + EXACTLY ONE \`\`\`mermaid\`\`\` fenced diagram. Diagram comes after the executive summary.`;
    }
    return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// DiagramIR JSON Schema (responseSchema for structured output)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider-neutral response schema describing the canonical DiagramIR.
 *
 * Notes:
 *  - Written in the neutral `AIJsonSchema` dialect (standard JSON Schema). Each
 *    provider translates it at its own boundary, so this file no longer has to
 *    be handed a vendor's type enum to describe a shape.
 *  - Enums are *narrow*: relations, shapes, audiences and severities are all
 *    declared so the model cannot drift outside the renderer's vocabulary.
 *  - The shape mirrors `services/diagram/index.ts::reactFlowJsonToIR` so the
 *    output drops in directly into `irToReactFlow` / `irToMermaid` without an
 *    intermediate Mermaid hop (eliminates the "Mermaid hallucination" failure
 *    mode entirely).
 */
export interface DiagramIRSchemaOptions {
    /** When true, requires a self-review block. */
    withReview?: boolean;
}

export function buildDiagramIRSchema(opts: DiagramIRSchemaOptions = {}): unknown {
    const { withReview = true } = opts;
    const node = {
        type: 'object',
        properties: {
            id:           { type: 'string' },
            label:        { type: 'string' },
            kind:         { type: 'string', enum: ['person', 'system', 'gateway', 'data', 'messaging', 'external', 'service', 'process', 'generic'] },
            // Rich semantic type — the renderer maps it to the badge text and
            // legend rows. Enum mirrors `DiagramIRNode.semanticType`.
            semanticType: {
                type: 'string',
                enum: [
                    'human-actor', 'business-role',
                    'internal-system', 'external-system', 'legacy-system', 'application',
                    'portal', 'api', 'service', 'microservice', 'component', 'c4-container',
                    'database', 'document-repository',
                    'integration-platform', 'messaging', 'cloud-service',
                    'security-service', 'notification-service', 'rules-engine',
                    'business-process', 'external-provider', 'digital-channel',
                    'batch-file', 'report', 'dashboard', 'data-product', 'analytics-system',
                    'generic',
                ],
            },
            description: { type: 'string' },
            technology:  { type: 'string' },
            group:       { type: 'string' },
            shape:       { type: 'string', enum: ['rectangle', 'cylinder', 'hexagon', 'cloud', 'person', 'diamond', 'tab-box'] },
            // Gap 6: extended governance / domain metadata mirrored from
            // types.ts so IR-direct generations can express ownership,
            // compliance, trust and audience-facing meaning.
            owner:              { type: 'string' },
            domain:             { type: 'string' },
            dataClassification: { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci'] },
            securityLevel:      { type: 'string', enum: ['none', 'standard', 'elevated', 'critical'] },
            compliance:         { type: 'array', items: { type: 'string' } },
            criticality:        { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            trust:              { type: 'string', enum: ['internal', 'partner', 'external', 'public'] },
            businessMeaning:    { type: 'string' },
            technicalMeaning:   { type: 'string' },
        },
        required: ['id', 'label', 'kind'],
    } as const;
    const edge = {
        type: 'object',
        properties: {
            id:            { type: 'string' },
            source:        { type: 'string' },
            target:        { type: 'string' },
            label:         { type: 'string' },
            relation:      { type: 'string', enum: ['sync', 'async', 'data-flow', 'dependency', 'inheritance', 'default'] },
            semanticType:  {
                type: 'string',
                enum: [
                    'rest-api', 'soap', 'graphql', 'event', 'async-messaging',
                    'batch', 'file-transfer', 'query', 'publish', 'subscribe',
                    'authentication', 'authorization', 'notification', 'data-transfer',
                    'synchronization', 'orchestration', 'composition', 'dependency',
                    'business-flow', 'data-flow', 'control-flow', 'generic',
                ],
            },
            protocol:        { type: 'string' },
            direction:       { type: 'string', enum: ['unidirectional', 'bidirectional'] },
            criticality:     { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            // Gap 6: extended sensitivity vocabulary (PHI/PCI/PII) so
            // insurance / healthcare diagrams can express regulated flows.
            dataSensitivity: { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci'] },
            retryPolicy:     { type: 'string' },
            frequency:       { type: 'string', enum: ['real-time', 'near-real-time', 'batch', 'on-demand', 'periodic'] },
            synchrony:       { type: 'string', enum: ['sync', 'async', 'fire-and-forget', 'request-reply'] },
            security:        { type: 'string' },
            payload:         { type: 'string' },
            trust:           { type: 'string', enum: ['internal', 'partner', 'external', 'public'] },
            businessMeaning:  { type: 'string' },
            technicalMeaning: { type: 'string' },
            observability:    { type: 'string' },
            sla:              { type: 'string' },
            errorHandling:    { type: 'string' },
        },
        required: ['id', 'source', 'target', 'label'],
    } as const;
    const group = {
        type: 'object',
        properties: {
            id:      { type: 'string' },
            label:   { type: 'string' },
            nodeIds: { type: 'array', items: { type: 'string' } },
            // Gap 6 + 7: group-level semantics so boundaries, swimlanes
            // and bounded-contexts round-trip without metadata loss.
            kind:         { type: 'string', enum: ['swimlane', 'system-boundary', 'enterprise', 'security', 'external-provider', 'data', 'cloud', 'legacy', 'integration', 'cluster'] },
            purpose:      { type: 'string' },
            boundaryType: { type: 'string', enum: ['trust', 'network', 'data', 'organizational', 'process', 'compliance'] },
            owner:        { type: 'string' },
            trust:        { type: 'string', enum: ['internal', 'partner', 'external', 'public'] },
        },
        required: ['id', 'label', 'nodeIds'],
    } as const;
    const metadata = METADATA_SCHEMA;
    const review = {
        type: 'object',
        properties: {
            score: { type: 'number' },
            breakdown: {
                type: 'object',
                properties: {
                    claridadSemantica:         { type: 'number' },
                    consistenciaArquitectonica:{ type: 'number' },
                    jerarquiaVisual:           { type: 'number' },
                    legibilidad:               { type: 'number' },
                    narrativa:                 { type: 'number' },
                    atractivoVisual:           { type: 'number' },
                    preparacionEjecutiva:      { type: 'number' },
                    preparacionTecnica:        { type: 'number' },
                    exportabilidad:            { type: 'number' },
                    mantenibilidadPipeline:    { type: 'number' },
                },
            },
            issues: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        severity:       { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                        message:        { type: 'string' },
                        recommendation: { type: 'string' },
                    },
                    required: ['severity', 'message'],
                },
            },
        },
    } as const;

    const properties: Record<string, unknown> = {
        nodes:  { type: 'array', items: node },
        edges:  { type: 'array', items: edge },
        groups: { type: 'array', items: group },
        metadata,
    };
    if (withReview) properties.review = review;

    return {
        type: 'object',
        properties,
        required: ['nodes', 'edges'],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// IR-direct generation prompt (replaces Mermaid hallucinations end-to-end)
// ─────────────────────────────────────────────────────────────────────────────

export interface IRDirectGenerateOptions {
    artifact: Artifact;
    project: Project;
    audience: DiagramAudience;
    settings: Settings;
    /** Optional previous IR to evolve from instead of regenerating from scratch. */
    previousIR?: unknown;
}

/**
 * Compact prompt that asks Gemini to emit a DiagramIR directly. The 10D rubric
 * and role taxonomy live in the system instruction, so this prompt only
 * carries the ARTEFACT-SPECIFIC delta — keeping per-call tokens minimal and
 * letting implicit caching subsidise the standards.
 */
export function buildIRDirectGenerationPrompt(opts: IRDirectGenerateOptions): string {
    const { artifact, project, audience, previousIR } = opts;
    const evolveBlock = previousIR
        ? `\n\nPrevious IR (evolve, do not regenerate from scratch):\n${JSON.stringify(previousIR, null, 2)}`
        : '';
    // Surface deterministically-extracted signals (actors / systems /
    // integrations / data / messaging / processes) so the model anchors the
    // diagram in real project signals instead of generic placeholders.
    const signalsBlock = renderDiagramSignals(extractDiagramSignals(project), artifact.type);
    return `${buildProjectContextBlock(project, artifact)}${signalsBlock}

Artifact: ${artifact.name} — ${artifact.type}
Objective: ${artifact.objective ?? ''}
Audience: ${audience.toUpperCase()}

${buildAudienceNarrativeDirective(audience)}

${buildArchitecturalConstraints(artifact.type)}

EXTENDED METADATA — populate when evidence exists, never fabricate:
- Node-level: owner, domain, dataClassification (use PHI/PII/PCI when the
  project clearly handles those), securityLevel, compliance array
  (HIPAA, GDPR, PCI-DSS, SOX, ISO 27001…), criticality, trust zone
  (internal | partner | external | public), businessMeaning,
  technicalMeaning.
- Edge-level: frequency, synchrony, security (mTLS, JWT, OAuth…),
  payload (FHIR Bundle, X12 837, JSON, NCPDP D.0…), sla, observability,
  errorHandling, dataSensitivity (PHI / PII / PCI for regulated flows),
  trust zone hop.
- Group-level: kind (swimlane / system-boundary / enterprise / security /
  external-provider / data / cloud / legacy / integration / cluster),
  purpose, boundaryType, owner, trust.
- metadata.diagramType MUST be set to the most specific archetype that
  matches the artefact intent (c4-context, c4-container, c4-component,
  c4-deployment, integration, bpmn-process, value-stream, data-flow,
  deployment, sequence, erd, generic).

If the evidence does not support a field, omit it instead of guessing.

${STORY_INSTRUCTIONS}

Emit the artifact as a DiagramIR JSON object obeying the schema you have been given. Do NOT emit Mermaid; the renderer is deterministic.
Apply the audience sizing rules from the system instruction.${evolveBlock}`;
}

export interface CorrectiveDiagramPromptOptions {
    artifact: Artifact;
    project: Project;
    audience: DiagramAudience;
    /** Reason for the previous failure, used verbatim to brief the model. */
    lastFailureReason: string;
    /** Optional excerpt of the previous (invalid) response. */
    previousResponseSample?: string;
}

/**
 * Compact corrective prompt used as the second self-healing attempt. It cuts
 * the project context to 6 items, drops the glossary, and explicitly tells
 * the model what failed so it does not repeat the mistake.
 */
export function buildCorrectiveDiagramPrompt(opts: CorrectiveDiagramPromptOptions): string {
    const { artifact, project, audience, lastFailureReason, previousResponseSample } = opts;
    const sampleBlock = previousResponseSample
        ? `\n\nExcerpt of your previous (invalid) response:\n"""\n${previousResponseSample.slice(0, 240)}\n"""`
        : '';
    const signalsBlock = renderDiagramSignals(extractDiagramSignals(project), artifact.type);
    return `${buildProjectContextBlock(project, artifact, { maxContextItems: 6, maxKeyConcepts: 0, maxDescriptionChars: 400 })}${signalsBlock}

CORRECTIVE RETRY — your previous response failed: ${lastFailureReason}.
Emit ONLY a valid DiagramIR JSON object. No prose, no Mermaid, no Markdown fences.
Required: at least 4 nodes, at most 12. Every node MUST have id, label, kind.
Every edge MUST have id, source, target, label.
Use the PRE-PROCESSED DIAGRAM SIGNALS above as the spine of the diagram — they were extracted from the actual project context.

Artifact: ${artifact.name} — ${artifact.type}
Objective: ${artifact.objective ?? ''}
Audience: ${audience.toUpperCase()}

${buildArchitecturalConstraints(artifact.type)}${sampleBlock}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic skeleton fallback (used after AI retries are exhausted)
// ─────────────────────────────────────────────────────────────────────────────

interface SkeletonHints {
    primaryName: string;
    secondaryNames: string[];
}

function pickSkeletonHints(artifact: Artifact, project: Project): SkeletonHints {
    const concepts = (artifact.keyConcepts ?? []).map((c) => (c?.term ?? '').trim()).filter(Boolean);
    const primaryName = (project.name && project.name.trim()) || (concepts[0] ?? 'Sistema Principal');
    const secondaryNames = concepts.length >= 2 ? concepts.slice(0, 6) : ['Componente A', 'Componente B', 'Componente C'];
    return { primaryName, secondaryNames };
}

function makeNode(id: string, label: string, kind: string, technology?: string, description?: string): DiagramIR['nodes'][number] {
    return { id, label, kind, technology, description };
}

/**
 * Builds a deterministic minimal IR from `artifact.keyConcepts` + dialect
 * when AI generation is exhausted. The IR is valid, renderable, and marked
 * with `metadata.fallback = 'skeleton'` so the renderer can show a "Esqueleto
 * base — edítame" badge and the quality service caps the score.
 */
export function buildSkeletonIRFromArtifact(artifact: Artifact, project: Project): DiagramIR {
    const { primaryName, secondaryNames } = pickSkeletonHints(artifact, project);
    const now = new Date().toISOString();
    const baseMetadata = {
        sourceFormat: 'mermaid' as const,
        generatedAt: now,
        title: `${artifact.name} (esqueleto base)`,
        fallback: 'skeleton' as const,
        degradationReason: 'AI retries exhausted; deterministic skeleton emitted as fallback.',
    };

    const type = artifact.type;
    if (type === 'mermaid-c4-context') {
        const ext = secondaryNames.slice(0, 3);
        return {
            nodes: [
                makeNode('user', 'Usuario / Asegurado', 'Person', undefined, 'Usuario principal del sistema.'),
                makeNode('system', primaryName, 'System', undefined, 'Sistema en scope.'),
                ...ext.map((name, i) => makeNode(`ext${i + 1}`, name, 'ExternalSystem', undefined, 'Sistema externo.')),
            ],
            edges: [
                { id: 'e-user-sys', source: 'user', target: 'system', label: 'Usa', relation: 'sync' },
                ...ext.map((_, i) => ({
                    id: `e-sys-ext${i + 1}`,
                    source: 'system',
                    target: `ext${i + 1}`,
                    label: 'Integra con',
                    relation: 'sync' as const,
                })),
            ],
            groups: [],
            metadata: baseMetadata,
        };
    }

    if (type === 'mermaid-c4-container') {
        const containers = secondaryNames.slice(0, 4).length >= 2
            ? secondaryNames.slice(0, 4)
            : ['Web App', 'API', 'Base de Datos', 'Cola de Eventos'];
        return {
            nodes: [
                makeNode('user', 'Usuario', 'Person'),
                ...containers.map((name, i) => makeNode(`c${i + 1}`, name, i === containers.length - 1 ? 'ContainerDb' : 'Container', i === 0 ? 'Web' : 'TBD')),
            ],
            edges: [
                { id: 'e-user-c1', source: 'user', target: 'c1', label: 'Usa', relation: 'sync' },
                ...containers.slice(0, -1).map((_, i) => ({
                    id: `e-c${i + 1}-c${i + 2}`,
                    source: `c${i + 1}`,
                    target: `c${i + 2}`,
                    label: 'Llama',
                    relation: 'sync' as const,
                })),
            ],
            groups: [{ id: 'sys', label: primaryName, nodeIds: containers.map((_, i) => `c${i + 1}`) }],
            metadata: baseMetadata,
        };
    }

    if (type === 'mermaid-c4-component') {
        const components = secondaryNames.slice(0, 5).length >= 2
            ? secondaryNames.slice(0, 5)
            : ['Controller', 'Service', 'Repository', 'Validator', 'Adapter'];
        return {
            nodes: components.map((name, i) => makeNode(`comp${i + 1}`, name, 'Component')),
            edges: components.slice(0, -1).map((_, i) => ({
                id: `e-comp${i + 1}-comp${i + 2}`,
                source: `comp${i + 1}`,
                target: `comp${i + 2}`,
                label: 'Invoca',
                relation: 'sync' as const,
            })),
            groups: [{ id: 'container', label: primaryName, nodeIds: components.map((_, i) => `comp${i + 1}`) }],
            metadata: baseMetadata,
        };
    }

    if (type === 'mermaid-c4-deployment') {
        return {
            nodes: [
                makeNode('cloud', 'Nube (Producción)', 'DeploymentNode'),
                makeNode('app', primaryName, 'Container', 'TBD'),
                makeNode('db', 'Base de Datos', 'ContainerDb', 'PostgreSQL'),
            ],
            edges: [
                { id: 'e-app-db', source: 'app', target: 'db', label: 'JDBC', relation: 'sync' },
            ],
            groups: [{ id: 'env', label: 'Ambiente productivo', nodeIds: ['app', 'db'] }],
            metadata: baseMetadata,
        };
    }

    // Generic fallback (flowcharts, integration, ER, etc.)
    const nodes = [makeNode('center', primaryName, 'Process')].concat(
        secondaryNames.slice(0, 4).map((name, i) => makeNode(`n${i + 1}`, name, 'Component')),
    );
    const edges = nodes.slice(1).map((n, i) => ({
        id: `e-center-${i + 1}`,
        source: 'center',
        target: n.id,
        label: 'Relaciona',
        relation: 'default' as const,
    }));
    return { nodes, edges, groups: [], metadata: baseMetadata };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enriched project context blocks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compact, well-structured context block that surfaces every project-level
 * signal the model needs to ground the diagram in reality:
 *
 *  - `project.description`  — the elevator pitch.
 *  - `project.projectContext` — bulleted free-text constraints supplied by the
 *    user (e.g. "Multi-tenant SaaS", "On-prem only", "Fintech, PCI-DSS").
 *  - `artifact.keyConcepts` — domain glossary so the model uses the
 *    ubiquitous language already established for the project.
 *
 * Prior versions only injected `project.description`, leaving the model blind
 * to the constraints that distinguish a generic e-commerce diagram from one
 * that respects the user's regulated environment.
 */
/**
 * Architecture / regulation / technology keywords that boost an item's
 * priority when the project context exceeds the cap. The list is curated for
 * the most common signals in the Spanish guided-creation flow; extend it
 * carefully — every new term inflates the regex and lowers selectivity.
 */
const CONTEXT_KEYWORD_BOOST = /\b(tecnolog|stack|kafka|postgres|mysql|mongo|redis|aws|azure|gcp|kubernetes|docker|saas|hipaa|pci|sox|gdpr|on-?prem|cloud|microservic|monolit|integra|api|escala|tenant|legacy|cumplimiento|regulator|seguridad|sla|latencia|throughput|disponibilidad|backup|recovery|frontend|backend|gateway|queue|event|streaming|data\s*warehouse|etl|lakehouse|graphql|rest|grpc)\b/i;

interface ScoredItem {
    item: string;
    index: number;
    score: number;
}

/**
 * Heuristic: prioritise the project-context bullets most likely to ground
 * the diagram in real architectural signals. Used to avoid drowning the
 * model in 50+ "ok / sí / gracias" echoes from the guided-creation chat.
 *
 *  - Recency weight: later items get a larger bonus (the asistente collects
 *    decisions late in the conversation).
 *  - Keyword boost: items mentioning architecture / regulation / tech terms
 *    win two extra points.
 *  - Length sanity: items shorter than 12 chars are likely UI noise and lose
 *    one point.
 *
 * The selection is taken by score desc, then re-sorted by original index so
 * the prompt preserves the narrative ordering the user wrote.
 */
export function prioritizeProjectContext(rawItems: readonly string[], opts: { limit: number }): string[] {
    const cleaned: ScoredItem[] = [];
    rawItems.forEach((raw, idx) => {
        const item = (raw ?? '').trim();
        if (!item) return;
        const recencyWeight = idx / Math.max(1, rawItems.length - 1); // 0..1
        const keywordBoost = CONTEXT_KEYWORD_BOOST.test(item) ? 2 : 0;
        const lengthSanity = item.length < 12 ? -1 : 0;
        cleaned.push({ item, index: idx, score: recencyWeight + keywordBoost + lengthSanity });
    });

    if (cleaned.length <= opts.limit) {
        return cleaned.sort((a, b) => a.index - b.index).map((c) => c.item);
    }

    const top = [...cleaned]
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .slice(0, opts.limit)
        .sort((a, b) => a.index - b.index);
    return top.map((c) => c.item);
}

export interface ProjectContextBlockOptions {
    /** Cap for projectContext bullets. Defaults to 12. */
    maxContextItems?: number;
    /** Cap for keyConcepts glossary. Defaults to 10. */
    maxKeyConcepts?: number;
    /** Cap (chars) for the description line. Defaults to 800. */
    maxDescriptionChars?: number;
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max).trimEnd()}…`;
}

export function buildProjectContextBlock(
    project: Project,
    artifact?: Artifact,
    opts: ProjectContextBlockOptions = {},
): string {
    const maxContextItems = opts.maxContextItems ?? 12;
    const maxKeyConcepts = opts.maxKeyConcepts ?? 10;
    const maxDescriptionChars = opts.maxDescriptionChars ?? 800;

    const lines: string[] = [];
    lines.push('PROJECT CONTEXT');
    lines.push(`- Name: ${project.name ?? '(unnamed)'}`);
    if (project.description?.trim()) {
        lines.push(`- Description: ${truncate(project.description.trim(), maxDescriptionChars)}`);
    }
    if (Array.isArray(project.projectContext) && project.projectContext.length) {
        const items = prioritizeProjectContext(project.projectContext, { limit: maxContextItems });
        if (items.length) {
            lines.push(`- Constraints / context:`);
            for (const item of items) lines.push(`    • ${item}`);
        }
    }
    if (artifact?.keyConcepts?.length) {
        const glossary = artifact.keyConcepts
            .filter((c) => c?.term)
            .slice(0, maxKeyConcepts)
            .map((c) => `${c.term}: ${(c.definition ?? '').trim()}`);
        if (glossary.length) {
            lines.push(`- Ubiquitous language (use these terms verbatim where applicable):`);
            for (const item of glossary) lines.push(`    • ${item}`);
        }
    }
    return lines.join('\n');
}

/**
 * Audience-specific narrative directives.  These shape *what story* the
 * diagram tells, not its size (sizing is enforced by HARD RULES in the system
 * instruction).
 */
export function buildAudienceNarrativeDirective(audience: DiagramAudience): string {
    if (audience === 'executive') {
        return `NARRATIVE DIRECTIVE — EXECUTIVE
Tell a value story.  Each edge label must answer "what business outcome flows
through here?" (e.g. "Cobra al cliente", "Confirma reserva", "Notifica al
auditor").  Avoid technology names, protocols and acronyms.  Group the diagram
by capability or business domain rather than by tier.  Highlight the single
node that creates the most value to the customer.`;
    }
    if (audience === 'operations') {
        return `NARRATIVE DIRECTIVE — OPERATIONS
Tell a runtime story.  Surface every queue, retry policy, schedule, timer and
fail-over path.  Edge labels must include cadence or trigger when relevant
("Cada 5 min", "On failure: DLQ", "RPS pico 2k").  Mark async edges with the
"async" relation explicitly.  Use \`messaging\` kind for anything resembling a
broker.`;
    }
    return `NARRATIVE DIRECTIVE — TECHNICAL
Tell an implementation story.  Edge labels must include the protocol or call
contract ("HTTPS/JSON", "gRPC", "JDBC", "Kafka topic"), and node descriptions
must surface the technology stack ("Java 21, Spring Boot 3.3").  Show
dependency direction explicitly via the \`dependency\` relation when
inheritance/composition matter.`;
}

/**
 * Architectural guardrails injected per artifact dialect.  These describe
 * what the model MUST NOT produce, complementing the dialect instruction
 * which describes what it MUST produce.  Keeping them per-type means we can
 * teach the model layer-violation patterns specific to C4, ERD, sequence,
 * etc.
 */
export function buildArchitecturalConstraints(type: ArtifactType): string {
    if (type === 'mermaid-c4-context') {
        return `ARCHITECTURAL GUARDRAILS — C4 CONTEXT (L1)
- Show ONLY actors, the system in scope and EXTERNAL systems (≤ 8 nodes).
- Do NOT model internal containers / components / databases here — those
  belong in C4 L2/L3.
- Every Rel() MUST express either business value or protocol on the label
  ("Cobra suscripción", "Notifica vía Webhook").
- Use Person()/Person_Ext() for humans, System()/System_Ext() for systems.
- Boundaries (Enterprise/System_Boundary) are mandatory when grouping ≥3
  external systems.`;
    }
    if (type === 'mermaid-c4-container') {
        return `ARCHITECTURAL GUARDRAILS — C4 CONTAINER (L2)
- Model applications, APIs, databases, queues, services and external systems.
- Every Container/ContainerDb/ContainerQueue MUST declare its TECHNOLOGY as
  the 3rd argument ("Spring Boot 3", "PostgreSQL 15", "Kafka 3.6").
- Every Rel() MUST include the protocol or wire format as the 4th argument
  ("HTTPS/JSON", "JDBC", "AMQP").
- A UI/Container MUST NOT connect directly to a ContainerDb unless that DB is
  embedded in the same container.  Always route via a service container.
- Group containers by bounded context using System_Boundary blocks.`;
    }
    if (type === 'mermaid-c4-component') {
        return `ARCHITECTURAL GUARDRAILS — C4 COMPONENT (L3)
- Model only the components inside ONE container; do NOT cross containers.
- Each Component MUST declare a single, clear responsibility in its
  description ("Authenticates token + roles", "Persists order aggregate").
- Component contracts (inbound/outbound) MUST appear as labelled Rel().
- Avoid generic "Helper" / "Util" components; if you need them, justify the
  responsibility in the description.`;
    }
    if (type === 'mermaid-c4-deployment') {
        return `ARCHITECTURAL GUARDRAILS — C4 DEPLOYMENT
- Use Deployment_Node()/Node() to represent environment, region, network and
  runtime nodes; nest them to express topology.
- Each node MUST declare its TECHNOLOGY (e.g. "AWS, eu-west-1", "Kubernetes
  1.29", "Linux 6.6").
- Differentiate cloud vs on-premise vs network/security boundary explicitly.
- Container_Instance() MUST reference a real container declared elsewhere.
- Show external dependencies (DNS, identity provider, payment gateway) as
  System_Ext() at the edges of the topology.`;
    }
    if (type === 'mermaid-sequence') {
        return `ARCHITECTURAL GUARDRAILS — SEQUENCE
- Declare every participant up-front before any message.
- Every interaction MUST flow chronologically (top→bottom in messages).
- Async messages MUST use the "async" relation ("-)" / "--)"); sync the "sync"
  relation ("->>" / "-->>").
- Avoid orphan participants — every declared participant must send or receive
  at least one message.
- Group related messages with rect/alt/loop blocks when ≥6 messages exist or
  when an exception/decision branches the flow.
- Each message label MUST start with a verb ("Solicita", "Valida", "Devuelve").`;
    }
    if (type === 'mermaid-erd') {
        return `ARCHITECTURAL GUARDRAILS — ERD / DOMAIN MODEL
- Use business-friendly entity names (Spanish allowed) — never raw table
  names with prefixes ("tbl_user").
- Every entity MUST declare PK; FK fields MUST point to a declared entity.
- Cardinality MUST be explicit (one-to-many / many-to-many) using
  ||--o{ / }o--o{ syntax.
- Orphan entities (no relationship to any other) are FORBIDDEN unless they
  represent a true root aggregate (mark with \`status: "active"\` and explain
  in description).
- Label every relationship with a verb that reads naturally ("Cliente PLACES
  Orden", "Orden CONTAINS Linea").`;
    }
    if (type === 'mermaid-state') {
        return `ARCHITECTURAL GUARDRAILS — STATE MACHINE
- An initial state ([*]) MUST exist; at least one terminal state recommended.
- Every state MUST be reachable from the initial state.
- Avoid dead-ends (non-terminal states with no outgoing transition).
- Each transition label MUST express the EVENT/TRIGGER, not the next state
  ("Pago confirmado", "Timeout 5 min", "Usuario cancela").
- Use <<choice>> / <<fork>> / <<join>> pseudo-states for decisions and
  parallel splits.`;
    }
    if (type === 'mermaid-gantt') {
        return `ARCHITECTURAL GUARDRAILS — GANTT
- Group tasks under \`section\` blocks named after capabilities or phases.
- Mark milestones with \`milestone\` and critical-path items with \`crit\`.
- Realistic durations only (avoid generic 1d everywhere).
- Express task dependencies via \`after task-id\`; do NOT chain everything
  serially when work can run in parallel.`;
    }
    if (type === 'mermaid-graph') {
        return `ARCHITECTURAL GUARDRAILS — FLOW / VALUE STREAM / BPMN
- Avoid cycles unless they represent intentional retry/feedback loops; mark
  those edges with the "async" relation and a "Reintenta" verb.
- Every node MUST have at least one inbound or outbound edge (no orphans).
- Edges MUST carry a verb-driven label.  Replace generic "data"/"call" with a
  domain verb ("Valida pago", "Sincroniza catálogo", "Notifica auditor").
- For Value Stream Maps: include lead time, process time and wait time as
  edge labels or node descriptions ("LT 3d", "PT 12h", "Wait 2d") and mark
  improvement opportunities with status "warning" or "error".
- For BPMN-style flows: differentiate actors via subgraphs (swimlanes), use
  diamond nodes for gateways/decisions and circle/cloud nodes for events.`;
    }
    if (type === 'react-flow-graph' || type === 'hybrid-text-diagram') {
        return `ARCHITECTURAL GUARDRAILS — FLOW
- Avoid cycles unless they represent intentional retry/feedback loops; mark
  those edges with the "async" relation and a "Reintenta" verb.
- Every node MUST have at least one inbound or outbound edge (no orphans).
- Edges MUST carry a verb-driven label.  Replace generic "data"/"call" with a
  domain verb ("Valida pago", "Sincroniza catálogo").`;
    }
    return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-pass refinement: critique + refine prompts
// ─────────────────────────────────────────────────────────────────────────────

export interface IRCritiqueOptions {
    ir: DiagramIR;
    artifact: Pick<Artifact, 'name' | 'type' | 'objective'>;
    audience: DiagramAudience;
    /** Optional pre-computed local issues (from `analyzeDiagramQuality`). */
    detectedIssues?: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string; recommendation?: string }>;
    /** Optional architectural violations from the guardrails module. */
    architecturalViolations?: Array<{ code: string; severity: 'critical' | 'high' | 'medium' | 'low'; message: string; targetIds?: string[] }>;
}

/**
 * Asks the model to act as a senior reviewer and emit a structured critique
 * of an existing IR.  The critique is then fed back into
 * `buildIRRefinePrompt` so the model produces an improved IR instead of a
 * narrative response.
 *
 * Critically, this prompt **includes** any local issues already detected by
 * the deterministic quality service so the model is explicitly aware of them
 * — closing the gap where the model would otherwise re-introduce the same
 * problem.
 */
export function buildIRCritiquePrompt(opts: IRCritiqueOptions): string {
    const { ir, artifact, audience, detectedIssues = [], architecturalViolations = [] } = opts;
    const issueLines = detectedIssues.length
        ? detectedIssues
            .slice(0, 12)
            .map((i) => `- [${i.severity}] ${i.message}${i.recommendation ? ` → ${i.recommendation}` : ''}`)
            .join('\n')
        : '- (none detected by the static analyser)';
    const violationLines = architecturalViolations.length
        ? architecturalViolations
            .slice(0, 12)
            .map((v) => `- [${v.severity}] ${v.code}: ${v.message}${v.targetIds?.length ? ` (targets: ${v.targetIds.join(', ')})` : ''}`)
            .join('\n')
        : '- (no architectural violations detected)';

    return `You are reviewing a draft DiagramIR for "${artifact.name}" (${artifact.type}).
Audience: ${audience.toUpperCase()}.
Objective: ${artifact.objective ?? ''}.

Static analyser findings:
${issueLines}

Architectural guardrails findings:
${violationLines}

Apply the 10-dimension Arky rubric and emit a JSON critique.  Be surgical: only
propose fixes that materially raise the score.  Each fix MUST be expressible
as a structural change to the IR (relabel, regroup, add/remove edge, change
relation), not a narrative.

DiagramIR draft:
${JSON.stringify(ir, null, 2)}

Respond ONLY with this JSON shape (no prose):
{
  "score": number,
  "breakdown": { "claridadSemantica": number, "consistenciaArquitectonica": number, "jerarquiaVisual": number, "legibilidad": number, "narrativa": number, "atractivoVisual": number, "preparacionEjecutiva": number, "preparacionTecnica": number, "exportabilidad": number, "mantenibilidadPipeline": number },
  "issues": [{ "severity": "critical"|"high"|"medium"|"low", "message": string, "recommendation": string }],
  "fixes": [{ "target": "<nodeId|edgeId|group:<id>>", "change": "<surgical instruction>", "category": "label"|"relation"|"group"|"add-edge"|"remove-edge"|"add-node"|"remove-node" }]
}`;
}

export interface IRRefineOptions {
    ir: DiagramIR;
    critique: unknown;
    artifact: Pick<Artifact, 'name' | 'type' | 'objective'>;
    audience: DiagramAudience;
}

/**
 * Asks the model to apply a critique to a draft IR and return an improved IR.
 *
 * This is the second leg of multi-pass generation.  The critique is fed in
 * verbatim, the draft IR is shown, and the model is constrained to *only*
 * adjust what the critique flagged — preventing creative drift that would
 * otherwise re-roll the entire diagram and lose stable parts.
 */
export function buildIRRefinePrompt(opts: IRRefineOptions): string {
    const { ir, critique, artifact, audience } = opts;
    return `Refine this DiagramIR by applying the critique below.  Keep every
unchanged part stable: do not re-roll labels, kinds or ids that were not
flagged.  When applying a fix, prefer the smallest possible change.

Artifact: ${artifact.name} — ${artifact.type}
Audience: ${audience.toUpperCase()}.
Objective: ${artifact.objective ?? ''}.

Draft IR:
${JSON.stringify(ir, null, 2)}

Critique (apply every fix unless it would violate the rubric):
${typeof critique === 'string' ? critique : JSON.stringify(critique, null, 2)}

Emit the improved DiagramIR using the schema you have been given.  Include a
\`review\` block with the post-fix score.  Do NOT emit Mermaid.`;
}
