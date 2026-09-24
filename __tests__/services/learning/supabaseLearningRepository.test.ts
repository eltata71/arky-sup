import { describe, expect, it, vi } from 'vitest';
import type { Course, SmartNote, StudentContext, UserProgress } from '../../../types/lms';
import {
  createSupabaseLearningRepository,
  sanitizeLearningForRemote,
  type SupabaseLearningClientLike,
} from '../../../services/learning/SupabaseLearningRepository';

const USER_ID = '00000000-0000-4000-8000-000000000001';

const course = (id = 'course-1'): Course => ({
  id,
  title: 'Arquitectura de Soluciones',
  description: 'Curso de prueba',
  icon: 'GraduationCap',
  category: 'Architecture',
  level: 'Intermedio',
  role: 'Arquitecto de Soluciones',
  modules: [{
    id: 'module-1',
    title: 'Módulo 1',
    level: 'Intermedio',
    lessons: [{ id: 'lesson-1', title: 'Lección 1', description: 'Contenido' }],
  }],
  userId: USER_ID,
  updatedAt: '2026-09-12T00:00:00.000Z',
});

const note: SmartNote = {
  id: 'note-1',
  courseId: 'course-1',
  lessonId: 'lesson-1',
  tabId: 'tab-1',
  content: 'Nota',
  createdAt: 0,
  userId: USER_ID,
};

const progress: UserProgress = {
  readLessons: [],
  inProgressLessons: [],
  favoriteLessons: [],
  favoriteCourses: [],
  inProgressCourses: [],
};

const studentContext: StudentContext = {
  industry: 'Seguros',
  techStack: 'React',
  currentProject: 'ARKY',
};

const row = (data: unknown, revision = 1) => ({ data, revision, owner_id: USER_ID });

function fakeClient(): { client: SupabaseLearningClientLike; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn();
  return { client: { rpc } as unknown as SupabaseLearningClientLike, rpc };
}

describe('SupabaseLearningRepository', () => {
  it('lista cursos con su revisión, que viaja con cada curso (F6-03)', async () => {
    const { client, rpc } = fakeClient();
    rpc.mockResolvedValueOnce({ data: [row(course('course-1'), 2), row(course('course-2'), 1)], error: null });
    const repository = createSupabaseLearningRepository(client);

    await expect(repository.listCourses(USER_ID, true)).resolves.toEqual([
      { ...course('course-1'), revision: 2 },
      { ...course('course-2'), revision: 1 },
    ]);
    expect(rpc).toHaveBeenCalledWith('list_courses', { p_include_all: true });
  });

  it('guarda contra la revisión del curso y nunca la escribe en el documento', async () => {
    const { client, rpc } = fakeClient();
    rpc.mockResolvedValueOnce({ data: row(course(), 4), error: null });
    // Otra instancia del repositorio: la revisión no depende de quién leyó.
    const result = await createSupabaseLearningRepository(client).saveCourse({ ...course(), revision: 3 }, USER_ID);

    expect(rpc).toHaveBeenCalledWith('save_course', { p_course: course(), p_expected_revision: 3 });
    expect(result.data?.revision).toBe(4);
  });

  it('guarda un curso del autor con la revisión esperada y solo confirma una fila válida', async () => {
    const { client, rpc } = fakeClient();
    rpc.mockResolvedValueOnce({ data: row(course(), 2), error: null });
    const repository = createSupabaseLearningRepository(client);

    await expect(repository.saveCourse(course(), USER_ID, 1)).resolves.toMatchObject({
      success: true,
      status: 'success',
      target: 'supabase',
      data: course(),
    });
    expect(rpc).toHaveBeenCalledWith('save_course', {
      p_course: course(),
      p_expected_revision: 1,
    });
  });

  it('rechaza antes de la red un curso que declara otro propietario', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseLearningRepository(client);

    await expect(repository.saveCourse({ ...course(), userId: 'other-user' }, USER_ID)).resolves.toMatchObject({
      success: false,
      status: 'validation-error',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['P0001', 'conflict'],
    ['42501', 'permission-denied'],
    ['22023', 'validation-error'],
    ['fetch', 'offline'],
  ] as const)('clasifica %s sin anunciar una escritura confirmada', async (code, status) => {
    const { client, rpc } = fakeClient();
    rpc.mockResolvedValueOnce({ data: null, error: { code } });

    await expect(createSupabaseLearningRepository(client).saveCourse(course(), USER_ID, 1)).resolves.toMatchObject({
      success: false,
      status,
      target: 'supabase',
    });
  });

  it('fusiona la actualización parcial con el curso remoto y conserva su revisión', async () => {
    const { client, rpc } = fakeClient();
    rpc
      .mockResolvedValueOnce({ data: [row(course(), 4)], error: null })
      .mockResolvedValueOnce({ data: row({ ...course(), title: 'Nuevo título' }, 5), error: null });
    const repository = createSupabaseLearningRepository(client);

    await expect(repository.updateCourse('course-1', { title: 'Nuevo título' }, USER_ID)).resolves.toMatchObject({
      success: true,
      data: { id: 'course-1', title: 'Nuevo título', userId: USER_ID },
    });
    expect(rpc).toHaveBeenLastCalledWith('save_course', expect.objectContaining({
      p_course: expect.objectContaining({ title: 'Nuevo título' }),
      p_expected_revision: 4,
    }));
  });

  it('persiste progreso, contexto y notas sin convertir fallos en éxito local', async () => {
    const { client, rpc } = fakeClient();
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { ...progress, updatedAt: '2026-09-12T00:00:00.000Z' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { ...studentContext, updatedAt: '2026-09-12T00:00:00.000Z' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: [row(note)], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const repository = createSupabaseLearningRepository(client);

    await expect(repository.saveProgress(progress, USER_ID)).resolves.toMatchObject({ success: true });
    await expect(repository.loadProgress()).resolves.toMatchObject(progress);
    await expect(repository.saveContext(studentContext, USER_ID)).resolves.toMatchObject({ success: true });
    await expect(repository.loadContext()).resolves.toMatchObject(studentContext);
    await expect(repository.saveNote(note, USER_ID)).resolves.toMatchObject({ success: true });
    await expect(repository.listNotes(USER_ID)).resolves.toEqual([note]);
    await expect(repository.deleteNote('note-1', USER_ID)).resolves.toMatchObject({ success: true });
  });
});

describe('sanitizeLearningForRemote', () => {
  it('elimina apiKey en cualquier profundidad sin alterar el resto del payload', () => {
    const unsafe = {
      safe: 1,
      nested: { apiKey: 'never-send-this', items: [{ apiKey: 'also-never-send-this', keep: true }] },
    };

    expect(sanitizeLearningForRemote(unsafe)).toEqual({ safe: 1, nested: { items: [{ keep: true }] } });
  });
});
