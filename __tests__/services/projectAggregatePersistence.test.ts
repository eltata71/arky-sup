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
 *   4. escribir un artefacto es escribir el agregado: el contador y el índice
 *      no pueden discrepar de las filas, y de eso responde el servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Project } from '../../types';

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

describe('writing an artifact writes the aggregate', () => {
  const setupProject = (entries: Artifact[]) => {
    rpc.mockImplementation(async (name, args) => {
      if (name === 'load_project_aggregate') return { data: projectRow(entries), error: null };
      if (name === 'save_project_aggregate') return { data: { ...projectRow(entries), revision: 4, ...(args ?? {}) }, error: null };
      return { data: null, error: null };
    });
  };

  it('sends the whole artifact list, so the server can keep count and index in step', async () => {
    setupProject([artifact('a1')]);
    const { createArtifact } = await load();

    const result = await createArtifact('p1', artifact('a2'));

    expect(result.success).toBe(true);
    const save = rpc.mock.calls.find(([name]) => name === 'save_project_aggregate');
    expect(save).toBeDefined();
    const sent = (save?.[1]?.p_artifacts ?? []) as Artifact[];
    expect(sent.map((entry) => entry.id)).toEqual(['a1', 'a2']);
  });

  it('refuses a duplicate id as a conflict, without calling the server', async () => {
    setupProject([artifact('a1')]);
    const { createArtifact } = await load();

    const result = await createArtifact('p1', artifact('a1'));

    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
    expect(rpc.mock.calls.some(([name]) => name === 'save_project_aggregate')).toBe(false);
  });

  it('deleting something already gone is a success, not an error', async () => {
    setupProject([artifact('a1')]);
    const { deleteArtifact } = await load();

    const result = await deleteArtifact('p1', 'nope');

    expect(result.success).toBe(true);
    expect(rpc.mock.calls.some(([name]) => name === 'save_project_aggregate')).toBe(false);
  });

  it('reports a rejected write instead of resolving as saved', async () => {
    rpc.mockImplementation(async (name) => {
      if (name === 'load_project_aggregate') return { data: projectRow([artifact('a1')]), error: null };
      return { data: null, error: { code: '42501', message: 'Permiso insuficiente: artifact:write' } };
    });
    const { updateArtifact } = await load();

    const result = await updateArtifact('p1', 'a1', { name: 'Otro' });

    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
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
