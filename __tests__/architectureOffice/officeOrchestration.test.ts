import { describe, expect, it, vi } from 'vitest';
import {
  executeOfficeOrchestration,
  isOfficeOrchestrationRequest,
  planOfficeWorkstreams,
} from '../../services/architectureOffice/officeOrchestration';
import { rankPersonasForBrief } from '../../services/architectureOffice/OfficeAgentRouter';
import { canTakeWorkstream } from '../../services/architectureOffice/agentRegistry';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';

describe('officeOrchestration', () => {
  it('routes a Lucia request to the relevant independent specialists', () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS, MuleSoft y seguridad para el proyecto');
    expect(plan.coordinatorId).toBe('lucia');
    expect(plan.consolidatorId).toBe('alejandro');
    expect(plan.workstreams.map((workstream) => workstream.personaId)).toEqual(
      expect.arrayContaining(['felipe', 'mauricio', 'elena']),
    );
    expect(new Set(plan.workstreams.map((workstream) => workstream.personaId)).size)
      .toBe(plan.workstreams.length);
  });

  /**
   * The defect this replaces: `officeOrchestration` kept its own `ROUTING_RULES`
   * table, a stale copy of the router's `DOMAIN_SIGNALS`. The router had learned
   * that "Health Cloud" is a Salesforce product and must not reach the AWS
   * architect; the copy had not. The same sentence therefore convened a
   * different specialist depending on which path handled it.
   */
  it('routes a brief the same way as the deliverable path — one table, one answer', () => {
    for (const brief of [
      'Modelo de datos en Health Cloud para pólizas de salud',
      'Configurar Financial Services Cloud para pólizas de vida',
      'Desplegar la solución en la nube con EKS y control de costos',
      'Migrar el AS/400 de siniestros y exponer APIs con MuleSoft',
    ]) {
      const viaRouter = rankPersonasForBrief(brief)
        .map((signal) => signal.personaId)
        .filter((id) => canTakeWorkstream(OFFICE_AGENT_PERSONAS[id]));
      const viaCoordination = planOfficeWorkstreams(brief, { maxSpecialists: 99 })
        .workstreams.map((workstream) => workstream.personaId);
      expect(viaCoordination, `divergen para: ${brief}`).toEqual(viaRouter);
    }
  });

  it('does not send a Salesforce product cloud to the AWS architect', () => {
    const plan = planOfficeWorkstreams('Modelo de datos en Health Cloud para pólizas de salud');
    expect(plan.workstreams.map((workstream) => workstream.personaId)).not.toContain('felipe');
  });

  /**
   * Criterion 11 for the coordination path. The deliverable path has always had
   * it through `producesArtifactTypes`; here a regex match was enough to be
   * handed a workstream.
   */
  it('never convenes a persona that cannot take a workstream', () => {
    const briefs = [
      'Coordina y orquesta AWS, MuleSoft, datos y cumplimiento',
      'Consolida el resultado del encargo completo',
      'hola',
    ];
    for (const brief of briefs) {
      for (const workstream of planOfficeWorkstreams(brief, { maxSpecialists: 99 }).workstreams) {
        const persona = OFFICE_AGENT_PERSONAS[workstream.personaId];
        expect(persona.orchestrationRole, `${persona.id} no es especialista`).toBe('participant');
        expect(persona.capabilities).toContain('consult');
      }
    }
  });

  it('prefers any enabled specialist over one the user switched off', () => {
    // Switching off the three fallback names must not force the Office to
    // convene one of them anyway while other specialists are available.
    const plan = planOfficeWorkstreams('hola', {
      unavailable: ['gabriel', 'elena', 'tomas'],
    });
    expect(plan.workstreams.length).toBeGreaterThan(0);
    expect(plan.workstreams.map((w) => w.personaId)).not.toContain('gabriel');
    expect(plan.workstreams.map((w) => w.personaId)).not.toContain('elena');
    expect(plan.workstreams.map((w) => w.personaId)).not.toContain('tomas');
  });

  it('distinguishes orchestration commands from ordinary Lucia questions', () => {
    expect(isOfficeOrchestrationRequest('@Lucía coordina el diseño completo')).toBe(true);
    expect(isOfficeOrchestrationRequest('@Lucía ¿qué workstreams recomiendas?')).toBe(false);
  });

  it('waits for all specialist workstreams before invoking Alejandro', async () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS y MuleSoft');
    const events: string[] = [];
    const invoke = vi.fn(async (personaId: string) => {
      events.push(`start:${personaId}`);
      await Promise.resolve();
      events.push(`end:${personaId}`);
      return `resultado-${personaId}`;
    });

    const result = await executeOfficeOrchestration(plan, invoke);

    expect(result.workstreamResults).toHaveLength(plan.workstreams.length);
    const alejandroStart = events.indexOf('start:alejandro');
    const participantEnds = plan.workstreams.map((workstream) => events.indexOf(`end:${workstream.personaId}`));
    expect(alejandroStart).toBeGreaterThan(Math.max(...participantEnds));
    expect(result.consolidation).toBe('resultado-alejandro');
    expect(result.status).toBe('completed');
  });

  it('invokes Lucia as the coordinator model before any specialist', async () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS y MuleSoft');
    const events: string[] = [];
    const invoke = vi.fn(async (personaId: string) => {
      events.push(personaId);
      return `resultado-${personaId}`;
    });

    const result = await executeOfficeOrchestration(plan, invoke);

    expect(events[0]).toBe('lucia');
    expect(result.coordination).toBe('resultado-lucia');
    expect(events.indexOf('alejandro')).toBeGreaterThan(events.indexOf('mauricio'));
  });

  it('bounds specialist concurrency to protect provider quotas', async () => {
    const plan = planOfficeWorkstreams('@Lucía coordina AWS, Salesforce, MuleSoft, AS400, software, seguridad y proyecto');
    let active = 0;
    let peak = 0;
    const invoke = vi.fn(async (personaId: string) => {
      if (personaId === 'lucia' || personaId === 'alejandro') return `resultado-${personaId}`;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return `resultado-${personaId}`;
    });

    await executeOfficeOrchestration(plan, invoke, { maxConcurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
  });
});
