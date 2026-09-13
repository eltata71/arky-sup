/**
 * Selección de backend por contexto (F3.2): función pura, sin SDK ni red.
 *
 * Garantías: por defecto Firebase (el proveedor activo); override por
 * contexto para los cortes F5; un valor desconocido cae al seguro en vez de
 * cambiar de proveedor por un typo; la puerta Supabase lanza hasta F4/F5.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND,
  isBackendHonored,
  isSupabaseDataBackendConfigured,
  requireSupabaseDataBackend,
  resolveBackend,
} from '../../../services/adapters';
import { BackendUnavailableError } from '../../../services/ports';

describe('resolveBackend', () => {
  it('por defecto es Firebase y la resolución se honra', () => {
    const resolution = resolveBackend({});
    expect(resolution.backend).toBe('firebase');
    expect(isBackendHonored(resolution)).toBe(true);
    expect(DEFAULT_BACKEND).toBe('firebase');
  });

  it('acepta supabase global y memory de pruebas', () => {
    expect(resolveBackend({ VITE_BACKEND: 'supabase' }).backend).toBe('supabase');
    expect(resolveBackend({ VITE_BACKEND: 'memory' }).backend).toBe('memory');
  });

  it('el override por contexto gana al global', () => {
    const resolution = resolveBackend(
      { VITE_BACKEND: 'firebase', VITE_BACKEND_ARTIFACTS: 'supabase' },
      'artifacts',
    );
    expect(resolution.backend).toBe('supabase');
    expect(resolution.context).toBe('artifacts');
  });

  it('un valor desconocido cae al seguro y se marca no honrado', () => {
    const resolution = resolveBackend({ VITE_BACKEND: 'oraculo' });
    expect(resolution.backend).toBe('firebase');
    expect(isBackendHonored(resolution)).toBe(false);
  });
});

describe('puerta Supabase', () => {
  it('sin URL y clave no hay backend configurado', () => {
    expect(isSupabaseDataBackendConfigured({})).toBe(false);
    expect(
      isSupabaseDataBackendConfigured({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      }),
    ).toBe(true);
  });

  it('la puerta lanza hasta F4/F5: ninguna escritura llega por accidente', () => {
    expect(() => requireSupabaseDataBackend('write:artefacto')).toThrow(BackendUnavailableError);
  });
});
