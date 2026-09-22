/**
 * @vitest-environment jsdom
 *
 * El agregado Proyecto contra la RPC compuesta.
 *
 * Sustituye a tres suites —`firestorePersistenceHardening`,
 * `artifactIndexLoading` y `projectAggregateStorage`— que cubrían mecánica de
 * Firestore que ya no existe: transacciones a mano, el documento de índice
 * mantenido desde el cliente, los agregados partidos en subcolecciones para
 * caber en 1 MiB, y la poda de campos efímeros. Todo eso era del proveedor.
 *
 * Lo que sí sigue siendo del **producto** se afirma aquí, y es exactamente lo
 * que aquellas suites protegían de verdad:
 *
 *   1. la lista de portafolio no descarga los cuerpos de los artefactos —era lo
 *      más caro que hacía la aplicación al abrirse—;
 *   2. una lectura fallida degrada a lo último que se vio, nunca a un proyecto
 *      vacío, porque un proyecto vacío se parece demasiado a uno sin trabajo;
 *   3. una escritura no confirmada no se informa como guardada, y sólo el caso
 *      `offline` deja borrador local;
 *   4. desde ADR-106, escribir un artefacto es **un comando sobre ese
 *      artefacto**: viaja uno, se compara su revisión, y nada que no se nombre
 *      puede borrarse. El contador y el índice los recalcula el servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { Project, ProjectRoot } from '../../services/architectureProjects';

const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({
  data: null as unknown,
  error: null as unknown,
}));

/**
 * Se dobla la **puerta**, no cada repositorio: así la traducción de
 * `{ data, error }` a `PersistenceResult` —donde vive el comportamiento que
 * estas pruebas afirman— sigue siendo la real.
 */
const callRpc = async (name: string, args?: Record<string, unknown>) => {
  const { data, error } = await rpc(name, args);
  if (error) throw error;
  return data;
};

vi.mock('../../services/adapters', () => ({
  loadSupabaseDataClient: vi.fn(async () => ({ rpc: (name: string, args?: Record<string, unknown>) => rpc(name, args) })),
  callRpc: (...args: [string, Record<string, unknown>?]) => callRpc(...args),
}));
vi.mock('../../services/observability', () => ({
  observabilityService: {
    recordWarning: vi.fn(),
    reportError: vi.fn(),
    trackEvent: vi.fn(() => ({ id: 'e', at: '' })),
  },
}));

const artifact = (id: string): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: `Artefacto ${id}`,
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# contenido',
  objective: 'Documentar',
  keyConcepts: [],
  representation: 'document',
} as unknown as Artifact);

const summaryOf = (entry: Artifact) => ({
  id: entry.id,
  name: entry.name,
  type: entry.type,
  versionGroupId: entry.versionGroupId,
  version: entry.version,
  architecturalView: entry.architecturalView,
  phase: entry.phase,
  createdAt: entry.createdAt,
});

const projectRow = (artifacts: Artifact[], overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Atención digital',
  userId: 'u1',
  initiativeIds: ['init-1'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  revision: 3,
  artifacts,
  artifactIndex: artifacts.map(summaryOf),
  artifactCount: artifacts.length,
  ...overrides,
});

const load = async () => {
  const reads = await import('../../services/architectureProjects/projectReads');
  const writes = await import('../../services/architectureProjects/projectWrites');
  const artifacts = await import('../../services/artifacts/artifactPersistence');
  return { ...reads, ...writes, ...artifacts };
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  rpc.mockImplementation(async () => ({ data: null, error: null }));
});

afterEach(() => {
  localStorage.clear();
});

