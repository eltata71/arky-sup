/**
 * Selección de backend por contexto: función pura, sin SDK ni red.
 *
 * Garantías: por defecto Supabase —el proveedor único desde F9—; override por
 * contexto, que es lo que permitió a F5 migrar un corte vertical cada vez; y un
 * valor desconocido que cae al seguro en vez de cambiar de proveedor por un
 * typo. La última sigue importando aunque ya no haya segundo destino: lo que
 * comprueba es que `resolved` distingue «me lo pidieron así» de «lo arreglé
 * por ti», y esa señal es la que el arranque registra en observabilidad.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND,
  isBackendHonored,
  isSupabaseDataBackendConfigured,
  resolveBackend,
} from '../../../services/adapters';

describe('resolveBackend', () => {
  it('por defecto es Supabase y la resolución se honra', () => {
    const resolution = resolveBackend({});
    expect(resolution.backend).toBe('supabase');
    expect(isBackendHonored(resolution)).toBe(true);
    expect(DEFAULT_BACKEND).toBe('supabase');
  });

  it('acepta supabase global y memory de pruebas', () => {
    expect(resolveBackend({ VITE_BACKEND: 'supabase' }).backend).toBe('supabase');
    expect(resolveBackend({ VITE_BACKEND: 'memory' }).backend).toBe('memory');
  });

  it('el override por contexto gana al global', () => {
    const resolution = resolveBackend(
      { VITE_BACKEND: 'supabase', VITE_BACKEND_ARTIFACTS: 'memory' },
      'artifacts',
    );
    expect(resolution.backend).toBe('memory');
    expect(resolution.context).toBe('artifacts');
  });

  it('un valor desconocido cae al seguro y se marca no honrado', () => {
    const resolution = resolveBackend({ VITE_BACKEND: 'oraculo' });
    expect(resolution.backend).toBe('supabase');
    expect(isBackendHonored(resolution)).toBe(false);
  });

  it('firebase ya no es un backend conocido: se trata como un typo', () => {
    // La regresión que esta prueba nombra: un despliegue con la variable
    // antigua puesta no puede quedarse callado apuntando a un proveedor que
    // ya no existe. Cae al seguro y lo declara.
    const resolution = resolveBackend({ VITE_BACKEND: 'firebase' });
    expect(resolution.backend).toBe('supabase');
    expect(isBackendHonored(resolution)).toBe(false);
  });
});

describe('puerta de datos', () => {
  it('sin URL y clave no hay backend configurado', () => {
    expect(isSupabaseDataBackendConfigured({})).toBe(false);
    expect(isSupabaseDataBackendConfigured({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBe(false);
    expect(
      isSupabaseDataBackendConfigured({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      }),
    ).toBe(true);
  });
});
