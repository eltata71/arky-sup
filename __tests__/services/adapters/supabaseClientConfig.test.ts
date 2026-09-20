import { afterEach, describe, expect, it } from 'vitest';
import {
  isSupabaseConfigured,
  loadSupabaseClient,
  resetSupabaseClientCache,
} from '../../../services/adapters/supabaseClient';
import { BackendUnavailableError } from '../../../services/ports';

const KEY = 'sb_publishable_public-by-design';

afterEach(() => {
  resetSupabaseClientCache();
});

describe('la puerta al cliente de Supabase distingue ausente de mal escrito', () => {
  it('rechaza una URL presente y mal escrita antes de construir el cliente', async () => {
    // El SDK también la rechazaría, pero con «Invalid supabaseUrl: Must be a
    // valid HTTP or HTTPS URL» — una frase que nombra un argumento interno y
    // no la variable que hay que corregir. Ocurrió en producción: el error
    // salió en el formulario de inicio de sesión y nadie podía deducir de él
    // qué casilla del panel estaba mal.
    await expect(loadSupabaseClient(
      { VITE_SUPABASE_URL: 'btbhkmckrazoayaoorys.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
      'inicio de sesión',
    )).rejects.toThrow(BackendUnavailableError);
  });

  it('nombra la variable y la forma esperada en el mensaje', async () => {
    let message = '';
    try {
      await loadSupabaseClient(
        { VITE_SUPABASE_URL: 'no-es-una-url', VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
        'inicio de sesión',
      );
    } catch (caught: unknown) {
      message = caught instanceof Error ? caught.message : String(caught);
    }

    expect(message).toContain('VITE_SUPABASE_URL');
    expect(message).toContain('https://');
    // El propósito viaja para que el registro diga qué se estaba intentando.
    expect(message).toContain('inicio de sesión');
  });

  it('un fallo de forma no deja el cliente memorizado a medias', async () => {
    // `pending` se limpia en el camino de error para que el siguiente intento
    // vuelva a probar. La guarda de forma va antes de asignarlo, así que este
    // caso comprueba lo que ya no puede quedar colgado.
    await expect(loadSupabaseClient({ VITE_SUPABASE_URL: 'x', VITE_SUPABASE_PUBLISHABLE_KEY: KEY }))
      .rejects.toThrow(BackendUnavailableError);
    await expect(loadSupabaseClient({ VITE_SUPABASE_URL: 'x', VITE_SUPABASE_PUBLISHABLE_KEY: KEY }))
      .rejects.toThrow(BackendUnavailableError);
  });

  it('sigue distinguiendo la configuración ausente', async () => {
    await expect(loadSupabaseClient({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }))
      .rejects.toThrow(/configuración ausente/);
  });

  it('`isSupabaseConfigured` sigue respondiendo sólo por la presencia', () => {
    // Deliberado: es la pregunta «¿hay algo configurado?», que decide si el
    // producto degrada a local. Una URL mal escrita sí está configurada —mal—
    // y degradar en silencio ahí escondería el fallo que hay que arreglar.
    expect(isSupabaseConfigured({
      VITE_SUPABASE_URL: 'no-es-una-url',
      VITE_SUPABASE_PUBLISHABLE_KEY: KEY,
    })).toBe(true);
    expect(isSupabaseConfigured({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: KEY })).toBe(false);
  });
});
