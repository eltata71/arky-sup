import type { AgentHandoffEnvelope, HandoffRejection } from '../domain/agentHandoff';
import type { OfficeAgentInvoker } from './officeOrchestration';

export class HandoffBudgetExhausted extends Error {
  readonly rejection: HandoffRejection = {
    code: 'budget-exhausted',
    message: 'El presupuesto de llamadas o tokens de este handoff se agotó.',
  };

  constructor() {
    super('El presupuesto de llamadas o tokens de este handoff se agotó.');
    this.name = 'HandoffBudgetExhausted';
  }
}

/** Shares one counter across every turn of a handoff. Unreported token usage
 * remains unknown; the call ceiling still prevents unlimited work. */
export const withHandoffBudget = (
  invoke: OfficeAgentInvoker,
  envelope: Pick<AgentHandoffEnvelope, 'budget'>,
): OfficeAgentInvoker => {
  let calls = 0;
  let tokens = 0;
  return async (personaId, instruction, promptStamp, callOptions) => {
    if (calls >= envelope.budget.maxAiCalls || (envelope.budget.maxTokens !== undefined
      && tokens >= envelope.budget.maxTokens)) {
      throw new HandoffBudgetExhausted();
    }
    calls += 1;
    const result = await invoke(personaId, instruction, promptStamp, callOptions);
    if (typeof result !== 'string') {
      calls += Math.max(0, (result.aiCalls ?? 1) - 1);
      if (result.usage?.totalTokens !== undefined) tokens += result.usage.totalTokens;
    }
    return result;
  };
};
