import { describe, it, expect, vi } from 'vitest';

const platformGuide = vi.fn(async (q: string) => `guía:${q}`);
vi.mock('../../../services/ai/index', () => ({
  platformGuideService: { ask: platformGuide },
}));

import * as lazy from '../../../services/ai/lazy';

describe('services/ai/lazy (12.7)', () => {
  it('un servicio carga la capa en el primer uso y reenvía la llamada', async () => {
    const svc = lazy.platformGuideService as unknown as { ask: (q: string) => Promise<string> };
    expect(platformGuide).not.toHaveBeenCalled();
    await expect(svc.ask('hola')).resolves.toBe('guía:hola');
    await expect(svc.ask('otra')).resolves.toBe('guía:otra');
    expect(platformGuide).toHaveBeenCalledTimes(2);
  });

  it('los valores síncronos no pasan por la capa', () => {
    expect(typeof lazy.buildBasePrompt).toBe('function');
    expect(typeof lazy.AIServiceError).toBe('function');
  });
});
