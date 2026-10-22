import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFullSpanish } from '../../lib/i18n/spanishStore';
import { translate } from '../../lib/i18n/translate';
import { en } from '../../lib/i18n/locales/en';
import type { BusinessInitiative } from '../../services/businessInitiatives';
import type { Project } from '../../services/architectureProjects';
import type { Settings } from '../../types';
import { runCopilotOrchestration } from '../../services/architectureOffice/application/copilotTurn';
import { coordinateRequest, type CoordinationEvent } from '../../services/architectureOffice/application/officeCoordination';
import { buildCoordinationInvoker } from '../../services/architectureOffice/application/officeCoordinationInvoker';
import { buildProjectScope } from '../../services/architectureOffice/application/assistantConsultation';
import { chatWithProjectMeasured } from '../../services/architectureOffice/application/projectConversation';
import { configuredModelTiers, disabledAgentIds, resolveAgentProfiles } from '../../services/architectureOffice/domain/officeAgentProfile';

vi.mock('../../lib/ids', () => ({ newPrefixedId: (prefix: string) => `${prefix}_fixed` }));
const transport = vi.hoisted(() => ({ mode: 'valid', calls: [] as unknown[][] }));
vi.mock('../../services/architectureOffice/application/projectConversation', () => {
  const reply = async (...args: unknown[]) => {
    transport.calls.push(args);
    const id = args[4];
    if (id === 'lucia' && transport.mode === 'failed') throw new Error('proveedor no disponible');
    const text = id === 'lucia'
      ? JSON.stringify({ summary: 'Analizar AWS', order: [], dependencies: [], dropWorkstreams: [], extraConstraints: [] })
      : id === 'alejandro'
        ? transport.mode === 'unresolved' ? 'Texto sin veredicto.' : JSON.stringify({
          verdict: 'ready', rationale: 'Evidencia suficiente.', contributions: [{ agent: 'felipe', use: 'used', note: 'AWS' }],
          contradictions: [], conditions: [], openQuestions: [],
        })
        : JSON.stringify({ summary: 'Análisis AWS', findings: [], assumptions: [], risks: [], decisions: [], outOfScope: [], evidence: [], confidence: 'high' });
    return { text, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: null, latencyMs: 5, traceId: 'trace-test', estimatedCostUsd: null };
  };
  return { chatWithProjectMeasured: vi.fn(reply), chatWithProject: vi.fn(async (...args: unknown[]) => (await reply(...args)).text) };
});

const project: Project = {
  id: 'p1', name: 'Portal', description: 'Portal AWS', projectContext: ['Sin datos clínicos'], artifacts: [],
  createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', initiativeIds: ['i1'],
};
const settings = { aiConfig: {} } as Settings;
const profiles = resolveAgentProfiles().map((profile) => ({
  ...profile,
  alias: profile.agentId === 'felipe' ? 'Nube propia' : profile.alias,
  enabled: profile.agentId !== 'carmen',
  modelTier: 'deep' as const,
}));
const nameOf = (id: string): string => profiles.find((profile) => profile.agentId === id)!.alias;
const request = 'Lucía, coordina la arquitectura AWS y el cumplimiento HIPAA';

beforeAll(() => ensureFullSpanish());
beforeEach(() => { transport.mode = 'valid'; transport.calls = []; vi.clearAllMocks(); });

