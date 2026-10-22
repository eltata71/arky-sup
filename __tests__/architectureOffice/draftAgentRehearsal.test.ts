import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_REHEARSAL_CARRIER_PREFIX,
  createDraftAgentRehearsal,
  markInstructionLayers,
  sampleQuestionsFor,
  type DraftAgentRehearsalDeps,
} from '../../services/architectureOffice/application/draftAgentRehearsal';
import { AGENT_PROMPT_LAYERS } from '../../services/architectureOffice/domain/agentPromptComposer';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
import { resolveAgentProfile } from '../../services/architectureOffice/domain/officeAgentProfile';
import type { Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';

const settings = {} as Settings;

/** Un borrador con algo que la organización escribió, para ver las capas. */
const draft = {
  agentId: 'sofia' as const,
  alias: 'Sofía Broker',
  knowledge: ['El canal de corredores corre sobre AS/400.'],
};

/** El carrier debe ser un sobre de prompt, nunca un proyecto almacenado. */
const assertCarrier = (carrier: Project): void => {
  expect(carrier.id.startsWith(DRAFT_REHEARSAL_CARRIER_PREFIX)).toBe(true);
  expect(carrier.artifacts).toEqual([]);
};

describe('markInstructionLayers', () => {
  it('marca el contexto, el contrato, la organización y las reglas', () => {
    const instruction = [
      'Contexto del proyecto.',
      '',
      AGENT_PROMPT_LAYERS.contract,
      'Eres Sofía, consultora.',
      AGENT_PROMPT_LAYERS.organization,
      'Canal de corredores sobre AS/400.',
      '',
      AGENT_PROMPT_LAYERS.rules,
      'No inventes evidencia.',
    ].join('\n');
    const layers = markInstructionLayers(instruction);
    expect(layers.map((layer) => layer.id)).toEqual(['contexto', 'contrato', 'organizacion', 'reglas']);
    expect(layers[0]?.text).toBe('Contexto del proyecto.');
    expect(layers[1]?.header).toBe(AGENT_PROMPT_LAYERS.contract);
    expect(layers[1]?.text).toContain('Eres Sofía');
    expect(layers[2]?.header).toBe(AGENT_PROMPT_LAYERS.organization);
    expect(layers[2]?.text).toContain('AS/400');
    expect(layers[3]?.header).toBe(AGENT_PROMPT_LAYERS.rules);
    expect(layers[3]?.text).toContain('No inventes');
  });

  it('reconstruye el texto completo al unir las capas', () => {
    const voice = [
      AGENT_PROMPT_LAYERS.contract,
      'Eres Sofía.',
      AGENT_PROMPT_LAYERS.organization,
      'Conocimiento vallado.',
      '',
      AGENT_PROMPT_LAYERS.rules,
      'Reglas.',
    ].join('\n');
    const layers = markInstructionLayers(voice);
    expect(layers.map((layer) => layer.id)).toEqual(['contrato', 'organizacion', 'reglas']);
    expect(layers.map((layer) => layer.text).join('\n')).toBe(voice);
  });
});

describe('createDraftAgentRehearsal — previewInstruction', () => {
  it('compone con la misma función que una conversación real, sobre el borrador', async () => {
    const composeInstruction = vi.fn(async (_carrier: Project, _q: string, _s: Settings, persona: string, profile: unknown) => {
      expect(persona).toBe('sofia');
      const resolved = profile as { alias?: string; knowledge?: string[] };
      expect(resolved.alias).toBe('Sofía Broker');
      expect(resolved.knowledge).toContain('El canal de corredores corre sobre AS/400.');
      return `BASE\n\n${AGENT_PROMPT_LAYERS.contract}\nEres Sofía.\n${AGENT_PROMPT_LAYERS.rules}\nReglas.`;
    });
    const deps: DraftAgentRehearsalDeps = {
      composeInstruction,
      chat: vi.fn(async () => ({ text: '', model: null, usage: null, latencyMs: 0, traceId: null, estimatedCostUsd: null })),
    };
    const service = createDraftAgentRehearsal(deps);
    const preview = await service.previewInstruction(draft, settings);
    assertCarrier(composeInstruction.mock.calls[0]?.[0] as Project);
    // El texto mostrado es exactamente el que se enviaría: una sola fuente.
    expect(preview.instruction).toBe(
      `BASE\n\n${AGENT_PROMPT_LAYERS.contract}\nEres Sofía.\n${AGENT_PROMPT_LAYERS.rules}\nReglas.`,
    );
    expect(preview.layers.map((layer) => layer.id)).toEqual(['contexto', 'contrato', 'reglas']);
  });

  it('sin instrucción de la organización la capa organizativa no aparece', async () => {
    const deps: DraftAgentRehearsalDeps = {
      composeInstruction: vi.fn(async () =>
        `BASE\n\n${AGENT_PROMPT_LAYERS.contract}\nEres Sofía.\n${AGENT_PROMPT_LAYERS.rules}\nReglas.`),
      chat: vi.fn(async () => ({ text: '', model: null, usage: null, latencyMs: 0, traceId: null, estimatedCostUsd: null })),
    };
    const service = createDraftAgentRehearsal(deps);
    const preview = await service.previewInstruction({ agentId: 'sofia' }, settings);
    expect(preview.layers.map((layer) => layer.id)).toEqual(['contexto', 'contrato', 'reglas']);
  });
});

describe('sampleQuestions', () => {
  it('devuelve tres preguntas por rol, la última fuera de alcance', () => {
    const service = createDraftAgentRehearsal({
      composeInstruction: vi.fn(async () => ''),
      chat: vi.fn(async () => ({ text: '', model: null, usage: null, latencyMs: 0, traceId: null, estimatedCostUsd: null })),
    });
    for (const agentId of Object.keys(OFFICE_AGENT_PERSONAS)) {
      const questions = service.sampleQuestions(agentId as keyof typeof OFFICE_AGENT_PERSONAS);
      expect(questions.length).toBe(3);
      expect(questions[0]?.kind).toBe('in-scope');
      expect(questions[1]?.kind).toBe('work');
      expect(questions[2]?.kind).toBe('out-of-scope');
    }
  });

  it('las preguntas vienen del contrato de fábrica, no de la ficha', () => {
    const profile = resolveAgentProfile('sofia');
    const questions = sampleQuestionsFor('sofia');
    expect(questions[0]?.text).toContain(profile.scope.goals[0]);
    expect(questions[2]?.text).toContain(profile.scope.nonGoals[0]);
  });
});

describe('createDraftAgentRehearsal — rehearse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ensaya con el borrador, sin guardar, y devuelve la respuesta medida', async () => {
    const chat = vi.fn(async (carrier: Project, question: string, _s: Settings, persona: string, tier: string) => {
      expect(question).toBe('¿Cómo abordarías este encargo?');
      expect(persona).toBe('sofia');
      expect(tier).toBe('deep');
      assertCarrier(carrier);
      return {
        text: 'Respuesta de prueba.',
        model: 'gemini-2.5-pro',
        usage: { promptTokens: 10_000, completionTokens: 1_000 },
        latencyMs: 1_500,
        traceId: 'trace-1',
        estimatedCostUsd: null,
      };
    });
    const deps: DraftAgentRehearsalDeps = {
      composeInstruction: vi.fn(async () => ''),
      chat,
    };
    const service = createDraftAgentRehearsal(deps);
    const result = await service.rehearse({
      question: '¿Cómo abordarías este encargo?',
      draft: { ...draft, modelTier: 'deep' },
      settings,
    });
    expect(result.answer).toBe('Respuesta de prueba.');
    expect(result.tier).toBe('deep');
    expect(result.model).toBe('gemini-2.5-pro');
    expect(result.latencyMs).toBe(1_500);
    // (10000 * 1.25 + 1000 * 10) / 1e6 = 0.0225
    expect(result.estimatedCostUsd).toBeCloseTo(0.0225, 5);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('sin tier en la ficha, el ensayo usa el tier por defecto', async () => {
    const chat = vi.fn(async (_carrier: Project, _q: string, _s: Settings, _persona: string, tier: string) => {
      expect(tier).toBe('default');
      return { text: 'Ok.', model: null, usage: null, latencyMs: 0, traceId: null, estimatedCostUsd: null };
    });
    const service = createDraftAgentRehearsal({
      composeInstruction: vi.fn(async () => ''),
      chat,
    });
    const result = await service.rehearse({
      question: '¿Cómo abordarías este encargo?',
      draft: { agentId: 'sofia' },
      settings,
    });
    expect(result.tier).toBe('default');
    expect(result.estimatedCostUsd).toBeNull();
  });
});
