/**
 * services/agent/agentContextComposer — single source of truth for composing
 * the Arquitecto Agente's system instruction.
 *
 * Every Gemini call originating from the chat surface (project, artifact or
 * global) flows through `buildAgentSystemInstruction()` so the model always
 * sees the same hierarchy:
 *
 *   1. Base persona / system rules                            (fixed)
 *   2. Memoria del Agente (Settings.agentMemory)              (identity)
 *   3. AI configuration hints (tone, language)                (compact)
 *   4. Global context (Settings.globalContext)                (selective)
 *   5. Project context + Captura Inicial                       (selective)
 *   6. Project agent memory + artifact inventory               (selective)
 *   7. Active artifact context (name + content excerpt)        (only when present)
 *   8. Artifact memory (Artifact.artifactMemory)              (only when present)
 *   9. Memory hierarchy & execution rules                      (fixed)
 *  10. Chat history                                            (only when toggle ON)
 *  11. Current user query                                      (always last)
 *
 * Every memory scope is metadata-aware: notes carry fecha/hora, autor and
 * prioridad (alta/media/baja). Selection weighs relevance + prioridad +
 * recencia, and the rules section instructs the model to resolve conflicts
 * by hierarchy: artefacto > proyecto > global > memoria del agente.
 *
 * The composer is pure — no I/O, no side effects, no calls to Gemini. It is
 * the only module that knows how the prompt is shaped, so refactors (token
 * budgets, new memory scopes, embeddings) stay local.
 */

import type { Settings } from '../../types';
import type { Artifact, ArtifactConversationDigest } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { ChatMessage } from '../chat';
import { assembleArtifactContext, bundleItems, buildBasePrompt } from '../ai';
import { compactBullet } from '../memory';

export type { AgentPersonaBriefing } from './agentPersonaBriefing';
import type { AgentPersonaBriefing } from './agentPersonaBriefing';
import { describeActiveArtifactContent } from './activeArtifactExposure';

// ─────────────────────────────────────────────────────────────────────────────
// Defaults & constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback "Memoria del Agente (Base)" used when the user hasn't customised
 * theirs. Keep in lock-step with `initialSettings.agentMemory` in AppContext —
 * they serve the same purpose but `DEFAULT_AGENT_MEMORY` is the safety net
 * the composer relies on when the settings object is incomplete (e.g. an
 * unauthenticated demo session).
 */
export const DEFAULT_AGENT_MEMORY: readonly string[] = Object.freeze([
  'Soy el Arquitecto Agente: agente de IA, arquitecto de soluciones y de aplicaciones, especialista en tecnología empresarial.',
  'Trabajo como soporte de arquitectura para una compañía multinacional de seguros (vida, salud/médico, operaciones regionales).',
  'Combino capacidades consultivas (responder, analizar, explicar, recomendar) con capacidades agentic (modificar, regenerar, mejorar artefactos, aplicar sugerencias).',
  'Diferencio claramente entre asesorar y ejecutar: cuando el usuario solicite una acción viable, la ejecuto reutilizando las capacidades existentes de la aplicación; cuando solicite asesoría, respondo concisamente en Markdown.',
  'Antes de sobrescribir contenido del usuario pregunto si aplicar al artefacto actual o crear nueva versión; nunca asumo por defecto en cambios destructivos.',
  'Aprovecho selectivamente el Centro de Memoria (global, proyecto, artefacto) y respeto la configuración del usuario sobre el historial de chat.',
  'Mantengo trazabilidad de las acciones que realizo y no expongo datos sensibles innecesarios.',
]);

/**
 * Per-scope budgets. Tuned so the total assembled instruction stays well
 * under the model's effective context (≈ 4–6k chars for the system text,
 * leaving room for the artifact content and user turn). All values are
 * additive caps — sanitise+truncate, never reject.
 */
export interface ContextBudget {
  /** Max bullets surfaced from settings.agentMemory (base behaviour). */
  agentBaseMax: number;
  /** Max bullets surfaced from settings.globalContext. */
  globalMax: number;
  /** Max bullets surfaced from project.projectContext. */
  projectMax: number;
  /** Max bullets surfaced from project.agentMemory (project-scoped learnings). */
  projectAgentMax: number;
  /** Max bullets surfaced from artifact.artifactMemory. */
  artifactMax: number;
  /** Max bullets surfaced from project.initialCapture. */
  initialCaptureMax: number;
  /** Max sibling artifacts listed in the project inventory section. */
  projectArtifactsMax: number;
  /** Per-bullet character cap before we truncate with an ellipsis. */
  bulletCharCap: number;
  /** Characters of the beginning shown when the active artifact is too long to show whole. */
  artifactContentCap: number;
  /** Max chat history messages forwarded to the model when history is ON. */
  historyMax: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  agentBaseMax: 8,
  globalMax: 10,
  projectMax: 12,
  projectAgentMax: 6,
  artifactMax: 8,
  initialCaptureMax: 6,
  projectArtifactsMax: 15,
  bulletCharCap: 220,
  artifactContentCap: 1800,
  historyMax: 12,
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the user's configured agent memory or the built-in default when the
 * configured list is empty/missing. Always returns a non-empty array.
 */
export function getAgentBaseMemory(settings: Settings | null | undefined): string[] {
  const configured = Array.isArray(settings?.agentMemory) ? settings!.agentMemory! : [];
  const cleaned = configured.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_AGENT_MEMORY];
}

