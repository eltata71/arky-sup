/**
 * The decisions a conversation with the agent settled, read without a model
 * (plan de calidad de artefactos, 7.3b).
 *
 * A decision said in the chat — «acordamos que el canal de prestadores queda
 * fuera de la primera fase» — reached the next generation only if somebody
 * wrote «guarda esto», and the chat history the agent reads is off by default.
 * So the artifact generated the next minute contradicted what was agreed a
 * minute before, and the person reads that as the product not listening.
 *
 * This reads the conversation for sentences that **say** a decision was taken,
 * by their wording, and hands them over most recent first. Two things it
 * deliberately does not do:
 *
 * - **It does not call a model.** It runs on every generation and every chat
 *   turn; a call there costs latency and money on the most frequent path, and
 *   fails when the provider is down.
 * - **It does not infer.** A sentence that proposes («¿y si usamos Kafka?») is
 *   not a decision. Only an explicit agreement counts; a missed decision costs
 *   less than an invented one presented as agreed.
 */
import type { ArtifactConversationDigest } from '../../lib/artifacts';
import type { ChatMessage } from './ChatTypes';

/** How many decisions a digest keeps, and how long each may be. */
const MAX_DECISIONS = 8;
const MAX_DECISION_CHARS = 280;
/** How far back a conversation is read, in messages. */
const LOOKBACK_MESSAGES = 60;

/**
 * The wording of an explicit decision, in Spanish and English. A verb of
 * agreement or choice in the first person, or a scope statement.
 */
const DECISION_CUES = new RegExp(
  [
    '\\b(acordamos|acordado|acord[eé]|decidimos|decidido|decid[ií]|elegimos|optamos|aprobamos|aprobado|confirmamos|confirmado)\\b',
    '\\b(descartamos|descartado|descartada)\\b',
    '\\b(usaremos|utilizaremos|adoptaremos|implementaremos|mantendremos|conservaremos)\\b',
    '\\bqueda(n)?\\s+(fuera|dentro|exclu[ií]d[oa]s?|inclu[ií]d[oa]s?|descartad[oa]s?|aprobad[oa]s?)\\b',
    '\\b(no\\s+(vamos\\s+a|se\\s+va\\s+a)\\s+(usar|incluir|migrar|tocar))\\b',
    '\\b(we|i)\\s+(decided|agreed|chose|will\\s+use|will\\s+keep)\\b',
    '\\b(agreed|decided)\\s+(that|to|on)\\b',
  ].join('|'),
  'i',
);

const sentencesOf = (text: string): string[] =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^[-*•>\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 12);

const cap = (sentence: string): string =>
  sentence.length <= MAX_DECISION_CHARS ? sentence : `${sentence.slice(0, MAX_DECISION_CHARS - 1).trimEnd()}…`;

const normalize = (sentence: string): string =>
  sentence.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The decisions stated in a conversation, most recent first. Reads what people
 * wrote and the compaction markers that replaced older turns; a model's reply
 * is advice, not a decision, and is not read.
 */
export function extractConversationDecisions(messages: readonly ChatMessage[] | null | undefined): ArtifactConversationDigest {
  const recent = (messages ?? []).slice(-LOOKBACK_MESSAGES);
  const seen = new Set<string>();
  const decisions: string[] = [];
  for (let index = recent.length - 1; index >= 0 && decisions.length < MAX_DECISIONS; index -= 1) {
    const message = recent[index];
    const readable = message.role === 'user' || message.meta?.kind === 'compaction';
    if (!readable || typeof message.content !== 'string') continue;
    const sentences = sentencesOf(message.content).filter((sentence) => DECISION_CUES.test(sentence) && !sentence.endsWith('?'));
    // Within a message, keep its own order; across messages, the latest first.
    for (const sentence of sentences) {
      const key = normalize(sentence);
      if (seen.has(key)) continue;
      seen.add(key);
      decisions.push(cap(sentence));
      if (decisions.length >= MAX_DECISIONS) break;
    }
  }
  return { decisions };
}
