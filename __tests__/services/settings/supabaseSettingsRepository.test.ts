import { describe, expect, it } from 'vitest';
import type { Settings } from '../../../types';
import {
  createSupabaseSettingsRepository,
  sanitizeSettingsForRemote,
  type SupabaseSettingsClientLike,
} from '../../../services/settings';

const settings: Settings = {
  globalContext: ['Sin datos sensibles'],
  language: 'es',
  theme: 'dark',
  aiConfig: {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    temperature: 0.4,
    tone: 'Profesional',
    languageStyle: 'Conciso',
    apiKeySource: 'user',
  },
  agentMemory: ['No exponer secretos'],
};

interface FakeClient extends SupabaseSettingsClientLike {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeClient(options: { row?: unknown; error?: unknown } = {}): FakeClient {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: options.row ?? null, error: options.error ?? null }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: options.row ?? { settings, revision: 2 }, error: options.error ?? null };
    },
    calls,
  };
  return client;
}

describe('sanitizeSettingsForRemote', () => {
  it('preserva preferencias y elimina una clave inyectada antes de cruzar la frontera', () => {
    const unsafe = {
      ...settings,
      aiConfig: { ...settings.aiConfig, apiKey: 'never-send-this' },
    } as Settings;

    expect(sanitizeSettingsForRemote(unsafe)).toEqual(settings);
    expect(JSON.stringify(sanitizeSettingsForRemote(unsafe))).not.toContain('never-send-this');
  });
});

describe('SupabaseSettingsRepository', () => {
  it('lee solamente el registro del propietario autenticado', async () => {
    const client = fakeClient({ row: { settings, revision: 7 } });
    const repository = createSupabaseSettingsRepository(client);

    await expect(repository.load('00000000-0000-4000-8000-000000000001')).resolves.toEqual(settings);
  });

  it('guarda mediante RPC con revisión esperada y confirma solo al recibir la fila', async () => {
    const client = fakeClient({ row: { settings, revision: 2 } });
    const repository = createSupabaseSettingsRepository(client);

    const result = await repository.save(settings, '00000000-0000-4000-8000-000000000001', 1);

    expect(result).toMatchObject({ status: 'success', success: true, target: 'supabase', data: { revision: 2 } });
    expect(client.calls).toEqual([{
      name: 'save_user_settings',
      args: { p_settings: settings, p_expected_revision: 1 },
    }]);
  });

  it('expone un conflicto de revisión y no lo degrada a borrador confirmado', async () => {
    const client = fakeClient({ error: { code: 'P0001', message: 'Conflicto de configuración' } });
    const repository = createSupabaseSettingsRepository(client);

    const result = await repository.save(settings, '00000000-0000-4000-8000-000000000001', 1);

    expect(result).toMatchObject({ status: 'conflict', success: false, target: 'supabase' });
  });

  it('clasifica una caída de fetch como operación offline no confirmada', async () => {
    const client = fakeClient({ error: new TypeError('Failed to fetch') });
    const repository = createSupabaseSettingsRepository(client);

    const result = await repository.save(settings, '00000000-0000-4000-8000-000000000001', 1);

    expect(result).toMatchObject({ status: 'offline', success: false, target: 'supabase' });
  });
});
