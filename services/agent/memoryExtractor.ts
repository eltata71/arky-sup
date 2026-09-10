/**
 * AI-powered extractor of memory bullets from a conversation tail.
 *
 * Given the recent chat history (+ the user's "save this" instruction), this
 * module asks Gemini to return 1-5 concise bullets that capture the key
 * concepts, constraints, decisions or directives worth persisting as context.
 *
 * Design notes:
 *  - Strict JSON schema so we don't have to parse free-form output.
 *  - Scope-aware system prompt: bullets phrased differently for global
 *    standards vs project-specific decisions vs artifact-anchored notes.
 *  - 8s timeout; never throws — returns `null` on failure and the executor
 *    falls back to a sanitized version of the user's literal instruction.
 *  - Bullets are post-sanitized: trimmed, deduplicated, length-capped (220
 *    chars each) so the persisted context arrays stay tidy.
 */

import type { Settings } from '../../types';
import type { ChatMessage } from '../chat';
import { aiGateway } from '../ai';
import { resolveEffectiveModel } from '../../lib/ai/modelCatalog';
import type { MemoryScope } from './agentTypes';

export interface ExtractMemoryBulletsInput {
  scope: MemoryScope;
  /** Recent conversation (already-tail-trimmed by the caller). */
  history: ChatMessage[];
  /** The user's literal "guarda esto" instruction — used to bias extraction. */
  userInstruction: string;
  /** Optional anchor — name of the artifact when scope === 'artifact'. */
  artifactName?: string | null;
  /** Optional anchor — name of the project. */
  projectName?: string | null;
  settings: Settings;
}

const MAX_BULLETS = 5;
const MAX_BULLET_LENGTH = 220;
const EXTRACTION_TIMEOUT_MS = 8000;

const SCHEMA = {
  type: 'object',
  properties: {
    bullets: {
      type: 'array',
      items: { type: 'string' },
      description: 'Between 1 and 5 concise bullets capturing key concepts/decisions/constraints worth saving as context.',
    },
  },
  required: ['bullets'],
} as const;

const SCOPE_INSTRUCTION: Record<MemoryScope, string> = {
  global:
    'Captura SOLO conocimiento transversal al usuario o a la organización (estándares, preferencias tecnológicas, principios, restricciones de cumplimiento). Cada bullet debe ser independiente del proyecto en curso y servir como directriz reutilizable.',
  project:
    'Captura decisiones y restricciones específicas de este proyecto (alcance, audiencia, tecnologías elegidas, requisitos no funcionales, hitos). Cada bullet debe poder leerse fuera de la conversación y aún tener sentido.',
  artifact:
    'Captura notas anclas a este artefacto en particular (intención, audiencia, supuestos, terminología, riesgos). Evita lo que ya está implícito en el contenido del artefacto.',
};

const buildPrompt = (input: ExtractMemoryBulletsInput): string => {
  const tail = input.history.slice(-10);
  const transcript = tail
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Arquitecto Agente'}: ${m.content}`)
    .join('\n');
  const anchor = input.scope === 'artifact' && input.artifactName ? `\nArtefacto: ${input.artifactName}` : '';
  const projectAnchor = input.projectName ? `\nProyecto: ${input.projectName}` : '';
  return `Eres un asistente que extrae conocimiento accionable de una conversación con un arquitecto de soluciones.

Tarea: a partir de la conversación reciente y de la instrucción del usuario, devuelve entre 1 y ${MAX_BULLETS} bullets concisos para guardar como contexto persistente.

Alcance solicitado: ${input.scope}.
${SCOPE_INSTRUCTION[input.scope]}

Reglas:
- Cada bullet es UNA frase clara, en español, máximo ${MAX_BULLET_LENGTH} caracteres.
- Evita verbos vacíos ("hablamos sobre…", "discutimos…"). Cada bullet debe afirmar algo concreto.
- No incluyas saludos, despedidas, ni meta-comentarios sobre la conversación.
- Si no hay nada accionable, devuelve un único bullet con la instrucción del usuario reformulada como nota.

Instrucción del usuario:
"""
${input.userInstruction}
"""
${projectAnchor}${anchor}

Conversación reciente:
"""
${transcript}
"""

Devuelve JSON estricto siguiendo el esquema.`;
};

const sanitiseBullets = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/^[-•*]\s*/, '').replace(/\s+/g, ' ');
    if (trimmed.length < 6) continue;
    const capped = trimmed.length > MAX_BULLET_LENGTH ? `${trimmed.slice(0, MAX_BULLET_LENGTH - 1)}…` : trimmed;
    const dedupeKey = capped.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    cleaned.push(capped);
    if (cleaned.length >= MAX_BULLETS) break;
  }
  return cleaned;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('memory-extractor-timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/**
 * Extract memory bullets from a conversation tail. Returns `null` on any
 * failure — callers should fall back to a sanitised version of the user's
 * literal instruction so the save action always produces a value.
 */
export async function extractMemoryBullets(input: ExtractMemoryBulletsInput): Promise<string[] | null> {
  try {
    const modelId = resolveEffectiveModel('default', input.settings).id;
    // Routed through the provider-agnostic seam so OpenRouter users get their
    // selected provider. Single attempt (`maxRetries: 0` / `maxCandidates: 1`)
    // preserves the previous Gemini behaviour; failures fall back to
    // `fallbackBulletsFromInstruction` via the `null` return below.
    const response = await withTimeout(
      aiGateway.generateContent(
        input.settings,
        modelId,
        buildPrompt(input),
        {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.2,
        },
        { timeoutMs: EXTRACTION_TIMEOUT_MS, maxRetries: 0, maxCandidates: 1 },
      ),
      EXTRACTION_TIMEOUT_MS,
    );
    const text = response.text?.trim();
    if (!text) return null;
    let parsed: { bullets?: unknown };
    try {
      parsed = JSON.parse(text) as { bullets?: unknown };
    } catch {
      return null;
    }
    const bullets = sanitiseBullets(parsed.bullets);
    return bullets.length > 0 ? bullets : null;
  } catch {
    return null;
  }
}

/**
 * Cheap fallback when the LLM extraction fails or is unavailable. Splits the
 * user instruction into sentences and returns the most useful ones.
 */
export function fallbackBulletsFromInstruction(instruction: string): string[] {
  const sentences = instruction
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 6);
  if (sentences.length === 0) {
    const fallback = instruction.trim();
    return fallback.length > 0 ? [fallback.slice(0, MAX_BULLET_LENGTH)] : [];
  }
  return sentences.slice(0, MAX_BULLETS).map((s) =>
    s.length > MAX_BULLET_LENGTH ? `${s.slice(0, MAX_BULLET_LENGTH - 1)}…` : s,
  );
}

export const MEMORY_BULLET_LIMITS = {
  MAX_BULLETS,
  MAX_BULLET_LENGTH,
};