// ─────────────────────────────────────────────────────────────────────────────
// System instruction composition
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildAgentSystemInstructionOptions {
  project: Project;
  activeArtifact: Artifact | null;
  settings: Settings;
  /** Latest user question — used to score memory relevance. */
  userQuery?: string;
  /** Optional override of the default budget for a specific call site. */
  budget?: Partial<ContextBudget>;
  /** Optional specialist persona for this turn. See `AgentPersonaBriefing`. */
  persona?: AgentPersonaBriefing;
  /** What the conversation settled — read even when the history itself is not sent (7.3b). */
  conversation?: ArtifactConversationDigest;
}

/**
 * Builds the system instruction Gemini receives BEFORE any chat turn. Always
 * returns a non-empty string. Never throws.
 */
export function buildAgentSystemInstruction(opts: BuildAgentSystemInstructionOptions): string {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...(opts.budget ?? {}) };
  const { project, activeArtifact, settings, userQuery } = opts;
  const sections: string[] = [];

  // 1. Base persona — fixed, never selected/truncated. Keeps the model
  //    anchored on the "Arquitecto Agente" identity even when memories
  //    return nothing.
  const baseInstruction = [
    'You are the Arquitecto Agente — an expert AI architecture agent for a multinational insurance company (life, health, regional operations).',
    'You combine consultative skills (analysis, recommendations, explanations) with agentic skills (modify, regenerate, improve artifacts, apply suggestions).',
    'Distinguish consultative answers from executable in-app actions and be explicit about what can be executed safely.',
    'Answer concisely in Markdown. Avoid filler. Prefer specificity to vague best practices.',
    'Before any destructive change on the active artifact, ask the user whether to overwrite or create a new version — never assume.',
  ].join('\n');
  const { persona } = opts;
  sections.push(persona ? persona.composeInstruction(baseInstruction) : baseInstruction);
  for (const section of persona?.sections ?? []) sections.push(section);

  // 2. Memoria del Agente (BASE) — highest-priority memory. Always included
  //    in full (subject only to per-bullet cap) so the agent identity stays
  //    consistent across turns.
  // One assembly for every scope (plan de calidad de artefactos, 7.2): the
  // same ranking, hierarchy and de-duplication artifact generation reads.
  const bundle = assembleArtifactContext(
    { project, settings, artifact: activeArtifact, agentMemory: getAgentBaseMemory(settings), query: userQuery, conversation: opts.conversation },
    {
      name: 'consult',
      limits: {
        artefacto: budget.artifactMax,
        proyecto: budget.projectMax,
        capturaInicial: budget.initialCaptureMax,
        memoriaProyecto: budget.projectAgentMax,
        conversacion: budget.projectAgentMax,
        global: budget.globalMax,
        agente: budget.agentBaseMax,
      },
      noteChars: budget.bulletCharCap,
      excerptChars: 0,
      totalChars: Number.MAX_SAFE_INTEGER,
    },
  );
  const agentBaseSelected = bundleItems(bundle, 'agente');
  if (agentBaseSelected.length > 0) {
    sections.push(['Memoria del Agente (Base):', ...agentBaseSelected.map((b) => `- ${b}`)].join('\n'));
  }

  // 3. AI configuration hints — kept compact (one line each). They never
  //    survive a relevance filter because they're never query-specific.
  const aiHints: string[] = [];
  if (settings.aiConfig?.tone) aiHints.push(`Tone: ${settings.aiConfig.tone}`);
  if (settings.language) {
    aiHints.push(`Idioma de respuesta preferido: ${settings.language === 'es' ? 'Español' : 'English'}`);
  }
  if (aiHints.length > 0) {
    sections.push(['Configuración del agente:', ...aiHints.map((h) => `- ${h}`)].join('\n'));
  }

  // 4 + 5. Global context + project context — selected by relevance against
  //    the user's query. When no query is available we keep natural order.
  const globalSelected = bundleItems(bundle, 'global');
  if (globalSelected.length > 0) {
    sections.push(['Memoria Global (estándares y preferencias):', ...globalSelected.map((b) => `- ${b}`)].join('\n'));
  }

  // 4-bis. Project header (name + description). buildBasePrompt also
  //    composes a global header but we only use it to ground the model on
  //    the project — and replace the section's bullet list with our
  //    relevance-selected one above. Keeping the project meta independent
  //    means buildBasePrompt's other call sites (artifact generation, etc.)
  //    are unaffected.
  const projectMeta: string[] = [];
  if (project.name) projectMeta.push(`Proyecto activo: ${project.name}`);
  if (typeof project.description === 'string' && project.description.trim().length > 0) {
    projectMeta.push(`Descripción: ${compactBullet(project.description, budget.bulletCharCap * 4)}`);
  }
  if (projectMeta.length > 0) {
    sections.push(projectMeta.join('\n'));
  }

  const projectSelected = bundleItems(bundle, 'proyecto');
  if (projectSelected.length > 0) {
    sections.push(['Contexto del Proyecto (selección relevante):', ...projectSelected.map((b) => `- ${b}`)].join('\n'));
  }

  // 5-bis. Captura Inicial — objetivos, alcance y stakeholders registrados al
  //    crear el proyecto. Lower volume than projectContext but it anchors the
  //    original intent of the project, so the agent never drifts from it.
  const initialCaptureSelected = bundleItems(bundle, 'capturaInicial');
  if (initialCaptureSelected.length > 0) {
    sections.push(['Captura Inicial del Proyecto (objetivos, alcance, stakeholders):', ...initialCaptureSelected.map((b) => `- ${b}`)].join('\n'));
  }

  // 6. Project agent memory — project-scoped learnings (lower priority than
  //    base, higher than artifact memory because it persists across
  //    artifacts within the project).
  const projectAgentSelected = bundleItems(bundle, 'memoriaProyecto');
  if (projectAgentSelected.length > 0) {
    sections.push(['Memoria del Agente (Proyecto):', ...projectAgentSelected.map((b) => `- ${b}`)].join('\n'));
  }
  // 6-ter. Decisiones de la conversación — lo acordado en el chat, aunque el
  //    historial no se envíe (7.3b).
  const conversationDecisions = bundleItems(bundle, 'conversacion');
  if (conversationDecisions.length > 0) {
    sections.push(['Decisiones recientes de la conversación (acordadas en el chat):', ...conversationDecisions.map((b) => `- ${b}`)].join('\n'));
  }


  // 6-bis. Inventario de artefactos del proyecto — the agent must always be
  //    aware of what was already produced so new artifacts stay consistent
  //    with prior ones and so it can reference/act on any of them by name.
  //    Compact: one line per version group (latest version only).
  const inventory = buildProjectArtifactsInventory(project, budget.projectArtifactsMax);
  if (inventory.length > 0) {
    sections.push(
      [
        'Artefactos existentes del proyecto (usa este inventario como fuente de verdad de lo ya generado; mantén consistencia con ellos):',
        ...inventory.map((line) => `- ${line}`),
      ].join('\n'),
    );
  }

  // 7 + 8. Active artifact context (name, type, content excerpt) and its
  //    own scoped memory. Only included when there's an artifact in view.
  if (activeArtifact) {
    const artifactHeader: string[] = [];
    artifactHeader.push(`Artefacto activo: ${activeArtifact.name} (${activeArtifact.type})`);
    if (activeArtifact.objective) {
      artifactHeader.push(`Objetivo: ${compactBullet(activeArtifact.objective, budget.bulletCharCap * 2)}`);
    }
    // Whole, or an outline and the beginning — never a blind cut (7.1b).
    const contentBlock = describeActiveArtifactContent(activeArtifact.content ?? '', {
      excerptCap: budget.artifactContentCap,
    });
    if (contentBlock) artifactHeader.push(contentBlock);
    sections.push(artifactHeader.join('\n'));

    const artifactSelected = bundleItems(bundle, 'artefacto');
    if (artifactSelected.length > 0) {
      sections.push(['Memoria del Artefacto:', ...artifactSelected.map((b) => `- ${b}`)].join('\n'));
    }
  }

  // 9. Memory hierarchy & consistency rules — formalises how the agent must
  //    weigh the different contexts whenever it answers or generates
  //    anything. Prompt ORDER above is presentation; THESE rules govern
  //    conflict resolution and prioritisation.
  sections.push(
    [
      'Jerarquía y uso de la memoria (obligatorio en toda respuesta o generación):',
      '- Considera SIEMPRE todos los ámbitos disponibles: contexto del artefacto, contexto del proyecto (incluida la captura inicial), contexto global, memoria del agente y los artefactos ya generados.',
      '- Ante información en conflicto, resuelve por jerarquía: contexto del artefacto > contexto del proyecto > contexto global > memoria del agente.',
      '- Dentro de un mismo ámbito, prioriza por la prioridad asignada por el usuario (alta > media > baja) y, a igual prioridad, por fecha de creación (la nota más reciente prevalece). Las anotaciones [prioridad … · fecha · autor] de cada nota te indican estos metadatos; las notas sin anotación son de prioridad media y sin fecha conocida.',
      '- Mantén consistencia con los artefactos ya generados del proyecto; si detectas una contradicción entre ámbitos o con un artefacto existente, resuélvela aplicando la jerarquía anterior y señálala explícitamente al usuario.',
      '- Usa solo la información más relevante para la tarea en curso: no repitas contexto que no aporte a la solicitud.',
    ].join('\n'),
  );

  // 10. Action rules — explicit guardrails + the executable capability
  //     catalog, so the model routes requests to real in-app actions instead
  //     of describing changes it could have executed.
  sections.push(
    [
      'Reglas de ejecución:',
      '- Capacidades ejecutables disponibles vía el orquestador: crear artefacto nuevo, regenerar, mejorar, aplicar cambio puntual, crear nueva versión, aplicar sugerencias de revisión, acciones por lote sobre varios artefactos y guardar notas en la memoria (global, proyecto o artefacto).',
      '- Si la solicitud es ejecutable y existe un artefacto activo, prefiere usar la herramienta `modifyArtifact` (preguntando primero "current" vs "new_version").',
      '- Si la solicitud requiere capacidades agentic más amplias (crear, regenerar, mejorar, aplicar sugerencias, lote), reconoce la intención y deja que el orquestador externo planifique la acción.',
      '- Si la solicitud es consultiva, responde directamente sin sugerir cambios destructivos.',
      '- Nunca inventes archivos, proyectos o artefactos que no existan en este contexto.',
    ].join('\n'),
  );

  return sections.join('\n\n');
}

