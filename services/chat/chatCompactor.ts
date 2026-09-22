/**
 * Chat compaction service.
 *
 * Given a contiguous slice of chat history, asks Gemini to produce a
 * structured digest that the Memory Center can persist as a single
 * "compaction marker" message in place of the originals. The marker keeps
 * the key concepts, decisions and open questions so future AI turns can
 * still rely on the conversational context — just with a fraction of the
 * token / storage footprint.
 *
 * Design:
 *  - Strict JSON schema so the UI never has to parse free-form output.
 *  - 12s timeout, single attempt. Never throws — returns `null` on failure
 *    and the caller falls back to a deterministic, AI-less digest.
 *  - The deterministic fallback is good enough to keep the feature useful
 *    when the API is down (it still saves storage; it just won't paraphrase).
 */

import type { Settings } from '../../types';
import type { ChatMessage } from './ChatTypes';
import { aiGateway } from '../ai';
import { deterministicCompactionDigest, type CompactionDigest } from './compactionDigest';
import { resolveEffectiveModel } from '../../lib/ai/modelCatalog';

/**
 * Re-exported so this module's published surface is unchanged.
 *
 * `services/chat` still exports both names from the same place it always did;
 * the split exists to keep the AI-less half reachable without the AI-calling
 * half, not to make callers learn a second import path.
 */
export { deterministicCompactionDigest };
export type { CompactionDigest };

const COMPACTION_TIMEOUT_MS = 12000;
const MAX_MESSAGES_PER_COMPACTION = 200;
const MAX_TOPIC_LENGTH = 80;
const MAX_BULLET_LENGTH = 240;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título breve (≤80 chars).' },
    summary: { type: 'string', description: 'Resumen narrativo (≤600 chars).' },
    decisions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Decisiones tomadas explícitamente durante la conversación.',
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Preguntas/temas pendientes a futuro.',
    },
    topics: {
      type: 'array',
      items: { type: 'string' },
      description: 'Hasta 6 etiquetas temáticas para indexar la conversación.',
    },
  },
  required: ['title', 'summary'],
} as const;

const buildPrompt = (messages: ChatMessage[]): string => {
  const trimmed = messages.slice(0, MAX_MESSAGES_PER_COMPACTION);
  const transcript = trimmed
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Arquitecto Agente'}: ${m.content}`)
    .join('\n');
  return `Eres un asistente que compacta conversaciones con un arquitecto de soluciones.

Tarea: produce un digest estructurado del intercambio que se entrega. El digest reemplazará a la conversación original en el historial, por lo que debe preservar los conceptos, decisiones y preguntas pendientes — no la cortesía ni los saludos.

Reglas:
- Idioma: español, frases concretas.
- title: titular descriptivo de máximo 80 caracteres.
- summary: párrafo único, máximo 600 caracteres.
- decisions: bullets con afirmaciones concretas ("Se elige PostgreSQL 15", "Se descarta arquitectura monolítica"). Vacío si no hubo.
- openQuestions: bullets con interrogantes vivos ("¿Cómo manejaremos failover?"). Vacío si no hubo.
- topics: hasta 6 etiquetas cortas (≤${MAX_TOPIC_LENGTH} chars).

Conversación a compactar (${trimmed.length} mensajes):
"""
${transcript}
"""

Devuelve JSON estricto siguiendo el esquema.`;
};

const sanitiseBullets = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().replace(/^[-•*]\s*/, '').replace(/\s+/g, ' ');
    if (cleaned.length < 4) continue;
    out.push(cleaned.length > MAX_BULLET_LENGTH ? `${cleaned.slice(0, MAX_BULLET_LENGTH - 1)}…` : cleaned);
  }
  return out;
};

const sanitiseTopics = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().replace(/^#+\s*/, '');
    if (cleaned.length === 0) continue;
    const capped = cleaned.length > MAX_TOPIC_LENGTH ? cleaned.slice(0, MAX_TOPIC_LENGTH) : cleaned;
    const key = capped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(capped);
    if (out.length >= 6) break;
  }
  return out;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('chat-compactor-timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/**
 * Compact a contiguous slice of chat messages into a digest. Returns `null`
 * on any failure — callers should fall back to `deterministicCompactionDigest`
 * so the feature remains useful when the API is down or quota-limited.
 */
export async function compactChatMessages(messages: ChatMessage[], settings: Settings): Promise<CompactionDigest | null> {
  if (messages.length === 0) return null;
  try {
    const modelId = resolveEffectiveModel('default', settings).id;
    // Routed through the provider-agnostic seam so OpenRouter users get their
    // selected provider. Single attempt (`maxRetries: 0` / `maxCandidates: 1`)
    // preserves the previous Gemini behaviour; failures fall back to
    // `deterministicCompactionDigest` via the `null` return below.
    const response = await withTimeout(
      aiGateway.generateContent(
        settings,
        modelId,
        buildPrompt(messages),
        {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.2,
        },
        { timeoutMs: COMPACTION_TIMEOUT_MS, maxRetries: 0, maxCandidates: 1 },
      ),
      COMPACTION_TIMEOUT_MS,
    );
    const text = response.text?.trim();
    if (!text) return null;
    let parsed: Partial<CompactionDigest>;
    try {
      parsed = JSON.parse(text) as Partial<CompactionDigest>;
    } catch {
      return null;
    }
    const title = (parsed.title ?? '').trim().slice(0, 120);
    const summary = (parsed.summary ?? '').trim().slice(0, 700);
    if (!title || !summary) return null;
    return {
      title,
      summary,
      decisions: sanitiseBullets(parsed.decisions),
      openQuestions: sanitiseBullets(parsed.openQuestions),
      topics: sanitiseTopics(parsed.topics),
    };
  } catch {
    return null;
  }
}
