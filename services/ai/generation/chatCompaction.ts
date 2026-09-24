/**
 * Chat compaction: a model turns a slice of conversation into a digest (F5-03).
 *
 * Given a contiguous slice of chat history, asks the model for a structured
 * digest the Memory Center persists as a single "compaction marker" in place
 * of the originals, keeping decisions and open questions at a fraction of the
 * token and storage footprint.
 *
 * It lived in `services/chat` until F5-03 and was that module's only import of
 * the AI layer — which put chat *above* AI, while the project aggregate, below
 * AI, writes chat history. That was the edge that kept thirteen domain modules
 * mutually reachable. Compaction is a generation, so it lives with the others,
 * and reads the conversation through the shape it needs (`CompactableTurn`)
 * rather than importing the chat module back.
 *
 * Design:
 *  - Strict JSON schema so the UI never has to parse free-form output.
 *  - 12s timeout, single attempt. Never throws — returns `null` on failure
 *    and the caller falls back to `deterministicCompactionDigest`
 *    (`services/chat`), which needs no model.
 */

import type { Settings } from '../../../types';
import type { CompactionDigest } from '../../../lib/conversationDigest';
import { resolveEffectiveModel } from '../../../lib/ai/modelCatalog';
import { aiGateway } from './aiGateway';

/** What compaction reads from a chat message. */
export interface CompactableTurn {
  readonly role: string;
  readonly content: string;
}

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

const buildPrompt = (messages: readonly CompactableTurn[]): string => {
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
export async function compactChatMessages(messages: readonly CompactableTurn[], settings: Settings): Promise<CompactionDigest | null> {
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
