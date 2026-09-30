/**
 * Las decisiones de una conversación, leídas sin modelo (plan de calidad de
 * artefactos, 7.3b): sólo lo acordado de forma explícita, lo más reciente
 * primero, y nunca lo que el agente aconsejó.
 */
import { describe, expect, it } from 'vitest';
import { extractConversationDecisions } from '../conversationDecisions';
import type { ChatMessage } from '../ChatTypes';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const model = (content: string): ChatMessage => ({ role: 'model', content });

describe('extractConversationDecisions', () => {
  it('keeps what was explicitly agreed, most recent first', () => {
    const digest = extractConversationDecisions([
      user('Acordamos que el canal de prestadores queda fuera de la primera fase.'),
      model('Entendido.'),
      user('Decidimos usar mensajería gestionada para las autorizaciones.'),
    ]);
    expect(digest.decisions).toEqual([
      'Decidimos usar mensajería gestionada para las autorizaciones.',
      'Acordamos que el canal de prestadores queda fuera de la primera fase.',
    ]);
  });

  it('does not read a proposal, a question or the agent’s own advice as a decision', () => {
    const digest = extractConversationDecisions([
      user('¿Y si usamos Kafka para los eventos?'),
      model('Te recomiendo que decidimos usar Kafka; acordamos esto en otros proyectos.'),
      user('Revisa el documento de riesgos por favor.'),
    ]);
    expect(digest.decisions).toEqual([]);
  });

  it('reads scope statements and English wording too', () => {
    const digest = extractConversationDecisions([
      user('El módulo de pagos queda excluido del alcance.'),
      user('We decided to keep the AS/400 policy core and expose it by API.'),
    ]);
    expect(digest.decisions).toHaveLength(2);
  });

  it('reads the compaction markers that replaced older turns', () => {
    const marker: ChatMessage = {
      role: 'model',
      content: 'Decidimos conservar el core de pólizas AS/400.',
      meta: { kind: 'compaction', compactedCount: 30 },
    };
    expect(extractConversationDecisions([marker]).decisions).toEqual(['Decidimos conservar el core de pólizas AS/400.']);
  });

  it('never repeats a decision said twice, and keeps at most eight', () => {
    const repeated = Array.from({ length: 12 }, (_, i) => user(`Acordamos el punto número ${i} del alcance.`));
    const digest = extractConversationDecisions([user('Acordamos usar OAuth 2.0.'), user('acordamos usar oauth 2.0'), ...repeated]);
    expect(digest.decisions).toHaveLength(8);
    expect(new Set(digest.decisions).size).toBe(8);
  });

  it('tolerates an empty or missing history', () => {
    expect(extractConversationDecisions(undefined).decisions).toEqual([]);
    expect(extractConversationDecisions([]).decisions).toEqual([]);
  });
});
