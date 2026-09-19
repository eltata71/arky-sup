/**
 * @vitest-environment jsdom
 *
 * Cómo se lee un fallo de PostgreSQL, dicho una sola vez.
 *
 * Esta tabla estaba escrita **cinco veces** —en los repositorios Supabase de
 * configuración, iniciativas, encargos, grafo y aprendizaje— con diferencias
 * que no eran decisiones: uno trataba `23505` como conflicto y otro no lo
 * mencionaba. La prueba existe porque la clasificación decide qué se le dice al
 * usuario y, sobre todo, **si su trabajo se guarda como borrador local**: sólo
 * `offline` lo autoriza, porque reintentar un rechazo de las políticas produce
 * el mismo rechazo y prometer una sincronización que nunca ocurrirá es peor que
 * decir que no se guardó.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifySupabaseError,
  isSupabaseOffline,
  supabaseErrorCode,
  supabaseErrorMessage,
  supabaseFailure,
  unwrap,
} from '../../../services/persistence';

const withCode = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifySupabaseError', () => {
  it.each([
    ['P0001', 'conflict'],   // `raise exception` sin errcode: conflicto de revisión
    ['23505', 'conflict'],   // unique_violation
    ['40001', 'conflict'],   // serialization_failure
    ['42501', 'permission-denied'],  // insufficient_privilege: rol o sesión
    ['PGRST301', 'permission-denied'], // JWT inválido o caducado
    ['22023', 'validation-error'],   // invalid_parameter_value
    ['23514', 'validation-error'],   // check_violation
    ['23503', 'validation-error'],   // foreign_key_violation
    ['08006', 'offline'],            // connection_failure
    ['57014', 'offline'],            // query_canceled
  ])('maps %s to %s', (code, status) => {
    expect(classifySupabaseError(withCode(code))).toBe(status);
  });

  it('falls back to a plain failure for a code it does not know', () => {
    // Deliberadamente `failed` y no `offline`: adivinar «no hay red» haría que
    // el trabajo se guardara como borrador y se prometiera una sincronización.
    expect(classifySupabaseError(withCode('XX999'))).toBe('failed');
  });

  it('treats the browser fetch failure as offline, code or no code', () => {
    expect(classifySupabaseError(new Error('TypeError: Failed to fetch'))).toBe('offline');
    expect(classifySupabaseError(new Error('NetworkError when attempting to fetch'))).toBe('offline');
    expect(classifySupabaseError('Load failed')).toBe('offline');
  });

  it('believes the browser when it says there is no connection', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(classifySupabaseError(new Error('anything'))).toBe('offline');
  });

  it('does not treat a rules rejection as offline just because the browser is', () => {
    // El caso que importa: una sesión revocada mientras el portátil está sin
    // red no se degrada a borrador, porque reintentarla dará el mismo 42501.
    vi.stubGlobal('navigator', { onLine: false });
    expect(classifySupabaseError(withCode('42501'))).toBe('permission-denied');
  });

  it('survives values that are not errors at all', () => {
    expect(classifySupabaseError(null)).toBe('failed');
    expect(classifySupabaseError(undefined)).toBe('failed');
    expect(classifySupabaseError({})).toBe('failed');
  });
});

describe('isSupabaseOffline', () => {
  it('is the only question that authorises a local draft', () => {
    expect(isSupabaseOffline(withCode('08006'))).toBe(true);
    expect(isSupabaseOffline(withCode('42501'))).toBe(false);
    expect(isSupabaseOffline(withCode('P0001'))).toBe(false);
  });
});

describe('supabaseErrorCode and supabaseErrorMessage', () => {
  it('read what the server sent, and nothing when it sent nothing', () => {
    expect(supabaseErrorCode(withCode('42501', 'denied'))).toBe('42501');
    expect(supabaseErrorMessage(withCode('42501', 'denied'))).toBe('denied');
    expect(supabaseErrorCode({ code: '' })).toBeUndefined();
    expect(supabaseErrorMessage({ message: '' })).toBeUndefined();
    expect(supabaseErrorCode('a string')).toBeUndefined();
  });
});

describe('supabaseFailure', () => {
  it('prefers the server message over the generic one', () => {
    // El mensaje del servidor nombra el permiso que faltó; el genérico dice
    // «no se pudo guardar», que no ayuda a nadie a resolverlo.
    const result = supabaseFailure('op-1', withCode('42501', 'Permiso insuficiente: users:create'), 'genérico');
    expect(result).toMatchObject({
      status: 'permission-denied',
      success: false,
      operationId: 'op-1',
      target: 'supabase',
      errorCode: '42501',
      message: 'Permiso insuficiente: users:create',
    });
  });

  it('falls back to the caller message when the server sent none', () => {
    expect(supabaseFailure('op-1', { code: '23514' }, 'genérico').message).toBe('genérico');
  });
});

describe('unwrap', () => {
  it('returns the payload when there is no error', () => {
    expect(unwrap({ data: [1, 2], error: null })).toEqual([1, 2]);
  });

  it('throws the error rather than letting it read as an empty result', () => {
    // El modo de fallo que esto existe para impedir: un `if (error)` olvidado
    // hace que un permiso denegado se pinte como un portafolio sin trabajo.
    const error = withCode('42501');
    expect(() => unwrap({ data: null, error })).toThrow(error);
  });
});
