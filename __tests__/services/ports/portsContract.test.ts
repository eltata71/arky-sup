/**
 * Contrato de los puertos (F3.1): el dominio se prueba sin React, sin
 * Firebase, sin Supabase y sin DOM — solo estos fakes en memoria.
 */
import { describe, expect, it } from 'vitest';
import { ManualClock, MemoryFileStorage, MemoryRepository } from '../../../services/ports';
import { BackendUnavailableError, SystemClock } from '../../../services/ports';

describe('ManualClock', () => {
  it('es fijo y solo avanza bajo orden del test', () => {
    const clock = new ManualClock();
    expect(clock.nowIso()).toBe('2026-09-12T00:00:00.000Z');
    clock.advance(60_000);
    expect(clock.nowMs()).toBe(Date.parse('2026-09-12T00:01:00.000Z'));
  });
});

describe('MemoryFileStorage', () => {
  it('sube, descarga y borra por bucket/path', async () => {
    const storage = new MemoryFileStorage();
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.upload('artefactos', 'a/bin', bytes, 'application/octet-stream');
    expect(storage.size()).toBe(1);
    const back = await storage.download('artefactos', 'a/bin');
    expect(Array.from(back)).toEqual([1, 2, 3]);
    await storage.remove('artefactos', 'a/bin');
    await expect(storage.download('artefactos', 'a/bin')).rejects.toThrow();
  });
});

describe('MemoryRepository', () => {
  it('upsert idempotente: repetir write no duplica', async () => {
    const repo = new MemoryRepository<{ id: string; v: number }>();
    await repo.write({ id: 'a', v: 1 });
    await repo.write({ id: 'a', v: 2 });
    expect(repo.size()).toBe(1);
    expect(await repo.read('a')).toEqual({ id: 'a', v: 2 });
    expect(await repo.read('ausente')).toBeNull();
    await repo.remove('a');
    expect(await repo.read('a')).toBeNull();
  });
});

describe('SystemClock y BackendUnavailableError', () => {
  it('el reloj del sistema devuelve valores coherentes', () => {
    expect(typeof SystemClock.nowIso()).toBe('string');
    expect(SystemClock.nowMs()).toBeGreaterThan(0);
  });

  it('el error de backend lleva backend y operación', () => {
    const error = new BackendUnavailableError('supabase', 'write:artefacto');
    expect(error).toBeInstanceOf(Error);
    expect(error.backend).toBe('supabase');
    expect(error.operation).toBe('write:artefacto');
  });
});
