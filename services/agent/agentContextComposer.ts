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

import type { MemoryEntry, Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { ChatMessage } from '../chat';
import { buildBasePrompt } from '../ai';
import {
  MEMORY_PRIORITY_WEIGHT,
  formatMemoryEntryAnnotation,
  reconcileMemoryEntries,
  sortMemoryEntriesForContext,
} from '../memory/memoryEntries';

export type { AgentPersonaBriefing } from './agentPersonaBriefing';
import type { AgentPersonaBriefing } from './agentPersonaBriefing';

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
  /** Max characters retained from the active artifact's content excerpt. */
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

/**
 * Truncates a bullet to at most `charCap` characters, preserving word
 * boundaries when possible.
 */
export function compactBullet(value: string, charCap: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= charCap) return trimmed;
  // Try to cut at the last word boundary to avoid mid-word truncation.
  const slice = trimmed.slice(0, charCap - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(charCap * 0.6) ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * Score a single memory bullet against a free-form query. Higher = more
 * relevant. The scoring is deliberately conservative (stemmed token overlap +
 * length penalty + recency tie-breaker) so the composer stays sync and
 * cheap. Embeddings can replace this later without touching call sites.
 *
 * Matching is "semantic-lite": accents are folded, plurals collapse and a
 * light Spanish/English suffix stemmer makes word families match
 * ("integración" ↔ "integraciones" ↔ "integrar", "sistema" ↔ "sistemas",
 * "payment" ↔ "payments"). Deterministic, no AI calls.
 */

/** Removes diacritics so "integración" and "integracion" compare equal. */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Derivational suffixes stripped (longest first) when the remaining stem
 * keeps ≥ 4 characters. Covers the most frequent Spanish word families in
 * architecture notes plus light English endings.
 */
const STEM_SUFFIXES = [
  'aciones', 'iciones', 'uciones', 'amientos', 'imientos',
  'amiento', 'imiento', 'adoras', 'adores', 'idades',
  'acion', 'icion', 'ucion', 'encias', 'encia', 'anzas', 'anza',
  'mente', 'adora', 'ador', 'antes', 'ante', 'ibles', 'ible', 'ables', 'able',
  'istas', 'ista', 'ciones', 'cion', 'siones', 'sion',
  'ation', 'ations', 'ments', 'ment', 'ings', 'ing',
  'ando', 'iendo', 'ados', 'adas', 'ado', 'ada', 'idos', 'idas', 'ido', 'ida',
];

/** Light stemmer: fold accents, lowercase, strip plural + derivational suffix. */
export function stemMatchToken(token: string): string {
  let stem = foldAccents(token.toLowerCase());
  for (const suffix of STEM_SUFFIXES) {
    if (stem.length - suffix.length >= 4 && stem.endsWith(suffix)) {
      stem = stem.slice(0, stem.length - suffix.length);
      break;
    }
  }
  // Plural collapse: "sistemas" → "sistema", "redes" → "red".
  if (stem.length >= 5 && stem.endsWith('es') && !/[aeiou]es$/.test(stem)) {
    stem = stem.slice(0, -2);
  } else if (stem.length >= 4 && stem.endsWith('s')) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

function tokenizeForMatching(text: string): string[] {
  return Array.from(
    new Set(
      foldAccents(text.toLowerCase())
        .split(/[^a-z0-9ñ]+/iu)
        .filter((t) => t.length >= 3)
        .map((t) => stemMatchToken(t)),
    ),
  );
}

/** Two stems match exactly or by a shared prefix of ≥ 5 characters. */
function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 5) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function scoreBulletForQuery(bullet: string, query: string): number {
  if (!query) return 0;
  const queryStems = tokenizeForMatching(query);
  if (queryStems.length === 0) return 0;
  const bulletStems = tokenizeForMatching(bullet);
  if (bulletStems.length === 0) return 0;
  let hits = 0;
  for (const queryStem of queryStems) {
    if (bulletStems.some((bulletStem) => stemsMatch(queryStem, bulletStem))) hits += 1;
  }
  if (hits === 0) return 0;
  // Normalise by query token count so a 6-token query matching 3 tokens
  // scores 0.5 — comparable across queries of different length.
  const coverage = hits / queryStems.length;
  // Mild length penalty: very long bullets contain more "noise"; we still
  // surface them, just slightly lower.
  const lengthPenalty = Math.max(0, (bullet.length - 220) / 4000);
  return Math.max(0, coverage - lengthPenalty);
}

export interface SelectRelevantMemoryOptions {
  items: string[];
  /** Free-form text used to score relevance (typically the user's question). */
  query?: string;
  /** Max bullets to keep. Higher-scoring bullets win; ties keep order. */
  limit: number;
  /** Per-bullet character cap. */
  bulletCharCap: number;
}

/**
 * Picks the most relevant bullets for a query. When `query` is empty (or no
 * bullets hit the query) we fall back to the natural order so the user sees
 * a stable, predictable subset rather than a random sample.
 *
 * Pure: no I/O, no Gemini calls.
 */
export function selectRelevantMemory(opts: SelectRelevantMemoryOptions): string[] {
  const { items, query, limit, bulletCharCap } = opts;
  const cleaned = (items ?? [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (cleaned.length === 0 || limit <= 0) return [];

  if (!query?.trim()) {
    return cleaned.slice(0, limit).map((b) => compactBullet(b, bulletCharCap));
  }

  // Score each bullet, then sort by score descending while preserving the
  // original order on ties (stable sort via index tiebreaker).
  const indexed = cleaned.map((value, index) => ({
    value,
    index,
    score: scoreBulletForQuery(value, query),
  }));
  const positive = indexed.filter((entry) => entry.score > 0);

  if (positive.length === 0) {
    // No semantic hit — fall back to natural order (recency is implicit in
    // how memories are appended) rather than skipping the section entirely.
    return cleaned.slice(0, limit).map((b) => compactBullet(b, bulletCharCap));
  }

  positive.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return positive.slice(0, limit).map((entry) => compactBullet(entry.value, bulletCharCap));
}

export interface SelectRelevantMemoryEntriesOptions {
  /** Legacy text mirror of the scope (canonical list of notes). */
  texts: string[] | null | undefined;
  /** Structured metadata entries of the scope (fecha, autor, prioridad). */
  entries: MemoryEntry[] | null | undefined;
  /** Free-form text used to score relevance (typically the user's question). */
  query?: string;
  /** Max bullets to keep. */
  limit: number;
  /** Per-bullet character cap. */
  bulletCharCap: number;
}

/**
 * Metadata-aware evolution of `selectRelevantMemory`. The composite score per
 * note is:
 *
 *   relevance (0..1, token overlap with the query)
 *   + priority boost   (alta +0.40 · media +0.20 · baja +0)
 *   + recency boost    (0..0.20, rank-based on createdAt; sin fecha = 0)
 *
 * so a highly relevant low-priority note still beats an irrelevant
 * high-priority one, while ties resolve by prioridad del usuario y después
 * por fecha (más reciente primero) — exactly the ordering contract of the
 * Centro de Memoria. Without a query the notes are ordered by prioridad +
 * recencia. Each selected note is rendered with its compact metadata
 * annotation so the model can also weigh fecha/autor/prioridad.
 *
 * Pure: no I/O, no Gemini calls.
 */
export function selectRelevantMemoryEntries(opts: SelectRelevantMemoryEntriesOptions): string[] {
  const { texts, entries, query, limit, bulletCharCap } = opts;
  if (limit <= 0) return [];
  const reconciled = reconcileMemoryEntries(texts, entries).filter((entry) => entry.text.trim().length > 0);
  if (reconciled.length === 0) return [];

  const ordered = sortMemoryEntriesForContext(reconciled);
  const render = (entry: MemoryEntry): string =>
    `${formatMemoryEntryAnnotation(entry)}${compactBullet(entry.text, bulletCharCap)}`;

  if (!query?.trim()) {
    return ordered.slice(0, limit).map(render);
  }

  // Rank-based recency boost computed over the dated notes only.
  const dated = [...reconciled]
    .filter((entry) => entry.createdAt !== null)
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
  const recencyRank = new Map(dated.map((entry, index) => [entry.id, index]));
  const recencyBoost = (entry: MemoryEntry): number => {
    const rank = recencyRank.get(entry.id);
    if (rank === undefined || dated.length === 0) return 0;
    return 0.2 * (1 - rank / dated.length);
  };
  const priorityBoost = (entry: MemoryEntry): number =>
    (MEMORY_PRIORITY_WEIGHT[entry.priority] - MEMORY_PRIORITY_WEIGHT.low) * 0.2;

  const scored = ordered.map((entry, index) => ({
    entry,
    index,
    score: scoreBulletForQuery(entry.text, query) + priorityBoost(entry) + recencyBoost(entry),
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.slice(0, limit).map((item) => render(item.entry));
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
  const agentBase = getAgentBaseMemory(settings);
  const agentBaseSelected = agentBase
    .slice(0, budget.agentBaseMax)
    .map((b) => compactBullet(b, budget.bulletCharCap));
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
  const globalSelected = selectRelevantMemoryEntries({
    texts: settings.globalContext,
    entries: settings.globalContextEntries,
    query: userQuery,
    limit: budget.globalMax,
    bulletCharCap: budget.bulletCharCap,
  });
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

  const projectSelected = selectRelevantMemoryEntries({
    texts: project.projectContext,
    entries: project.projectContextEntries,
    query: userQuery,
    limit: budget.projectMax,
    bulletCharCap: budget.bulletCharCap,
  });
  if (projectSelected.length > 0) {
    sections.push(['Contexto del Proyecto (selección relevante):', ...projectSelected.map((b) => `- ${b}`)].join('\n'));
  }

  // 5-bis. Captura Inicial — objetivos, alcance y stakeholders registrados al
  //    crear el proyecto. Lower volume than projectContext but it anchors the
  //    original intent of the project, so the agent never drifts from it.
  const initialCaptureSelected = selectRelevantMemoryEntries({
    texts: project.initialCapture,
    entries: project.initialCaptureEntries,
    query: userQuery,
    limit: budget.initialCaptureMax,
    bulletCharCap: budget.bulletCharCap,
  });
  if (initialCaptureSelected.length > 0) {
    sections.push(['Captura Inicial del Proyecto (objetivos, alcance, stakeholders):', ...initialCaptureSelected.map((b) => `- ${b}`)].join('\n'));
  }

  // 6. Project agent memory — project-scoped learnings (lower priority than
  //    base, higher than artifact memory because it persists across
  //    artifacts within the project).
  const projectAgentSelected = selectRelevantMemoryEntries({
    texts: project.agentMemory,
    entries: project.agentMemoryEntries,
    query: userQuery,
    limit: budget.projectAgentMax,
    bulletCharCap: budget.bulletCharCap,
  });
  if (projectAgentSelected.length > 0) {
    sections.push(['Memoria del Agente (Proyecto):', ...projectAgentSelected.map((b) => `- ${b}`)].join('\n'));
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
    const excerpt = (activeArtifact.content ?? '').trim();
    if (excerpt.length > 0) {
      const limited = excerpt.length > budget.artifactContentCap
        ? `${excerpt.slice(0, budget.artifactContentCap)}\n[…contenido truncado para el contexto…]`
        : excerpt;
      artifactHeader.push('Contenido actual:\n```\n' + limited + '\n```');
    }
    sections.push(artifactHeader.join('\n'));

    const artifactSelected = selectRelevantMemoryEntries({
      texts: activeArtifact.artifactMemory,
      entries: activeArtifact.artifactMemoryEntries,
      query: userQuery,
      limit: budget.artifactMax,
      bulletCharCap: budget.bulletCharCap,
    });
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
