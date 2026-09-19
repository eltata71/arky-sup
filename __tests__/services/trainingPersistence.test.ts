/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code under test writes to `localStorage` when the
 * remote write does not land — which is the whole point of these cases.
 *
 * What this locks in: a Training Center write the database rejects must not
 * look like a success. Every method here used to `catch` the rejection, write
 * to `localStorage` and resolve as if nothing had happened, so a trainer whose
 * course was refused by the security rules saw it saved and had it only in
 * their own browser. The regression is silent by construction — the app keeps
 * working, it just stops telling the truth — so it needs a test rather than
 * review.
 *
 * El proveedor cambió en F9 y el hecho afirmado no: lo que antes era un
 * `permission-denied` de Firestore es ahora un `42501` de PostgreSQL, que es lo
 * que levantan las guardas de rol y de sesión de cada RPC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course, SmartNote, StudentContext, UserProgress } from '../../types/lms';

const { observabilityRecordWarning, observabilityReportError, observabilityTrackEvent } = vi.hoisted(() => ({
  observabilityRecordWarning: vi.fn(),
  observabilityReportError: vi.fn(),
  observabilityTrackEvent: vi.fn(() => ({ id: 'event-1', at: new Date().toISOString() })),
}));

vi.mock('../../services/observability', () => ({
  observabilityService: {
    recordWarning: observabilityRecordWarning,
    reportError: observabilityReportError,
    trackEvent: observabilityTrackEvent,
  },
}));

/**
 * La única puerta: la RPC. Se dobla el cliente y no el repositorio remoto, de
 * modo que la traducción de `{ data, error }` a `PersistenceResult` —que es
 * donde vivía el defecto original— siga estando bajo prueba.
 */
const rpc = vi.fn(async (_name: string, _args?: unknown) => ({ data: null as unknown, error: null as unknown }));

vi.mock('../../services/adapters', () => ({
  loadSupabaseDataClient: vi.fn(async () => ({ rpc: (name: string, args?: Record<string, unknown>) => rpc(name, args) })),
}));

const { trainingService } = await import('../../services/learning/trainingService');

const course: Course = {
  id: 'course-1',
  title: 'Arquitectura de Soluciones',
  description: 'Curso de prueba',
  category: 'Architecture',
  role: 'Arquitecto de Soluciones',
  level: 'Intermedio',
  icon: 'GraduationCap',
  modules: [],
};

const note: SmartNote = {
  id: 'note-1',
  courseId: 'course-1',
  lessonId: 'lesson-1',
  tabId: 'tab-1',
  content: 'Nota',
  createdAt: 0,
};

const progress = { readLessons: [], favoriteLessons: [] } as unknown as UserProgress;
const studentContext = { role: 'Arquitecto de Soluciones' } as unknown as StudentContext;

/** El rechazo que produce una guarda de permiso o de sesión en una RPC. */
const permissionDenied = () => ({
  data: null,
  error: { code: '42501', message: 'Permiso insuficiente: training:author' },
});

/** Lo que devuelve una RPC que guardó: la fila con su revisión. */
const savedRow = (data: unknown = {}) => ({
  data: { data, revision: 1, owner_id: 'user-1' },
  error: null,
});

/** Un backend que acepta todo, con la forma que cada RPC devuelve de verdad. */
const acceptEverything = async (name: string) => (
  name === 'list_courses' ? { data: [savedRow(course).data], error: null } : savedRow(course)
);

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  rpc.mockImplementation(acceptEverything);
  const { resetTrainingServiceCache } = await import('../../services/learning/trainingService');
  resetTrainingServiceCache();
});

describe('Training Center writes report what actually happened', () => {
  it('confirms a write the database accepted', async () => {
    const result = await trainingService.saveCourse('user-1', course);

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.target).toBe('supabase');
  });

  it('does not report success when the database refuses the course', async () => {
    rpc.mockResolvedValueOnce(permissionDenied());

    const result = await trainingService.saveCourse('user-1', course);

    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
    // The work is kept, and the result says where it is kept.
    expect(result.target).toBe('local-draft');
    expect(result.message).toContain('sólo en este navegador');
    expect(JSON.parse(localStorage.getItem('courses') ?? '[]')).toHaveLength(1);
  });

  it('carries the provider code so the caller can tell retry from call-an-admin', async () => {
    rpc.mockResolvedValueOnce(permissionDenied());

    const result = await trainingService.saveCourse('user-1', course);

    expect(result.status).toBe('permission-denied');
    expect(result.errorCode).toBe('42501');
  });

  it.each([
    ['updateCourse', () => trainingService.updateCourse('user-1', 'course-1', { title: 'Otro' })],
    ['deleteCourse', () => trainingService.deleteCourse('user-1', 'course-1')],
    ['saveSmartNote', () => trainingService.saveSmartNote('user-1', note)],
    ['deleteSmartNote', () => trainingService.deleteSmartNote('user-1', 'note-1')],
    ['saveProgress', () => trainingService.saveProgress('user-1', progress)],
    ['saveContext', () => trainingService.saveContext('user-1', studentContext)],
  ])('%s degrades to a local draft rather than a silent success', async (_name, call) => {
    rpc.mockImplementation(async (name: string) => (
      name === 'list_courses' ? { data: [savedRow(course).data], error: null } : permissionDenied()
    ));

    const result = await call();

    expect(result.success).toBe(false);
    expect(result.target).toBe('local-draft');
    expect(result.message).toBeTruthy();
  });

  it('every write returns a confirmed result on the happy path', async () => {
    const results = await Promise.all([
      trainingService.saveCourse('user-1', course),
      trainingService.updateCourse('user-1', 'course-1', { title: 'Otro' }),
      trainingService.deleteCourse('user-1', 'course-1'),
      trainingService.saveSmartNote('user-1', note),
      trainingService.deleteSmartNote('user-1', 'note-1'),
      trainingService.saveProgress('user-1', progress),
      trainingService.saveContext('user-1', studentContext),
    ]);

    expect(results.every(result => result.success && result.target === 'supabase')).toBe(true);
  });
});
