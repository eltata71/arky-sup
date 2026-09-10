/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code under test writes to `localStorage` when the
 * remote write does not land — which is the whole point of these cases.
 *
 * What this locks in: a Training Center write that Firestore rejects must not
 * look like a success. Every method here used to `catch` the rejection, write
 * to `localStorage` and resolve as if nothing had happened, so a trainer whose
 * course was refused by the security rules saw it saved and had it only in
 * their own browser. The regression is silent by construction — the app keeps
 * working, it just stops telling the truth — so it needs a test rather than
 * review.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course, SmartNote, StudentContext, UserProgress } from '../../types/lms';

const { observabilityRecordWarning, observabilityReportError, observabilityTrackEvent } = vi.hoisted(() => ({
  observabilityRecordWarning: vi.fn(),
  observabilityReportError: vi.fn(),
  observabilityTrackEvent: vi.fn(() => ({ id: 'event-1', at: new Date().toISOString() })),
}));

vi.mock('../../firebase', () => ({
  db: {},
  auth: {},
  isFirebaseAvailable: true,
}));

vi.mock('../../services/observability', () => ({
  observabilityService: {
    recordWarning: observabilityRecordWarning,
    reportError: observabilityReportError,
    trackEvent: observabilityTrackEvent,
  },
}));

const setDoc = vi.fn(async () => undefined);
const updateDoc = vi.fn(async () => undefined);
const deleteDoc = vi.fn(async () => undefined);

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: (...args: unknown[]) => setDoc(...(args as [])),
  updateDoc: (...args: unknown[]) => updateDoc(...(args as [])),
  deleteDoc: (...args: unknown[]) => deleteDoc(...(args as [])),
  query: vi.fn((ref: unknown) => ref),
  where: vi.fn(),
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

/** A Firestore rejection of the shape the rules produce. */
const permissionDenied = () => {
  const error = new Error('Missing or insufficient permissions.') as Error & { code: string };
  error.code = 'permission-denied';
  return error;
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setDoc.mockResolvedValue(undefined);
  updateDoc.mockResolvedValue(undefined);
  deleteDoc.mockResolvedValue(undefined);
});

describe('Training Center writes report what actually happened', () => {
  it('confirms a write that Firestore accepted', async () => {
    const result = await trainingService.saveCourse('user-1', course);

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.target).toBe('firestore');
  });

  it('does not report success when Firestore refuses the course', async () => {
    setDoc.mockRejectedValueOnce(permissionDenied());

    const result = await trainingService.saveCourse('user-1', course);

    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
    // The work is kept, and the result says where it is kept.
    expect(result.target).toBe('local-draft');
    expect(result.message).toContain('sólo en este navegador');
    expect(JSON.parse(localStorage.getItem('courses') ?? '[]')).toHaveLength(1);
  });

  it('reports the failure through observability instead of a console warning', async () => {
    setDoc.mockRejectedValueOnce(permissionDenied());

    await trainingService.saveCourse('user-1', course);

    expect(observabilityReportError).toHaveBeenCalledTimes(1);
    expect(observabilityReportError.mock.calls[0][1]).toMatchObject({
      operationName: 'saveCourse',
      userVisible: true,
    });
  });

  it.each([
    ['updateCourse', () => trainingService.updateCourse('user-1', 'course-1', { title: 'Otro' }), () => updateDoc],
    ['deleteCourse', () => trainingService.deleteCourse('user-1', 'course-1'), () => deleteDoc],
    ['saveSmartNote', () => trainingService.saveSmartNote('user-1', note), () => setDoc],
    ['deleteSmartNote', () => trainingService.deleteSmartNote('user-1', 'note-1'), () => deleteDoc],
    ['saveProgress', () => trainingService.saveProgress('user-1', progress), () => setDoc],
    ['saveContext', () => trainingService.saveContext('user-1', studentContext), () => setDoc],
  ])('%s degrades to a local draft rather than a silent success', async (_name, call, spyOf) => {
    spyOf().mockRejectedValueOnce(permissionDenied());

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

    expect(results.every(result => result.success && result.target === 'firestore')).toBe(true);
  });
});
