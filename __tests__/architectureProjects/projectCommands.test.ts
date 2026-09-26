/**
 * Las operaciones con nombre de un Proyecto de Arquitectura (F6-03, corte 2b).
 *
 * Sin mocks: el dominio es puro, así que se prueba con datos. Lo que importa es
 * lo que un parche libre no podía decir: qué se rechaza, qué no cambia nada y
 * qué se escribe.
 */
import { describe, expect, it } from 'vitest';
import { applyProjectCommand, type ProjectRoot } from '../../services/architectureProjects';

const NOW = '2026-09-26T12:00:00.000Z';

const project = (overrides: Partial<ProjectRoot> = {}): ProjectRoot => ({
  id: 'proj_1',
  name: 'Atención de reclamos',
  description: 'Reducir el tiempo de alta',
  projectContext: ['El canal del bróker corre en AS/400'],
  initiativeIds: ['init_1'],
  linkedBusinessProjects: ['NEG-2026-001'],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  revision: 4,
  ...overrides,
});

describe('renombrar', () => {
  it('cambia el nombre, recortado, y fecha el cambio', () => {
    const result = applyProjectCommand(project(), { kind: 'rename', name: '  Reclamos de vida  ' }, { now: NOW });
    expect(result).toEqual({ ok: true, changed: true, changes: { name: 'Reclamos de vida', updatedAt: NOW } });
  });

  it('rechaza un nombre vacío: P-01', () => {
    const result = applyProjectCommand(project(), { kind: 'rename', name: '   ' });
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'empty-name' } });
  });

  it('el mismo nombre no cambia nada, y no pide escribir', () => {
    expect(applyProjectCommand(project(), { kind: 'rename', name: 'Atención de reclamos' }))
      .toEqual({ ok: true, changed: false, changes: {} });
  });
});

describe('vincular iniciativas — P-02 también al cambiar, no sólo al crear', () => {
  it('rechaza quitar la última iniciativa', () => {
    const result = applyProjectCommand(project(), { kind: 'link-initiatives', initiativeIds: [], codes: [] });
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'no-initiative' } });
  });

  it('ids vacíos o sólo espacios cuentan como ninguno', () => {
    expect(applyProjectCommand(project(), { kind: 'link-initiatives', initiativeIds: ['  ', ''] }))
      .toMatchObject({ ok: false, rejection: { reason: 'no-initiative' } });
  });

  it('quita repetidos y normaliza los códigos del espejo', () => {
    const result = applyProjectCommand(project(), {
      kind: 'link-initiatives',
      initiativeIds: ['init_2', 'init_2', ' init_3 '],
      codes: [' neg-2026-002 ', 'no-es-un-codigo'],
    }, { now: NOW });
    expect(result).toEqual({
      ok: true,
      changed: true,
      changes: { initiativeIds: ['init_2', 'init_3'], linkedBusinessProjects: ['NEG-2026-002'], updatedAt: NOW },
    });
  });
});

describe('el contexto del proyecto', () => {
  it('añade una entrada recortada', () => {
    const result = applyProjectCommand(project(), { kind: 'add-context-entry', entry: ' Regulado por la SFC ' }, { now: NOW });
    expect(result).toMatchObject({
      ok: true,
      changes: { projectContext: ['El canal del bróker corre en AS/400', 'Regulado por la SFC'] },
    });
  });

  it('rechaza una entrada vacía', () => {
    expect(applyProjectCommand(project(), { kind: 'add-context-entry', entry: '  ' }))
      .toMatchObject({ ok: false, rejection: { reason: 'empty-context-entry' } });
  });

  it('una entrada repetida no se añade dos veces', () => {
    expect(applyProjectCommand(project(), { kind: 'add-context-entry', entry: 'El canal del bróker corre en AS/400' }))
      .toEqual({ ok: true, changed: false, changes: {} });
  });

  it('quita una entrada; quitar una que no está no cambia nada', () => {
    expect(applyProjectCommand(project(), { kind: 'remove-context-entry', entry: 'El canal del bróker corre en AS/400' }, { now: NOW }))
      .toMatchObject({ ok: true, changed: true, changes: { projectContext: [] } });
    expect(applyProjectCommand(project(), { kind: 'remove-context-entry', entry: 'otra cosa' }))
      .toEqual({ ok: true, changed: false, changes: {} });
  });
});

describe('las memorias', () => {
  const entry = { id: 'mem_1', text: 'Lección', source: 'agent', createdAt: NOW } as never;

  it('reemplaza una memoria y sus entradas, cada una en su campo', () => {
    const result = applyProjectCommand(project(), {
      kind: 'replace-memory', area: 'agentMemory', texts: ['Lección'], entries: [entry],
    }, { now: NOW });
    expect(result).toEqual({
      ok: true,
      changed: true,
      changes: { agentMemory: ['Lección'], agentMemoryEntries: [entry], updatedAt: NOW },
    });
  });

  it('sin entradas, sólo toca los textos', () => {
    const result = applyProjectCommand(project(), { kind: 'replace-memory', area: 'initialCapture', texts: ['Nota'] }, { now: NOW });
    expect(result).toEqual({ ok: true, changed: true, changes: { initialCapture: ['Nota'], updatedAt: NOW } });
  });
});

describe('el seguimiento', () => {
  it('se normaliza con la misma regla que la lectura de lo almacenado', () => {
    const result = applyProjectCommand(project(), {
      kind: 'update-tracking',
      tracking: { status: 'design', priority: 'high', progress: 250 } as never,
    }, { now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changes.attention?.status).toBe('design');
  });
});

describe('lo que no es un comando', () => {
  it('la identidad, la fecha de creación y la revisión nunca salen en los cambios', () => {
    const commands = [
      { kind: 'rename', name: 'Otro' },
      { kind: 'describe', description: 'Otra' },
      { kind: 'link-initiatives', initiativeIds: ['init_9'] },
      { kind: 'set-publication-packages', packages: [] as never[] },
    ] as const;
    for (const command of commands) {
      const result = applyProjectCommand(project(), command, { now: NOW });
      if (!result.ok) continue;
      expect(result.changes).not.toHaveProperty('id');
      expect(result.changes).not.toHaveProperty('createdAt');
      expect(result.changes).not.toHaveProperty('revision');
    }
  });
});
