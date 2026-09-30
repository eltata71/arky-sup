/**
 * Una decisión dicha en el chat se ofrece como memoria del proyecto (plan de
 * calidad de artefactos, 7.3b): con el borrador ya relleno, y sin escribir
 * nada hasta que la persona confirme.
 */
import { describe, expect, it } from 'vitest';
import type { Project } from '../../architectureProjects';
import { offerDecisionsAsMemory } from '../decisionMemoryOffer';

const project = (projectContext: string[] = []): Project => ({
  id: 'p1',
  name: 'Autorización previa',
  description: '',
  projectContext,
  agentMemory: [],
  artifacts: [],
} as unknown as Project);

describe('offerDecisionsAsMemory', () => {
  it('proposes a project-memory plan whose draft is the decision, ready to confirm', () => {
    const offer = offerDecisionsAsMemory('Acordamos que el canal de prestadores queda fuera de la fase 1.', project());
    expect(offer?.plan.intent.type).toBe('memory.save.project');
    expect(offer?.plan.intent.requiresConfirmation).toBe(true);
    expect(offer?.draft).toEqual({
      scope: 'project',
      bullets: ['Acordamos que el canal de prestadores queda fuera de la fase 1.'],
      status: 'ready',
    });
  });

  it('offers nothing when no decision was stated', () => {
    expect(offerDecisionsAsMemory('¿Qué opinas de usar Kafka?', project())).toBeNull();
  });

  it('offers nothing the project already remembers', () => {
    const remembered = project(['Acordamos que el canal de prestadores queda fuera de la fase 1']);
    expect(offerDecisionsAsMemory('Acordamos que el canal de prestadores queda fuera de la fase 1.', remembered)).toBeNull();
  });
});
