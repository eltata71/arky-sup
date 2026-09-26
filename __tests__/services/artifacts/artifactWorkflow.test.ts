/**
 * Las reglas de la coordinación de artefactos, sin React (F4-05).
 *
 * Todo lo que se prueba aquí vivía entre dos `setState` de
 * `useArtifactsState`, y sólo se podía comprobar renderizando un proveedor.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactRepository } from '../../../services/artifacts/infrastructure/ArtifactRepository';
import {
  changedArtifactIds,
  executeArtifactWrite,
  markArtifactPersistence,
  planArtifactIntent,
  settleArtifactWrite,
  withConfirmedRevisions,
} from '../../../services/artifacts/application/artifactWorkflow';

const artifact = (id: string, overrides: Partial<Artifact> = {}): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: '2026-09-22T00:00:00.000Z',
  name: `Artefacto ${id}`,
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# contenido',
  objective: 'Documentar',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

const draft = () => {
  const { id: _id, version: _version, versionGroupId: _group, createdAt: _createdAt, ...rest } = artifact('x');
  return rest;
};

const success = <T,>(data: T) => ({ status: 'success' as const, success: true, target: 'supabase' as const, operationId: 'op', data });
const failure = (status: 'failed' | 'conflict') => ({ status, success: false, target: 'supabase' as const, operationId: 'op', message: 'no' });

describe('planArtifactIntent', () => {
  it('crea en un grupo nuevo y devuelve el artefacto que producirá', () => {
    const plan = planArtifactIntent([artifact('a1')], { kind: 'create', draft: draft() });
    expect(plan?.write.kind).toBe('create');
    expect(plan?.produced?.version).toBe(1);
    expect(plan?.produced?.versionGroupId).toBe(plan?.produced?.id);
    expect(plan?.change([artifact('a1')]).map((a) => a.id)).toEqual(['a1', plan?.produced?.id]);
  });

  it('respeta el id determinista de la Oficina: reanudar no crea un segundo artefacto', () => {
    const plan = planArtifactIntent([], { kind: 'create', draft: draft(), deterministicId: 'task-7-attempt-1' });
    expect(plan?.produced?.id).toBe('task-7-attempt-1');
  });

  it('numera una versión sobre la mayor de su grupo, no sobre la cuenta', () => {
    const siblings = [artifact('v1', { versionGroupId: 'g' }), artifact('v3', { versionGroupId: 'g', version: 3 })];
    const plan = planArtifactIntent(siblings, { kind: 'create-version', versionGroupId: 'g', draft: draft() });
    expect(plan?.produced?.version).toBe(4);
    expect(plan?.write.kind).toBe('create-version');
  });

  it('edita con la revisión contra la que se hizo la edición', () => {
    const plan = planArtifactIntent([artifact('a1', { revision: 7 })], { kind: 'update', artifactId: 'a1', updates: { isFavorite: true } });
    expect(plan?.write).toMatchObject({ kind: 'update', artifactId: 'a1', expectedRevision: 7, updates: { isFavorite: true } });
  });

  it('no planifica nada sobre un artefacto que no existe', () => {
    expect(planArtifactIntent([], { kind: 'update', artifactId: 'nada', updates: {} })).toBeNull();
    expect(planArtifactIntent([], { kind: 'delete', artifactId: 'nada' })).toBeNull();
    expect(planArtifactIntent([artifact('a1')], { kind: 'remove-corrupt', artifactIds: ['otro'] })).toBeNull();
  });

  it('borra con la revisión del artefacto, nunca enviando la lista', () => {
    const plan = planArtifactIntent([artifact('a1', { revision: 2 }), artifact('a2')], { kind: 'delete', artifactId: 'a1' });
    expect(plan?.write).toEqual({ kind: 'delete', artifactId: 'a1', expectedRevision: 2 });
    expect(plan?.change([artifact('a1'), artifact('a2')]).map((a) => a.id)).toEqual(['a2']);
  });

  it('aplica una sugerencia de consistencia como versiones nuevas en una sola transacción', () => {
    const plan = planArtifactIntent([artifact('a1'), artifact('a2')], {
      kind: 'apply-consistency',
      suggestion: {
        id: 's', inconsistency: '', suggestion: '', isApplied: false,
        changes: [
          { artifactId: 'a1', oldContentSnippet: '', newContent: 'uno' },
          { artifactId: 'a2', oldContentSnippet: '', newContent: 'dos' },
          { artifactId: 'desaparecido', oldContentSnippet: '', newContent: 'x' },
        ],
      },
    });
    expect(plan?.write.kind).toBe('revise');
    if (plan?.write.kind !== 'revise') throw new Error('unreachable');
    expect(plan.write.changes.map((change) => change.op)).toEqual(['create-version', 'create-version']);
    const versions = plan.write.changes.map((change) => (change.op === 'create-version' ? change.artifact : null));
    expect(versions.map((v) => [v?.versionGroupId, v?.version, v?.content])).toEqual([['a1', 2, 'uno'], ['a2', 2, 'dos']]);
  });

  it('no escribe una sugerencia que no cambia ningún artefacto', () => {
    expect(planArtifactIntent([artifact('a1')], {
      kind: 'apply-consistency',
      suggestion: { id: 's', inconsistency: '', suggestion: '', isApplied: false, changes: [] },
    })).toBeNull();
  });

  it('restaura como versión nueva sobre la mayor del grupo, sin heredar la revisión de otra fila', () => {
    const v1 = artifact('v1', { versionGroupId: 'g', revision: 4 });
    const plan = planArtifactIntent([v1, artifact('v2', { versionGroupId: 'g', version: 2 })], { kind: 'restore-version', version: v1 });
    expect(plan?.produced?.version).toBe(3);
    expect(plan?.produced).not.toHaveProperty('revision');
    expect(plan?.write.kind).toBe('create-version');
  });
});

describe('executeArtifactWrite', () => {
  const repository = (): ArtifactRepository => ({
    create: vi.fn(async (_p, a: Artifact) => success({ ...a, revision: 1 })),
    createVersion: vi.fn(async (_p, a: Artifact) => success({ ...a, revision: 1 })),
    update: vi.fn(async () => success({ updatedAt: 't', revision: 9 })),
    remove: vi.fn(async () => success({ updatedAt: 't' })),
    revise: vi.fn(async (_p, changes) => success(changes.map((c: { artifact: Artifact }) => ({ ...c.artifact, revision: 1 })))),
    removeMany: vi.fn(async () => success([])),
  }) as unknown as ArtifactRepository;

  it('llama a un único comando y devuelve la revisión confirmada', async () => {
    const repo = repository();
    const outcome = await executeArtifactWrite(repo, 'p1', { kind: 'update', artifactId: 'a1', updates: { name: 'x' }, expectedRevision: 8 }, 'u1');
    expect(repo.update).toHaveBeenCalledWith('p1', 'a1', { name: 'x' }, { userId: 'u1', expectedRevision: 8 });
    expect(outcome.confirmedRevisions).toEqual([{ id: 'a1', revision: 9 }]);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('no inventa revisiones cuando la escritura no se confirma', async () => {
    const repo = repository();
    (repo.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(failure('conflict'));
    const outcome = await executeArtifactWrite(repo, 'p1', { kind: 'update', artifactId: 'a1', updates: {}, expectedRevision: 1 }, 'u1');
    expect(outcome.result.success).toBe(false);
    expect(outcome.confirmedRevisions).toEqual([]);
  });
});

describe('settleArtifactWrite', () => {
  const generated = artifact('gen', { generationTrace: { lifecycle: [] } as unknown as Artifact['generationTrace'] });

  it('confirma lo que la base confirmó', () => {
    expect(settleArtifactWrite(success(null), [], [generated])).toEqual({ kind: 'confirmed' });
  });

  it('conserva un artefacto recién generado, marcado con el estado remoto', () => {
    const settlement = settleArtifactWrite(failure('conflict'), [], [generated]);
    expect(settlement.kind).toBe('keep-generated');
    if (settlement.kind !== 'keep-generated') throw new Error('unreachable');
    expect([...settlement.artifactIds]).toEqual(['gen']);
    expect(settlement.remote).toBe('conflict');
  });

  it('revierte una edición: la pantalla no muestra lo que la base no tiene', () => {
    const edited = { ...generated, name: 'editado' };
    expect(settleArtifactWrite(failure('failed'), [generated], [edited])).toEqual({ kind: 'rollback' });
  });
});

describe('estado derivado', () => {
  it('marca sólo los artefactos con traza de generación', () => {
    const traced = artifact('t', { generationTrace: { lifecycle: ['generated'] } as unknown as Artifact['generationTrace'] });
    const [marked, untouched] = markArtifactPersistence([traced, artifact('m')], new Set(['t', 'm']), 'success');
    expect(marked.generationTrace?.persistence?.remote).toBe('success');
    expect(marked.generationTrace?.lifecycle).toContain('persisted-remote');
    expect(untouched.generationTrace).toBeUndefined();
  });

  it('superpone las revisiones confirmadas y deja las demás', () => {
    const next = withConfirmedRevisions([artifact('a1', { revision: 1 }), artifact('a2', { revision: 3 })], [{ id: 'a1', revision: 2 }]);
    expect(next.map((a) => a.revision)).toEqual([2, 3]);
  });

  it('cuenta como cambiado lo nuevo y lo sustituido, no lo intacto', () => {
    const kept = artifact('a1');
    expect([...changedArtifactIds([kept, artifact('a2')], [kept, artifact('a2'), artifact('a3')])]).toEqual(['a2', 'a3']);
  });
});