describe('16.3 · dock y copiloto usan la misma coordinación', () => {
  it('mismas fichas y now producen el mismo equipo, prompts, tiers y eventos', async () => {
    const scope = buildProjectScope(project, []);
    const dock = await coordinateRequest({
      request, scope, now: () => 42, agentName: nameOf,
      unavailableAgents: disabledAgentIds(profiles),
      invoke: buildCoordinationInvoker({
        chat: (carrier, message, history, currentSettings, persona, tier, profile, options) =>
          chatWithProjectMeasured(carrier, message, history, currentSettings, persona as never, tier, profile, options),
        settings, scope, project, profiles, modelTiers: configuredModelTiers(profiles),
      }),
    });
    const dockCalls = transport.calls.map((call) => call.slice(0, 7));
    transport.calls = [];
    const events: CoordinationEvent[] = [];
    const summary = await runCopilotOrchestration(request, project, settings, profiles, { now: () => 42, onEvent: (event) => events.push(event) });
    expect(events).toEqual(dock.events);
    expect(transport.calls.map((call) => call.slice(0, 7))).toEqual(dockCalls);
    expect(transport.calls.map((call) => call[4])).not.toContain('carmen');
    expect(vi.mocked(chatWithProjectMeasured)).toHaveBeenCalled();
    expect(summary).toContain('Nube propia');
    expect(summary).toContain('Handoffs rechazados: 0');
    expect(summary).toContain('Evaluador: sin salvedades');
    expect(summary).toContain(dock.answer);
  });

  it('muestra cada rechazo de presupuesto y no inventa una evaluación', async () => {
    const summary = await runCopilotOrchestration(request, project, settings, profiles, { maxAiCalls: 1 });
    expect(transport.calls).toHaveLength(1);
    expect(summary).toContain('Handoffs rechazados:');
    expect(summary).toContain('budget-exhausted');
    expect(summary).toContain('Lucía → Nube propia');
    expect(summary).toContain('Evaluador: sin evaluar');
  });

  it('informa la corrección y las salvedades que siguen abiertas', async () => {
    transport.mode = 'unresolved';
    const summary = await runCopilotOrchestration(request, project, settings, profiles);
    expect(summary).toContain('Evaluador: con salvedades');
    expect(summary).toContain('Corrección: aplicada');
    expect(transport.calls.filter((call) => call[4] === 'alejandro')).toHaveLength(2);
    expect(summary).toContain('veredicto');
  });

  it('un fallo de coordinación sigue visible y no firma una recomendación', async () => {
    transport.mode = 'failed';
    const summary = await runCopilotOrchestration(request, project, settings, profiles);
    expect(transport.calls).toHaveLength(1);
    expect(summary).toContain('FAILED');
    expect(summary).toContain('Evaluador: sin evaluar');
    expect(summary).toContain('falló');
  });

  it('una cancelación previa no gasta llamadas', async () => {
    const controller = new AbortController();
    controller.abort();
    const summary = await runCopilotOrchestration(request, project, settings, profiles, { signal: controller.signal });
    expect(transport.calls).toHaveLength(0);
    expect(summary).toContain('FAILED');
  });

  it('propaga ascendencia, esquemas y controles por el invocador medido, sin volver al chat sin medición', async () => {
    const initiatives = [{ id: 'i1', title: 'Motivación enlazada', need: 'Reducir el tiempo de respuesta' }] as BusinessInitiative[];
    await runCopilotOrchestration(request, project, settings, profiles, { initiatives, timeoutMs: 2_000 });
    expect(transport.calls.length).toBeGreaterThan(0);
    for (const call of transport.calls) {
      expect(call[0]).toBe(project);
      expect(call[1]).toContain('Motivación enlazada');
      expect(call[1]).toContain('Reducir el tiempo de respuesta');
      expect(call[5]).toBe('deep');
      expect(call[7]).toMatchObject({ signal: expect.any(AbortSignal), timeoutMs: 2_000, responseSchema: expect.any(Object) });
    }
    const { chatWithProject } = await import('../../services/architectureOffice/application/projectConversation');
    expect(chatWithProject).not.toHaveBeenCalled();
  });

  it('localiza el resumen sin alterar la respuesta de la coordinación', async () => {
    const summary = await runCopilotOrchestration(request, project, settings, profiles, {
      t: (key, replacements) => translate({ en }, 'en', key, replacements),
    });
    expect(summary).toContain('Team convened:');
    expect(summary).toContain('Rejected handoffs: 0');
    expect(summary).toContain('Evaluator: no caveats');
    expect(summary).not.toContain('copilot.');
    expect(summary).toContain('Evidencia suficiente.');
  });
});
