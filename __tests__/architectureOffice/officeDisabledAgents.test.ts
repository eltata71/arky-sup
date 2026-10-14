/**
 * Un agente desactivado en la ficha no recibe trabajo de un encargo
 * (plan de agentes, 16.1 corte 2 · A4).
 *
 * La coordinación del dock ya los respetaba; el planificador del encargo no
 * leía `enabled`, así que un agente apagado seguía produciendo y revisando
 * entregables. Y cuando nadie habilitado puede hacer un entregable, el charter
 * lo dice en vez de dejarlo caer en silencio.
 */
import { describe, expect, it } from 'vitest';
import { assignDeliverable } from '../../services/architectureOffice/domain/OfficeAgentRouter';
import {
  planCharterDeterministic,
} from '../../services/architectureOffice/domain/OfficeEngagementPlanner';
import { applyCharterRefinement } from '../../services/architectureOffice/domain/charterRefinement';
import { findAgentsThatProduce, findAgentsThatReview } from '../../services/architectureOffice/domain/agentRegistry';
import type { OfficeAgentId } from '../../services/architectureOffice/domain/agentDefinition';

const BRIEF = 'Arquitectura AWS serverless del portal de siniestros con APIs MuleSoft y cumplimiento HIPAA';

const workers = (charter: ReturnType<typeof planCharterDeterministic>): OfficeAgentId[] =>
  charter.deliverables.flatMap((deliverable) => [deliverable.assigneeId, deliverable.reviewerId]);

describe('assignDeliverable con agentes desactivados', () => {
  it('no asigna a un desactivado ni para producir ni para revisar', () => {
    const before = assignDeliverable('mermaid-c4-deployment', BRIEF);
    expect(before?.assigneeId).toBe('felipe');
    const after = assignDeliverable('mermaid-c4-deployment', BRIEF, { unavailable: ['felipe'] });
    expect(after).not.toBeNull();
    expect([after!.assigneeId, after!.reviewerId]).not.toContain('felipe');
    const reviewer = assignDeliverable('markdown', BRIEF, { unavailable: ['elena', 'alejandro'] });
    expect(reviewer && [reviewer.assigneeId, reviewer.reviewerId]).not.toContain('elena');
  });

  it('devuelve null antes que asignar a alguien apagado cuando no queda revisor', () => {
    const type = 'mermaid-c4-deployment';
    const reviewers = findAgentsThatReview(type).map((agent) => agent.id);
    const producers = findAgentsThatProduce(type).map((agent) => agent.id);
    expect(assignDeliverable(type, BRIEF, { unavailable: [...reviewers.filter((id) => !producers.includes(id)), 'elena', 'alejandro'] })).toBeNull();
  });
});

describe('planCharterDeterministic con agentes desactivados', () => {
  it('ningún entregable queda en manos de un agente desactivado', () => {
    const unavailable: OfficeAgentId[] = ['felipe', 'mauricio'];
    const charter = planCharterDeterministic({ title: 'Portal', brief: BRIEF, unavailable });
    expect(charter.deliverables.length).toBeGreaterThan(0);
    for (const id of unavailable) {
      expect(workers(charter)).not.toContain(id);
      expect(charter.participantIds).not.toContain(id);
    }
  });

  it('lo que nadie habilitado puede hacer se dice en el charter', () => {
    const everyone = ['felipe', 'natalia', 'mauricio', 'ricardo', 'gabriel', 'elena', 'arky', 'sofia', 'daniel', 'carmen', 'tomas', 'alejandro'] as OfficeAgentId[];
    const charter = planCharterDeterministic({ title: 'Portal', brief: BRIEF, unavailable: everyone });
    expect(charter.deliverables).toEqual([]);
    expect(charter.outOfScope.length).toBeGreaterThan(0);
    expect(charter.outOfScope[0]).toContain('no hay un agente habilitado');
  });

  it('sin desactivados, el plan es el de siempre', () => {
    expect(planCharterDeterministic({ title: 'Portal', brief: BRIEF, unavailable: [] }).deliverables)
      .toEqual(planCharterDeterministic({ title: 'Portal', brief: BRIEF }).deliverables);
  });
});

describe('applyCharterRefinement con agentes desactivados', () => {
  it('descarta lo que el modelo asigne a un agente desactivado', () => {
    const scaffold = planCharterDeterministic({ title: 'Portal', brief: BRIEF, unavailable: ['felipe'] });
    const usable = scaffold.deliverables[0];
    const raw = JSON.stringify({
      deliverables: [
        { templateName: usable.templateName, assigneeId: 'felipe', reviewerId: usable.reviewerId },
        { templateName: usable.templateName, assigneeId: usable.assigneeId, reviewerId: usable.reviewerId },
      ],
    });
    const { charter } = applyCharterRefinement(scaffold, raw, { unavailable: ['felipe'] });
    expect(workers(charter)).not.toContain('felipe');
  });
});