describe('the portfolio read', () => {
  it('uses the index and does not download a single artifact body', async () => {
    const entries = [artifact('a1'), artifact('a2')];
    rpc.mockImplementation(async (name) => (
      name === 'list_project_aggregates'
        ? { data: [projectRow([], { artifactIndex: entries.map(summaryOf), artifactCount: 2 })], error: null }
        : { data: null, error: null }
    ));

    const { getAllProjects } = await load();
    const projects = await getAllProjects('u1');

    expect(projects).toHaveLength(1);
    expect(projects[0].artifacts).toEqual([]);
    expect(projects[0].artifactIndex).toHaveLength(2);
    expect(projects[0].artifactCount).toBe(2);
    // Lo que la pantalla necesita saber: los cuerpos no están cargados, y eso
    // viaja con el registro para que nadie lo confunda con «no hay ninguno».
    expect(projects[0].artifactsLoaded).toBe(false);
  });

  it('refuses a query with no session instead of listing everything', async () => {
    const { getAllProjects } = await load();
    expect(await getAllProjects(undefined, false)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('degrades to the local mirror rather than reporting an empty portfolio', async () => {
    const stored: Project[] = [{ ...projectRow([]), artifacts: [] } as unknown as Project];
    localStorage.setItem('arky.offlineDraft.projects', JSON.stringify({ value: stored, status: 'offline', at: '' }));
    rpc.mockImplementation(async () => ({ data: null, error: { code: '08006', message: 'network' } }));

    const { getAllProjects } = await load();
    const projects = await getAllProjects('u1');

    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe('p1');
  });
});

describe('opening one project', () => {
  it('hydrates the artifacts and reports them as loaded', async () => {
    const entries = [artifact('a1')];
    rpc.mockImplementation(async (name) => {
      if (name === 'load_project_aggregate') return { data: projectRow(entries), error: null };
      if (name === 'load_knowledge_graph') return { data: null, error: { code: 'P0002', message: 'absent' } };
      return { data: null, error: null };
    });

    const { getProject } = await load();
    const project = await getProject('p1');

    expect(project?.artifacts).toHaveLength(1);
    expect(project?.artifactsLoaded).toBe(true);
  });

  it('returns undefined for a project that does not exist', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: 'P0002', message: 'absent' } }));
    const { getProject } = await load();
    expect(await getProject('missing')).toBeUndefined();
  });

  it('opens even when the derived knowledge graph cannot be read', async () => {
    rpc.mockImplementation(async (name) => {
      if (name === 'load_project_aggregate') return { data: projectRow([artifact('a1')]), error: null };
      if (name === 'load_knowledge_graph') return { data: null, error: { code: '42501', message: 'denied' } };
      return { data: null, error: null };
    });

    const { getProject } = await load();
    // El grafo es dato derivado que se reconstruye con cada cambio de
    // artefacto: cambiar una vista degradada por ninguna vista sería un mal
    // negocio, y además sería un modo de fallo nuevo.
    expect((await getProject('p1'))?.id).toBe('p1');
  });
});

describe('writing an artifact is one command on that artifact (ADR-106)', () => {
  const withRevision = (entry: Artifact, revision: number): Artifact => ({ ...entry, revision });
  const setupProject = (entries: Artifact[], commands: Record<string, (args: Record<string, unknown>) => unknown> = {}) => {
    rpc.mockImplementation(async (name, args) => {
      if (name === 'load_project_aggregate') return { data: projectRow(entries), error: null };
      if (name === 'load_knowledge_graph') return { data: null, error: { code: 'P0002', message: 'absent' } };
      const command = commands[name];
      if (command) return { data: command(args ?? {}), error: null };
      return { data: null, error: null };
    });
  };
  const names = () => rpc.mock.calls.map(([name]) => name);

  it('creates by sending one artifact, never the list — so nothing it omits can be deleted', async () => {
    setupProject([artifact('a1')], { create_artifact: (args) => ({ ...(args.p_artifact as object), revision: 1 }) });
    const { createArtifact } = await load();

    const result = await createArtifact('p1', artifact('a2'));

    expect(result.success).toBe(true);
    expect(result.data?.revision).toBe(1);
    const call = rpc.mock.calls.find(([name]) => name === 'create_artifact');
    expect(call?.[1]).toMatchObject({ p_project_id: 'p1', p_artifact: { id: 'a2' } });
    expect(names()).not.toContain('save_project_aggregate');
    expect(names()).not.toContain('load_project_aggregate');
  });

  it('never sends the revision inside the document: the server overlays it on read', async () => {
    setupProject([], { create_artifact_version: (args) => ({ ...(args.p_artifact as object), revision: 1 }) });
    const { createArtifactVersion } = await load();

    await createArtifactVersion('p1', withRevision(artifact('a3'), 9));

    const call = rpc.mock.calls.find(([name]) => name === 'create_artifact_version');
    expect(call?.[1]?.p_artifact).not.toHaveProperty('revision');
  });

  it('edits with the revision of that artifact, read from the project when the caller has none', async () => {
    setupProject([withRevision(artifact('a1'), 5), withRevision(artifact('a2'), 2)], {
      update_artifact: () => ({ ...artifact('a1'), revision: 6 }),
    });
    const { updateArtifact } = await load();

    const result = await updateArtifact('p1', 'a1', { name: 'Otro' });

    expect(result.success).toBe(true);
    expect(result.data?.revision).toBe(6);
    const call = rpc.mock.calls.find(([name]) => name === 'update_artifact');
    expect(call?.[1]).toMatchObject({ p_artifact_id: 'a1', p_expected_revision: 5, p_patch: { name: 'Otro' } });
    expect(names()).not.toContain('save_project_aggregate');
  });

  it('uses the revision the caller carries without re-reading the project', async () => {
    setupProject([], { update_artifact: () => ({ ...artifact('a1'), revision: 8 }) });
    const { updateArtifact } = await load();

    await updateArtifact('p1', 'a1', { name: 'Otro' }, { expectedRevision: 7 });

    expect(names()).toEqual(['update_artifact']);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_revision: 7 });
  });

  it('reports a stale revision as a conflict, which the hook rolls back', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: 'P0001', message: 'Conflicto de artefacto: recarga antes de guardar' } }));
    const { updateArtifact } = await load();

    const result = await updateArtifact('p1', 'a1', { name: 'Otro' }, { expectedRevision: 1 });

    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
  });

  it('refuses a duplicate id as a conflict', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: '23505', message: 'El id de artefacto ya existe' } }));
    const { createArtifact } = await load();

    const result = await createArtifact('p1', artifact('a1'));

    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
  });

  it('deleting something already gone is a success, not an error', async () => {
    setupProject([artifact('a1')]);
    const { deleteArtifact } = await load();

    const result = await deleteArtifact('p1', 'nope');

    expect(result.success).toBe(true);
    expect(names()).not.toContain('delete_artifact');
  });

  it('deletes one artifact by id and revision', async () => {
    setupProject([withRevision(artifact('a1'), 3)]);
    const { deleteArtifact } = await load();

    const result = await deleteArtifact('p1', 'a1');

    expect(result.success).toBe(true);
    const call = rpc.mock.calls.find(([name]) => name === 'delete_artifact');
    expect(call?.[1]).toEqual({ p_artifact_id: 'a1', p_expected_revision: 3 });
  });

  it('applies several changes in one transaction, each carrying its revision', async () => {
    setupProject([withRevision(artifact('a1'), 4)], { revise_artifacts: () => [] });
    const { reviseArtifacts, deletionChanges } = await load();

    const changes = await deletionChanges('p1', [{ id: 'a1' }, { id: 'gone' }]);
    const result = await reviseArtifacts('p1', changes);

    expect(result.success).toBe(true);
    const call = rpc.mock.calls.find(([name]) => name === 'revise_artifacts');
    expect(call?.[1]).toEqual({
      p_project_id: 'p1',
      p_changes: [{ op: 'delete', artifactId: 'a1', expectedRevision: 4 }],
    });
  });

  it('reports a rejected write instead of resolving as saved', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: '42501', message: 'Permiso insuficiente: project:write' } }));
    const { updateArtifact } = await load();

    const result = await updateArtifact('p1', 'a1', { name: 'Otro' }, { expectedRevision: 1 });

    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
  });
});

