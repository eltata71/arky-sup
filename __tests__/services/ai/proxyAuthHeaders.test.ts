/**
 * El proxy sólo gasta la clave del operador para quien puede demostrar quién es.
 *
 * La regresión que esta prueba nombra ocurrió de verdad: dos módulos construían
 * sus cabeceras por separado, y uno se quedó mandando el uid desnudo después de
 * que el servidor pasara a exigir un token. La llamada «seguía funcionando»
 * porque un fallo del proxy degrada al camino directo — así que la creación
 * guiada dejó de usar la clave del servidor y volvió a la del navegador, sin
 * que nada lo dijera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { currentAccessToken } = vi.hoisted(() => ({ currentAccessToken: vi.fn() }));
vi.mock('../../../services/identity', () => ({ currentAccessToken }));

import { buildProxyAuthHeaders } from '../../../services/ai/proxyAuthHeaders';

beforeEach(() => {
  vi.clearAllMocks();
  currentAccessToken.mockResolvedValue('supabase-access-token');
});
afterEach(() => vi.unstubAllEnvs());

describe('proxy identity', () => {
  it('sends the session access token', async () => {
    expect(await buildProxyAuthHeaders('tab-1', 'trace-1')).toEqual({
      'Content-Type': 'application/json',
      'x-arky-session-id': 'tab-1',
      'x-arky-trace-id': 'trace-1',
      Authorization: 'Bearer supabase-access-token',
    });
  });

  it('omits the trace header when there is no trace to correlate', async () => {
    expect(await buildProxyAuthHeaders('tab-1')).not.toHaveProperty('x-arky-trace-id');
  });

  it('goes out without a token when there is no session, rather than inventing one', async () => {
    // El contrato del que dependen los dos llamantes: sin cabecera el proxy
    // responde 401 y el llamante degrada. Fabricar una identidad aquí sería
    // gastar la clave del operador por una sesión que no existe.
    currentAccessToken.mockResolvedValue(null);
    expect(await buildProxyAuthHeaders('tab-1')).not.toHaveProperty('Authorization');
  });

  it('survives a failure reading the session', async () => {
    currentAccessToken.mockRejectedValue(new Error('network'));
    const headers = await buildProxyAuthHeaders('tab-1');
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['x-arky-session-id']).toBe('tab-1');
  });
});
