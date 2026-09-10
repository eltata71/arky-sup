/**
 * services/agent/agentLessonRecorder — automatic post-action learning loop.
 *
 * After the Arquitecto Agente executes an action (create / regenerate /
 * improve / patch / batch…), this module derives a compact, deterministic
 * "lesson" from the plan + result and persists it into the project-scoped
 * agent memory (`Project.agentMemory` / `agentMemoryEntries`). Over time the
 * agent accumulates what worked and what failed for THIS project, and the
 * context composer surfaces those lessons on every subsequent turn.
 *
 * Design constraints:
 *  - Deterministic (no AI call): zero latency/cost added to the action.
 *  - Low priority notes signed by "Arquitecto Agente": user-authored notes
 *    always outrank lessons in context selection.
 *  - Bounded: at most `MAX_AGENT_LESSONS` auto-lessons are retained (oldest
 *    pruned first); user notes in the same scope are never touched.
 *  - Fail-open: recording is best-effort; a failure never affects the action.
 */

import type { MemoryEntry } from '../../types';
import type { AgentActionPlan, AgentActionResult, AgentIntentType } from './agentTypes';
import {
  createMemoryEntry,
  memoryEntriesToTexts,
  reconcileMemoryEntries,
} from '../memory/memoryEntries';

export const AGENT_LESSON_PREFIX = 'Lección del agente:';
export const MAX_AGENT_LESSONS = 12;
export const AGENT_LESSON_AUTHOR = 'Arquitecto Agente';

const ACTION_LABEL: Partial<Record<AgentIntentType, string>> = {
  'artifact.create': 'creación de artefacto',
  'artifact.regenerate': 'regeneración',
  'artifact.improve': 'mejora',
  'artifact.patch': 'cambio puntual',
  'artifact.createVersion': 'creación de versión',
  'artifact.applySuggestion': 'aplicación de sugerencias',
  'artifacts.batch': 'acción por lote',
};

const truncate = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Builds the lesson text for a finished action, or `null` when the action is
 * not worth remembering (cancelled, consultative, memory saves).
 */
export function buildAgentLesson(
  plan: AgentActionPlan,
  result: AgentActionResult,
  artifactName: string,
): string | null {
  const label = ACTION_LABEL[plan.actionType];
  if (!label) return null;
  if (result.status === 'cancelled') return null;

  const instruction = truncate(plan.intent.userInstruction ?? '', 110);
  const subject = artifactName ? `"${truncate(artifactName, 60)}"` : 'el proyecto';

  if (result.status === 'success' || result.status === 'partial') {
    const score = result.validationResult?.score;
    const scorePart = typeof score === 'number' ? ` (calidad ${score}/100)` : '';
    const partialPart = result.status === 'partial' ? ' parcialmente' : '';
    return `${AGENT_LESSON_PREFIX} la ${label} sobre ${subject} funcionó${partialPart}${scorePart} con la instrucción "${instruction}".`;
  }

  const reason = truncate(result.messages[0] ?? result.errors[0] ?? 'error no especificado', 110);
  return `${AGENT_LESSON_PREFIX} la ${label} sobre ${subject} falló (${reason}); ajustar el enfoque antes de reintentar "${instruction}".`;
}

export interface MergeAgentLessonInput {
  existingTexts: string[] | null | undefined;
  existingEntries: MemoryEntry[] | null | undefined;
  lesson: string;
}

export interface MergeAgentLessonResult {
  texts: string[];
  entries: MemoryEntry[];
}

/**
 * Merges a new lesson into the project agent memory: dedupes by text, prunes
 * the oldest auto-lessons beyond `MAX_AGENT_LESSONS` and stamps the new note
 * with author "Arquitecto Agente", fecha actual y prioridad baja. Returns
 * `null` when nothing changes (duplicate lesson).
 */
export function mergeAgentLesson(input: MergeAgentLessonInput): MergeAgentLessonResult | null {
  const lesson = input.lesson.trim();
  if (!lesson) return null;

  const reconciled = reconcileMemoryEntries(input.existingTexts, input.existingEntries);
  if (reconciled.some((entry) => entry.text.trim().toLowerCase() === lesson.toLowerCase())) {
    return null;
  }

  // Prune oldest auto-lessons so the loop stays bounded. User notes (no
  // prefix) are never pruned. Lessons keep insertion order = chronological.
  const next = [...reconciled];
  const lessonIndexes = next
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.text.startsWith(AGENT_LESSON_PREFIX))
    .map(({ index }) => index);
  const excess = lessonIndexes.length - (MAX_AGENT_LESSONS - 1);
  if (excess > 0) {
    const toDrop = new Set(lessonIndexes.slice(0, excess));
    for (let i = next.length - 1; i >= 0; i--) {
      if (toDrop.has(i)) next.splice(i, 1);
    }
  }

  next.push(createMemoryEntry(lesson, {
    priority: 'low',
    authorId: 'arquitecto-agente',
    authorName: AGENT_LESSON_AUTHOR,
  }));

  return { texts: memoryEntriesToTexts(next), entries: next };
}