/**
 * Compact one-line-per-artifact inventory of the project. Lists the LATEST
 * version of each version group (newest first) so the agent always knows
 * what was already produced — required for cross-artifact consistency and
 * for acting on artifacts by name. Pure and defensive: never throws.
 */
export function buildProjectArtifactsInventory(project: Project, limit: number): string[] {
  const artifacts = Array.isArray(project.artifacts) ? project.artifacts : [];
  if (artifacts.length === 0 || limit <= 0) return [];

  const latestByGroup = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.name !== 'string') continue;
    const group = artifact.versionGroupId || artifact.id;
    const current = latestByGroup.get(group);
    if (!current || (artifact.version ?? 1) > (current.version ?? 1)) {
      latestByGroup.set(group, artifact);
    }
  }

  return [...latestByGroup.values()]
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '') || 0)
    .slice(0, limit)
    .map((artifact) => {
      const status = artifact.reviewStatus ? `, estado: ${artifact.reviewStatus}` : '';
      const objective = (artifact.objective ?? '').trim();
      const summary = objective ? ` — ${compactBullet(objective, 120)}` : '';
      return `"${artifact.name}" (${artifact.type}, v${artifact.version ?? 1}${status})${summary}`;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat history selection
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareChatHistoryOptions {
  history: ChatMessage[];
  /** Whether the user opted-in to history inclusion. Defaults to false. */
  includeChatHistory: boolean;
  /** Optional override of the default budget for the message count cap. */
  budget?: Partial<ContextBudget>;
}

export interface PreparedChatTurn {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/**
 * Builds the chat history array Gemini receives BEFORE the current user
 * turn. Honours the `includeChatHistoryByDefault` toggle and applies the
 * `historyMax` cap so even users who enable history don't blow the
 * context window.
 */
export function prepareChatHistoryForModel(opts: PrepareChatHistoryOptions): PreparedChatTurn[] {
  if (!opts.includeChatHistory) return [];
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...(opts.budget ?? {}) };
  const cleaned = (opts.history ?? []).filter(
    (m): m is ChatMessage => m != null && typeof m.content === 'string' && (m.role === 'user' || m.role === 'model'),
  );
  // Drop compaction markers — they're for UI use, not for the model.
  const safe = cleaned.filter((m) => m.meta?.kind !== 'compaction');
  const tail = safe.slice(-Math.max(0, budget.historyMax));
  return tail.map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy bridge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight wrapper exposing the legacy `buildBasePrompt` helper for call
 * sites that need the document-mode global header (artifact generation,
 * suggestions, etc.) without going through the full composer. This is kept
 * here so the composer is the only module that touches `utils.ts` from the
 * agent subsystem.
 */
export function buildLegacyDocumentBasePrompt(project: Project, settings: Settings): string {
  return buildBasePrompt(project, settings);
}
