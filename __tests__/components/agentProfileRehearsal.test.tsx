/**
 * La ficha permite probar antes de guardar (plan de agentes, 16.6).
 *
 * Dos afirmaciones. La primera es de fidelidad: «Ver instrucción efectiva»
 * muestra el texto exacto que una conversación real enviaría, y lo carga bajo
 * demanda —abrir la ficha no llama a ningún modelo—. La segunda es de
 * contención: el ensayo pregunta al borrador sin guardar nada, hace una sola
 * llamada y muestra tier, coste y latencia junto a la respuesta.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentProfileEditor } from '../../components/architectureOffice/agentProfile/AgentProfileEditor';
import { resolveAgentProfile } from '../../services/architectureOffice/domain/officeAgentProfile';
import type { OfficeAgentProfileOverride } from '../../services/architectureOffice/domain/officeAgentProfile';

vi.mock('../../lib/i18n/UiTranslationContext', () => ({
  useUiTranslation: () => (key: string) => key,
}));
vi.mock('../../hooks/useEffectiveAgentModel', () => ({
  useEffectiveAgentModel: () => 'gemini-2.5-flash',
}));

const rehearse = vi.fn<(input: unknown) => Promise<unknown>>();
const previewInstruction = vi.fn<() => Promise<unknown>>();

vi.mock('../../services/architectureOffice/application/draftAgentRehearsal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/architectureOffice/application/draftAgentRehearsal')>();
  return {
    ...actual,
    createDraftAgentRehearsal: () => ({
      // Lazy getters: the module-level singleton instantiates during import,
      // before these consts would otherwise be initialized.
      get previewInstruction() { return previewInstruction; },
      get rehearse() { return rehearse; },
      sampleQuestions: actual.sampleQuestionsFor,
    }) as unknown as ReturnType<typeof actual.createDraftAgentRehearsal>,
  };
});

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    settings: {
      globalContext: [],
      language: 'es',
      theme: 'light',
      aiConfig: {} as never,
    },
  }),
}));

const override: OfficeAgentProfileOverride = {
  agentId: 'sofia',
  userId: 'u1',
  schemaVersion: 1,
  knowledge: ['El canal de corredores corre sobre AS/400.'],
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const renderEditor = () => {
  const onSave = vi.fn(async () => ({ outcome: 'saved' }));
  const onReset = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(
    <AgentProfileEditor
      profile={resolveAgentProfile('sofia')}
      override={override}
      onSave={onSave}
      onReset={onReset}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
};

describe('AgentProfileEditor — ver instrucción efectiva', () => {
  it('carga bajo demanda, muestra el texto exacto en capas y no llama a un modelo al abrir', () => {
    renderEditor();
    expect(previewInstruction).not.toHaveBeenCalled();
    expect(screen.queryByText('## Contrato del agente')).not.toBeInTheDocument();

    previewInstruction.mockResolvedValueOnce({
      instruction: 'BASE\n\n## Contrato del agente\nEres Sofía.\n\n## Reglas de la Oficina\nReglas.',
      voice: '## Contrato del agente\nEres Sofía.',
      layers: [
        { id: 'contexto', header: null, text: 'BASE' },
        { id: 'contrato', header: '## Contrato del agente', text: '## Contrato del agente\nEres Sofía.' },
        { id: 'reglas', header: '## Reglas de la Oficina', text: '## Reglas de la Oficina\nReglas.' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'agent.ver-instruccion-efectiva.ec98a9' }));

    expect(screen.getByRole('status')).toBeInTheDocument();
    return waitFor(() => {
      // El texto mostrado es el que se enviaría: se pinta tal cual llegó.
      expect(screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === '## Contrato del agente\nEres Sofía.')).not.toBeNull();
      expect(screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === '## Reglas de la Oficina\nReglas.')).not.toBeNull();
      expect(previewInstruction).toHaveBeenCalledOnce();
    });
  });
});

describe('AgentProfileEditor — ensayar', () => {
  it('ofrece tres preguntas por rol, la última fuera de alcance', () => {
    renderEditor();
    expect(screen.getAllByRole('button', { name: /¿Cómo abordarías/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Prepara un borrador/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /¿Puedes ayudarme con esto/ })).toHaveLength(1);
  });

  it('ensaya una pregunta contra el borrador sin guardar y muestra tier, coste y latencia', async () => {
    renderEditor();
    rehearse.mockResolvedValueOnce({
      answer: 'Respuesta de prueba.',
      model: 'gemini-2.5-pro',
      tier: 'deep',
      latencyMs: 1_500,
      estimatedCostUsd: 0.0225,
    });
    fireEvent.change(screen.getByLabelText('agent.pregunta-prueba.e476fb'), {
      target: { value: '¿Cómo abordarías este encargo?' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'agent.ensayar.5cf174' })[0]!);

    await waitFor(() => {
      expect(rehearse).toHaveBeenCalledTimes(1);
      const call = rehearse.mock.calls[0]?.[0] as { question: string; draft: { agentId: string; knowledge?: string[] } };
      expect(call.question).toBe('¿Cómo abordarías este encargo?');
      expect(call.draft.agentId).toBe('sofia');
      expect(call.draft.knowledge).toContain('El canal de corredores corre sobre AS/400.');
    });
    await waitFor(() => {
      expect(screen.getByText('Respuesta de prueba.')).toBeInTheDocument();
      expect(screen.getByText((_, el) =>
        el?.textContent === 'agent.nivel-modelo.ada9db: deep · gemini-2.5-pro · agent.latencia.4f0d37: 1500 ms · agent.coste-estimado.464251: $0.02',
      )).not.toBeNull();
    });
  });

  it('un fallo del modelo se informa, no se propaga', async () => {
    renderEditor();
    rehearse.mockRejectedValueOnce(new Error('provider down'));
    fireEvent.change(screen.getByLabelText('agent.pregunta-prueba.e476fb'), {
      target: { value: '¿Cómo abordarías este encargo?' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'agent.ensayar.5cf174' })[0]!);
    await waitFor(() => {
      expect(screen.getByText('agent.ensayar-fallo.b8c209')).toBeInTheDocument();
    });
  });
});
