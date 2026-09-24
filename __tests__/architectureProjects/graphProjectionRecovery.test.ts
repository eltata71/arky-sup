/**
 * La recuperación de la proyección del grafo (F5-05), sin base de datos: los
 * puertos son dobles. Lo que se fija es el protocolo — leer fresco, guardar con
 * la generación, anotar el fallo — y que ningún camino se traga un pendiente.
 */
import { describe, expect, it, vi } from 'vitest';
import { recoverGraphProjections, type GraphProjectionPorts } from '../../services/architectureProjects';
import type { Project } from '../../services/architectureProjects';
import type { PendingGraphProjection } from '../../services/architectureKnowledgeGraph';

const project = (id: string): Project => ({
  id,
  name: `Proyecto ${id}`,
  description: 'Modernización del core de reclamos con integración al broker.',
  projectContext: ['Integración con el broker por API'],
  artifacts: [],
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
} as unknown as Project);

const pending = (projectId: string, generation: number): PendingGraphProjection => ({
  projectId, generation, requestedAt: '2026-09-24T00:00:00.000Z', attempts: 0, lastError: null,
});

const ports = (overrides: Partial<GraphProjectionPorts> = {}): GraphProjectionPorts => ({
  listPending: vi.fn(async () => [pending('p1', 2)]),
  loadFreshProject: vi.fn(async (id: string) => project(id)),
  saveProjection: vi.fn(async () => ({
    status: 'success' as const, success: true, operationId: 'op', target: 'supabase' as const,
    data: { applied: true, revision: 7, pending: false },
  })),
  failProjection: vi.fn(async () => undefined),
  globalContext: [],
  ...overrides,
});

describe('recoverGraphProjections', () => {
  it('reconstruye desde una lectura fresca y guarda con la generación del pendiente', async () => {
    const p = ports();
    const report = await recoverGraphProjections(p);
    expect(p.loadFreshProject).toHaveBeenCalledWith('p1');
    expect(p.saveProjection).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }), 2);
    expect(report.available).toBe(true);
    expect(report.recovered).toEqual([{ projectId: 'p1', graph: expect.objectContaining({ projectId: 'p1', revision: 7 }) }]);
  });

  it('una base sin bitácora lo dice, para que quien llama degrade', async () => {
    const report = await recoverGraphProjections(ports({ listPending: vi.fn(async () => null) }));
    expect(report).toEqual({ available: false, recovered: [], skipped: [], failed: [] });
  });

  it('una generación ya procesada o vieja se salta: reprocesar no duplica', async () => {
    const report = await recoverGraphProjections(ports({
      saveProjection: vi.fn(async () => ({
        status: 'success' as const, success: true, operationId: 'op', target: 'supabase' as const,
        data: { applied: false, reason: 'stale' as const, pending: false },
      })),
    }));
    expect(report.skipped).toEqual(['p1']);
    expect(report.recovered).toEqual([]);
  });

  it('un guardado rechazado se anota en el pendiente, que sigue ahí', async () => {
    const p = ports({
      saveProjection: vi.fn(async () => ({
        status: 'conflict' as const, success: false, operationId: 'op', target: 'supabase' as const,
        message: 'Conflicto de grafo',
      })),
    });
    const report = await recoverGraphProjections(p);
    expect(p.failProjection).toHaveBeenCalledWith('p1', 2, 'Conflicto de grafo');
    expect(report.failed).toEqual([{ projectId: 'p1', message: 'Conflicto de grafo' }]);
  });

  it('un proyecto que no se puede leer no produce un grafo vacío: se anota', async () => {
    const p = ports({ loadFreshProject: vi.fn(async () => undefined) });
    const report = await recoverGraphProjections(p);
    expect(p.saveProjection).not.toHaveBeenCalled();
    expect(p.failProjection).toHaveBeenCalledWith('p1', 2, expect.stringContaining('no se pudo leer'));
    expect(report.failed).toHaveLength(1);
  });

  it('una excepción tampoco se traga, aunque anotarla falle', async () => {
    const p = ports({
      loadFreshProject: vi.fn(async () => { throw new Error('sin red'); }),
      failProjection: vi.fn(async () => { throw new Error('tampoco'); }),
    });
    const report = await recoverGraphProjections(p);
    expect(report.failed).toEqual([{ projectId: 'p1', message: 'sin red' }]);
  });

  it('puede limitarse a los proyectos pedidos', async () => {
    const p = ports({ listPending: vi.fn(async () => [pending('p1', 1), pending('p2', 4)]) });
    const report = await recoverGraphProjections(p, { projectIds: ['p2'] });
    expect(p.loadFreshProject).toHaveBeenCalledTimes(1);
    expect(p.saveProjection).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p2' }), 4);
    expect(report.recovered.map((entry) => entry.projectId)).toEqual(['p2']);
  });
});