describe('writing the project root', () => {
  it('updates through save_project, with the revision the read returned, and sends no artifacts', async () => {
    rpc.mockImplementation(async (name, args) => {
      if (name === 'load_project_aggregate') return { data: projectRow([artifact('a1')], { revision: 3 }), error: null };
      if (name === 'load_knowledge_graph') return { data: null, error: { code: 'P0002', message: 'absent' } };
      if (name === 'save_project') return { data: { ...(args?.p_project as object), revision: 4 }, error: null };
      return { data: null, error: null };
    });
    const { updateProject } = await load();

    const result = await updateProject('p1', { name: 'Renombrado' });

    expect(result.success).toBe(true);
    const call = rpc.mock.calls.find(([name]) => name === 'save_project');
    // La revisión viene de la lectura: antes de F4-03 la lectura no la
    // devolvía y el cliente enviaba 0, así que la primera edición tras
    // recargar era un conflicto falso.
    expect(call?.[1]?.p_expected_revision).toBe(3);
    expect(call?.[1]?.p_project).not.toHaveProperty('artifacts');
    expect(rpc.mock.calls.some(([name]) => name === 'save_project_aggregate')).toBe(false);
  });

  it('creates through save_project with revision 0: one write path for the root (F4-06)', async () => {
    rpc.mockImplementation(async (name, args) => (
      name === 'save_project'
        ? { data: { ...(args?.p_project as object), revision: 1 }, error: null }
        : { data: null, error: null }
    ));
    const { createProject } = await load();

    const result = await createProject(projectRow([]) as unknown as ProjectRoot & { userId: string });

    expect(result.success).toBe(true);
    expect(result.data?.revision).toBe(1);
    const call = rpc.mock.calls.find(([name]) => name === 'save_project');
    expect(call?.[1]?.p_expected_revision).toBe(0);
    expect(call?.[1]).not.toHaveProperty('p_artifacts');
    expect(call?.[1]?.p_project).not.toHaveProperty('artifacts');
    expect(rpc.mock.calls.some(([name]) => name === 'save_project_aggregate')).toBe(false);
  });
});

describe('creating and deleting a project', () => {
  it('refuses to create a persistent project with no authenticated user', async () => {
    const { createProject } = await load();
    const result = await createProject({ ...projectRow([]), userId: undefined } as unknown as Project);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('project/missing-user-id');
  });

  it('reports what the deletion removed rather than assuming', async () => {
    rpc.mockImplementation(async (name) => (
      name === 'delete_project_aggregate'
        ? { data: { id: 'p1', engagements: 2, knowledgeGraphs: 1 }, error: null }
        : { data: null, error: null }
    ));
    const { deleteProject } = await load();

    const result = await deleteProject('p1');

    expect(result.success).toBe(true);
    expect(rpc.mock.calls.some(([name]) => name === 'delete_project_aggregate')).toBe(true);
  });
});
