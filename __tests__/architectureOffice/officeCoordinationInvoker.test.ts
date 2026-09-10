/**
 * The agent's card configures a model tier, and the Office is what has to
 * honour it.
 *
 * It did not: `buildCoordinationInvoker` called the chat entry point with no
 * tier at all, so every one of the thirteen agents ran on the default model
 * whatever its card said. Assisted capture was the only surface that read the
 * value — which made the control on the card true in one screen and decorative
 * in the one people associate with the Office.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildCoordinationInvoker } from '../../services/architectureOffice/officeCoordinationInvoker';
import { configuredModelTiers } from '../../services/architectureOffice/officeAgentProfile';
import type { CoordinationScope } from '../../services/architectureOffice/officeCoordination';
import type { OfficeAgentProfile } from '../../services/architectureOffice/officeAgentProfile';
import type { Settings } from '../../types';

const scope: CoordinationScope = {
  level: 'project',
  id: 'proj-1',
  name: 'Núcleo de pólizas',
  briefing: ['Motor AS/400 expuesto como API'],
};

const settings = { aiConfig: {} } as unknown as Settings;

/** Typed like the real entry point, so the tier argument is a real position. */
type ChatFn = (
  project: unknown,
  message: string,
  history: unknown[],
  settings: Settings,
  personaOverride?: string,
  modelTier?: string,
) => Promise<string>;

const chatSpy = () => vi.fn<ChatFn>(async () => 'respuesta');

const profile = (
  agentId: OfficeAgentProfile['agentId'],
  modelTier: OfficeAgentProfile['modelTier'],
): OfficeAgentProfile => ({ agentId, modelTier } as OfficeAgentProfile);

describe('buildCoordinationInvoker · el nivel de modelo configurado', () => {
  it('pasa el tier de la ficha del agente que responde', async () => {
    const chat = chatSpy();
    const invoke = buildCoordinationInvoker({
      chat,
      settings,
      scope,
      modelTiers: { carmen: 'deep', tomas: 'quick' },
    });

    await invoke('carmen', 'Revisa el cumplimiento');
    await invoke('tomas', 'Resume el estado');

    expect(chat.mock.calls[0][5]).toBe('deep');
    expect(chat.mock.calls[1][5]).toBe('quick');
  });

  it('no inventa un tier para un agente sin ficha configurada', async () => {
    const chat = chatSpy();
    const invoke = buildCoordinationInvoker({ chat, settings, scope, modelTiers: { carmen: 'deep' } });

    await invoke('felipe', 'Diseña el despliegue');

    // `undefined` deja decidir al motor su propio defecto, que es distinto de
    // imponerle uno desde aquí.
    expect(chat.mock.calls[0][5]).toBeUndefined();
  });

  it('sigue funcionando cuando nadie configuró nada', async () => {
    const chat = chatSpy();
    const invoke = buildCoordinationInvoker({ chat, settings, scope });
    await invoke('elena', 'Revisa el artefacto');
    expect(chat.mock.calls[0][5]).toBeUndefined();
  });

  it('lee el tier de cada ficha resuelta, incluido el de fábrica', () => {
    const tiers = configuredModelTiers([profile('carmen', 'deep'), profile('tomas', 'quick')]);
    expect(tiers).toEqual({ carmen: 'deep', tomas: 'quick' });
  });
});
