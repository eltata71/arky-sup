/**
 * El sello del prompt llega a donde se lee una ejecución (plan de agentes, 15.1).
 *
 * Un sello que se calcula y no se guarda no sirve para comparar nada: estas
 * pruebas siguen el sello desde la orquestación hasta los eventos de la
 * coordinación, y desde el runner hasta la tarea del encargo, incluida la
 * recarga, porque el normalizador reconstruye las tareas campo a campo y lo que
 * no nombra se pierde.
 */
import { describe, expect, it } from 'vitest';
import { parsePromptStamp } from '../../lib/agents/promptCatalog';
import { coordinateRequest } from '../../services/architectureOffice/application/officeCoordination';
import {
  executeOfficeOrchestration,
  planOfficeWorkstreams,
} from '../../services/architectureOffice/application/officeOrchestration';
import { withTaskTrace } from '../../services/architectureOffice/application/officeRunnerState';
import { normalizeEngagement } from '../../services/architectureOffice/domain/officeEngagementRecord';
import type { OfficeTask } from '../../services/architectureOffice/domain/OfficeTypes';

const CONSOLIDATION = 'Veredicto: Ready. Felipe y Sofía aportan su dominio. '.padEnd(260, '.');

const idsOf = (stamps: readonly (string | undefined)[]): (string | undefined)[] =>
  stamps.map((stamp) => (stamp ? parsePromptStamp(stamp)?.id : undefined));

describe('la orquestación sella cada invocación', () => {
  it('pasa el sello al invocador y lo devuelve en orden', async () => {
    const plan = planOfficeWorkstreams('Arquitectura AWS del portal de siniestros de pólizas');
    const received: (string | undefined)[] = [];
    const result = await executeOfficeOrchestration(plan, async (personaId, _instruction, stamp) => {
      received.push(stamp);
      return personaId === plan.consolidatorId ? CONSOLIDATION : 'Análisis.';
    }, { maxConsolidationRefinements: 0 });

    expect(result.promptStamps).toEqual(received);
    expect(idsOf(received)).toEqual([
      ...plan.workstreams.map(() => 'office.workstream'),
      'office.consolidation',
    ]);
  });

  it('sella la corrección del consolidador con su propia plantilla', async () => {
    const plan = planOfficeWorkstreams('Arquitectura AWS');
    let consolidations = 0;
    const result = await executeOfficeOrchestration(plan, async (personaId) => {
      if (personaId !== plan.consolidatorId) return 'Análisis.';
      consolidations += 1;
      return consolidations === 1 ? 'Sin veredicto.' : CONSOLIDATION;
    });
    expect(idsOf(result.promptStamps ?? []).at(-1)).toBe('office.consolidation-refinement');
  });
});

describe('la coordinación registra el sello en sus eventos', () => {
  it('los eventos que cierran una llamada a un agente dicen con qué prompt', async () => {
    const outcome = await coordinateRequest({
      request: 'Arquitectura AWS del portal',
      scope: { level: 'project', id: 'p-1', name: 'Portal', briefing: ['Pagos más rápidos.'] },
      invoke: async (personaId) => (personaId === 'alejandro' ? CONSOLIDATION : 'Análisis.'),
      now: () => 0,
    });
    const closing = outcome.events.filter((event) => event.kind === 'agent-reported' || event.kind === 'recommendation');
    expect(closing.length).toBeGreaterThan(0);
    for (const event of closing) expect(parsePromptStamp(event.prompt ?? ''), event.summary).not.toBeNull();
  });
});

describe('la tarea del encargo guarda sus sellos', () => {
  const task: OfficeTask = {
    id: 'produce-1',
    engagementId: 'eng-1',
    kind: 'produce-artifact',
    title: 'Contenedores',
    objective: '',
    assigneeId: 'felipe',
    dependsOn: [],
    acceptanceCriteria: [],
    status: 'ready',
    attempts: 0,
    maxAttempts: 2,
  };

  it('withTaskTrace añade el sello junto al traceId, uno por intento', () => {
    const once = withTaskTrace(task, 'trace-1', 'office.production@v1#0000abcd');
    const twice = withTaskTrace(once, 'trace-2', 'office.production@v1#1111abcd');
    expect(twice.traceIds).toEqual(['trace-1', 'trace-2']);
    expect(twice.promptStamps).toEqual(['office.production@v1#0000abcd', 'office.production@v1#1111abcd']);
    expect(withTaskTrace(task, 'trace-1').promptStamps).toBeUndefined();
  });

  it('los sellos sobreviven a la recarga del encargo', () => {
    const stored = {
      id: 'eng-1',
      title: 'Portal',
      brief: 'Brief.',
      status: 'in-progress',
      tasks: [{ ...task, promptStamps: ['office.production@v1#0000abcd'] }],
    };
    const restored = normalizeEngagement(stored, 'proj-1');
    expect(restored?.tasks[0].promptStamps).toEqual(['office.production@v1#0000abcd']);
  });

  it('la revisión de la consolidación sobrevive a la recarga y descarta formas inválidas', () => {
    const stored = (consolidationReview: unknown) => ({
      id: 'eng-1',
      title: 'Portal',
      brief: 'Brief.',
      status: 'in-progress',
      tasks: [{ ...task, consolidationReview }],
    });
    const ok = normalizeEngagement(stored({ ok: true, gaps: [], refined: true }), 'proj-1');
    expect(ok?.tasks[0].consolidationReview).toEqual({ ok: true, gaps: [], refined: true });
    const bad = normalizeEngagement(stored({ gaps: ['x'] }), 'proj-1');
    expect(bad?.tasks[0].consolidationReview).toBeUndefined();
  });
});
