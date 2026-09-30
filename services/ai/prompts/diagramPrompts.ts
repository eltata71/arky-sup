/**
 * Canonical prompt library for diagram-related Gemini calls.
 *
 * The strings here are the refreshed 16.1–16.4 prompts from the April 2026
 * visual-pipeline audit.  They:
 *   - Ask Gemini to return DiagramIR JSON (not Mermaid) whenever possible.
 *   - Carry the 10-dimension quality rubric so the model can self-evaluate.
 *   - Leave colours to the design tokens.
 *   - Produce executive, technical and operations variants on demand.
 * The self-review `review` block and the builders that printed a second
 * schema are gone (plan de diagramas, 6.4): nothing read the first, and the
 * second described a shape the real schema did not.
 *
 * The prompts are grouped by intent; call sites import the builder they need.
 */

import type { ArtifactType, Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { DiagramAudience, DiagramIR } from '../../../lib/diagram';
import { extractDiagramSignals, renderDiagramSignals } from '../../diagram';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { METADATA_SCHEMA, STORY_INSTRUCTIONS } from './diagramStorySchema';
import { ARCHITECTURE_SIGNAL_PATTERN, renderDiagramContextBundle } from './artifactContext';

/**
 * Ten-dimension rubric the Mermaid prompts carry for self-review. It asked
 * for a scored breakdown in prompts that also said "deliver ONLY the code";
 * the model is now told to use it and not to print it (plan de diagramas, 6.4).
 */
export const RUBRIC = `Evalúa siempre el resultado en estas 10 dimensiones (0–10 cada una):
1. claridadSemantica — ¿cada nodo tiene un rol inequívoco?
2. consistenciaArquitectonica — ¿respeta el estándar C4/SDD elegido?
3. jerarquiaVisual — ¿hay agrupación / orden que guíe la lectura?
4. legibilidad — ¿labels cortos, sin jerga innecesaria?
5. narrativa — ¿las etiquetas en las aristas cuentan una historia?
6. atractivoVisual — ¿es limpio, con roles semánticos claros?
7. preparacionEjecutiva — ¿un C-level lo entiende en 60 s?
8. preparacionTecnica — ¿un arquitecto puede implementarlo?
9. exportabilidad — ¿funciona sin contexto extra en PNG/Lucid?
10. mantenibilidadPipeline — ¿es fácil de regenerar/editar?
Úsala para revisar tu propia salida antes de entregarla; no la incluyas en la respuesta.`;

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
        return `C4 as DiagramIR: the artifact type fixes the C4 level and the renderer writes the C4 notation; you describe elements and relations. Use "kind" from the taxonomy, the stack in "technology" for every service, data and messaging element, the protocol in "protocol" on every edge, and boundaries as "groups".`;
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
        return `Mermaid dialect: flowchart. Use shapes semantically: [Rectangle] services, [(Cylinder)] data, {Diamond} decisions, ((Circle)) actors. Declare roles with class names (service, database, queue, external…), never colour values.`;
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
export function buildDiagramIRSchema(): unknown {
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
    const properties: Record<string, unknown> = {
        nodes:  { type: 'array', items: node },
        edges:  { type: 'array', items: edge },
        groups: { type: 'array', items: group },
        metadata,
    };

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
    /** Request, language, motivation and upper level (`buildDiagramGenerationBrief`). */
    brief?: string;
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
    return `${buildProjectContextBlock(project, artifact, { settings: opts.settings })}${signalsBlock}${opts.brief ? `\n\n${opts.brief}` : ''}

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
    brief?: string;
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
    return `${buildProjectContextBlock(project, artifact, { maxContextItems: 6, maxKeyConcepts: 0, maxDescriptionChars: 400 })}${signalsBlock}${opts.brief ? `\n\n${opts.brief}` : ''}

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
    // Project names, never invented placeholders (6.3).
    const signals = extractDiagramSignals(project);
    const found = [...signals.systems, ...signals.integrations, ...signals.dataStores].map((s) => s.label);
    const secondaryNames = concepts.length >= 2 ? concepts.slice(0, 6) : [...new Set(found)].slice(0, 6);
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
        secondaryNames.length
            ? secondaryNames.slice(0, 4).map((name, i) => makeNode(`n${i + 1}`, name, 'Component'))
            : [makeNode('n1', 'Usuario', 'Person')],
    );
    const edges = nodes.slice(1).map((n, i) => ({
        id: `e-center-${i + 1}`,
        source: 'center',
        target: n.id,
        label: 'Relación por confirmar',
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
        const keywordBoost = ARCHITECTURE_SIGNAL_PATTERN.test(item) ? 2 : 0;
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
    /** With settings, every context scope comes from the bundle (7.2b). */
    settings?: Settings;
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
    lines.push(`- Name: ${project.name ?? '(unnamed)'}`);
    if (project.description?.trim()) {
        lines.push(`- Description: ${truncate(project.description.trim(), maxDescriptionChars)}`);
    }
    if (!opts.settings && Array.isArray(project.projectContext) && project.projectContext.length) {
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
            lines.push(`- Ubiquitous language:`);
            for (const item of glossary) lines.push(`    • ${item}`);
        }
    }
    // Written by people and by document analysis, not by the app: fenced
    // (plan de diagramas, 6.2). The rules about it stay outside the fence.
    const bundle = opts.settings ? renderDiagramContextBundle(project, opts.settings, artifact) : '';
    return `PROJECT CONTEXT — its constraints bind the diagram and its ubiquitous-language terms are used verbatim.
${wrapUntrustedContent('proyecto', lines.join('\n'))}${bundle ? `\n${bundle}` : ''}`;
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
    // C4 goes through the IR path: IR fields, never Mermaid macros (6.2).
    if (type === 'mermaid-c4-context') {
        return `ARCHITECTURAL GUARDRAILS — C4 CONTEXT (L1)
- Only people, the system in scope and external systems (≤ 8 elements); no
  containers, components or databases — those belong to L2/L3.
- kind "person" for humans, "system" for the system in scope, "external" (or
  trust "external"/"partner") for systems you do not operate.
- Every edge label states the business intent ("Cobra suscripción"); the
  protocol goes in "protocol".
- ≥ 3 systems of one organisation share a group of kind "enterprise".`;
    }
    if (type === 'mermaid-c4-container') {
        return `ARCHITECTURAL GUARDRAILS — C4 CONTAINER (L2)
- Applications, APIs, databases, queues and services of ONE system, plus the
  people and external systems they talk to.
- Every service, data and messaging element declares "technology"
  ("Spring Boot 3", "PostgreSQL 15", "Kafka 3.6"); every edge "protocol".
- A user interface never reaches a database directly: route via a service.
- The containers of the system in scope share a group of kind
  "system-boundary" named after the system.`;
    }
    if (type === 'mermaid-c4-component') {
        return `ARCHITECTURAL GUARDRAILS — C4 COMPONENT (L3)
- Only the components inside ONE container, plus the neighbours they call.
- Each component states one responsibility in "description".
- Inbound and outbound contracts appear as labelled edges.
- No generic "Helper"/"Util" unless the description justifies it.
- The components share a group named after their container.`;
    }
    if (type === 'mermaid-c4-deployment') {
        return `ARCHITECTURAL GUARDRAILS — C4 DEPLOYMENT
- Groups are deployment nodes (environment, region, cluster, network zone)
  named with their platform ("AWS us-east-1", "Kubernetes 1.29"); the
  elements inside are the running containers, with their "technology".
- Use the group "kind" (cloud, security…) to tell cloud, on-premise and
  network boundaries apart.
- External dependencies (DNS, identity, payments) are "external" elements
  outside the groups.`;
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
