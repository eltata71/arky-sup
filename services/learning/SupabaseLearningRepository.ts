import type { Course, SmartNote, StudentContext, UserProgress } from '../../types/lms';
import { createOperationId, type PersistenceResult } from '../persistence';

export type LearningRpcName =
  | 'list_courses'
  | 'save_course'
  | 'delete_course'
  | 'save_progress'
  | 'load_progress'
  | 'save_context'
  | 'load_context'
  | 'list_notes'
  | 'save_note'
  | 'delete_note';

/** Superficie mínima de RPC para el LMS; el SDK no cruza esta frontera. */
export interface SupabaseLearningClientLike {
  rpc(name: LearningRpcName, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface SupabaseLearningRepository {
  listCourses(userId: string, includeAll: boolean): Promise<Course[]>;
  saveCourse(course: Course, userId: string, expectedRevision?: number): Promise<PersistenceResult<Course>>;
  updateCourse(courseId: string, updates: Partial<Course>, userId: string): Promise<PersistenceResult<Course>>;
  deleteCourse(courseId: string, userId: string): Promise<PersistenceResult<void>>;
  saveProgress(progress: UserProgress, userId: string): Promise<PersistenceResult<void>>;
  loadProgress(): Promise<UserProgress | null>;
  saveContext(context: StudentContext, userId: string): Promise<PersistenceResult<void>>;
  loadContext(): Promise<StudentContext | null>;
  listNotes(userId: string): Promise<SmartNote[]>;
  saveNote(note: SmartNote, userId: string): Promise<PersistenceResult<void>>;
  deleteNote(noteId: string, userId: string): Promise<PersistenceResult<void>>;
}

interface RemoteRecord {
  readonly data: unknown;
  readonly revision: number;
  readonly ownerId: string | null;
}

type OperationStatus = 'conflict' | 'permission-denied' | 'offline' | 'validation-error' | 'failed';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasNonEmptyString = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'string' && value[key].trim() !== '';

const asRemoteRecord = (value: unknown): RemoteRecord | null => {
  if (!isRecord(value) || !Number.isInteger(value.revision) || (value.revision as number) < 1) return null;
  return {
    data: value.data,
    revision: value.revision as number,
    ownerId: typeof value.owner_id === 'string' ? value.owner_id : null,
  };
};

const asCourse = (value: unknown, fallbackUserId: string): Course | null => {
  if (!isRecord(value) || !hasNonEmptyString(value, 'id') || !hasNonEmptyString(value, 'title') || !hasNonEmptyString(value, 'description')) {
    return null;
  }
  return { ...value, userId: typeof value.userId === 'string' ? value.userId : fallbackUserId } as Course;
};

const asNote = (value: unknown, fallbackUserId: string): SmartNote | null => {
  if (!isRecord(value)
    || !hasNonEmptyString(value, 'id')
    || !hasNonEmptyString(value, 'courseId')
    || !hasNonEmptyString(value, 'lessonId')
    || !hasNonEmptyString(value, 'tabId')
    || typeof value.content !== 'string'
    || !Number.isFinite(value.createdAt)) return null;
  return { ...value, userId: typeof value.userId === 'string' ? value.userId : fallbackUserId } as SmartNote;
};

const asObject = <T extends object>(value: unknown): T | null => isRecord(value) ? value as T : null;

const statusFor = (error: unknown): OperationStatus => {
  const code = isRecord(error) ? error.code : undefined;
  const message = error instanceof Error ? error.message : '';
  if (code === 'P0001' || code === '23505') return 'conflict';
  if (code === '42501' || code === 'PGRST301') return 'permission-denied';
  if (code === '22023' || code === '23514') return 'validation-error';
  if (code === 'fetch' || code === 'ECONNABORTED' || /failed to fetch|networkerror/i.test(message)
    || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'offline';
  return 'failed';
};

const errorCodeFor = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === 'string' ? error.code : undefined;

const failed = <T>(operationId: string, error: unknown, message: string): PersistenceResult<T> => ({
  status: statusFor(error),
  success: false,
  operationId,
  target: 'supabase',
  error,
  errorCode: errorCodeFor(error),
  message,
});

/** Removes every secret-shaped apiKey before data crosses into PostgreSQL. */
export function sanitizeLearningForRemote<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeLearningForRemote) as T;
  if (!isRecord(value)) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'apiKey') sanitized[key] = sanitizeLearningForRemote(child);
  }
  return sanitized as T;
}

/**
 * Supabase adapter for the LMS persistence context.
 *
 * Writes return an unconfirmed result on every database failure. The caller may
 * retain a local draft, but this adapter never changes a remote failure into a
 * Firebase write or a successful result.
 */
export function createSupabaseLearningRepository(client: SupabaseLearningClientLike): SupabaseLearningRepository {
  // La revisión viaja en `Course.revision` (F6-03): hasta aquí vivía en un
  // `Map` de la instancia, la forma que H10 prohíbe y que en el grafo de
  // conocimiento rechazaba en silencio toda escritura tras recargar.
  const saveCourse = async (
    course: Course,
    userId: string,
    expectedRevision = course.revision ?? 0,
  ): Promise<PersistenceResult<Course>> => {
    const operationId = createOperationId('saveLearningCourse');
    if (course.userId !== undefined && course.userId !== userId) {
      return {
        status: 'validation-error',
        success: false,
        operationId,
        target: 'supabase',
        message: 'El curso no pertenece a la sesión que intenta guardarlo.',
      };
    }
    const { revision: _revision, ...document } = course;
    const payload = sanitizeLearningForRemote({ ...document, userId });
    const { data, error } = await client.rpc('save_course', {
      p_course: payload,
      p_expected_revision: expectedRevision,
    });
    if (error) return failed<Course>(operationId, error, 'No se pudo confirmar el curso en Supabase.');
    const record = asRemoteRecord(data);
    const saved = record ? asCourse(record.data, userId) : null;
    if (!record || !saved) {
      return {
        status: 'failed', success: false, operationId, target: 'supabase',
        message: 'Supabase confirmó una respuesta de curso inválida.',
      };
    }
    return { status: 'success', success: true, operationId, target: 'supabase', data: { ...saved, revision: record.revision } };
  };

  return {
    async listCourses(userId, includeAll) {
      const { data, error } = await client.rpc('list_courses', { p_include_all: includeAll });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('La respuesta remota de cursos no es una lista.');
      const courses: Course[] = [];
      for (const row of data) {
        const record = asRemoteRecord(row);
        const item = record ? asCourse(record.data, userId) : null;
        if (!record || !item) throw new Error('La respuesta remota de cursos contiene una fila inválida.');
        courses.push({ ...item, revision: record.revision });
      }
      return courses;
    },

    saveCourse,

    async updateCourse(courseId, updates, userId) {
      const courses = await this.listCourses(userId, false);
      const existing = courses.find((course) => course.id === courseId);
      const operationId = createOperationId('updateLearningCourse');
      if (!existing) {
        return {
          status: 'validation-error', success: false, operationId, target: 'supabase',
          message: 'El curso que se intenta actualizar no existe en la sesión actual.',
        };
      }
      return saveCourse({ ...existing, ...updates, id: courseId, userId }, userId, existing.revision ?? 0);
    },

    async deleteCourse(courseId, _userId) {
      const operationId = createOperationId('deleteLearningCourse');
      const { error } = await client.rpc('delete_course', { p_course_id: courseId });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el borrado del curso en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },

    async saveProgress(progress, userId) {
      const operationId = createOperationId('saveLearningProgress');
      const { error } = await client.rpc('save_progress', { p_progress: sanitizeLearningForRemote({ ...progress, userId }) });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el progreso de aprendizaje en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },

    async loadProgress() {
      const { data, error } = await client.rpc('load_progress', {});
      if (error) {
        const code = errorCodeFor(error);
        if (code === 'P0002') return null;
        throw error;
      }
      return asObject<UserProgress>(data);
    },

    async saveContext(context, userId) {
      const operationId = createOperationId('saveLearningContext');
      const { error } = await client.rpc('save_context', { p_context: sanitizeLearningForRemote({ ...context, userId }) });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el contexto de aprendizaje en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },

    async loadContext() {
      const { data, error } = await client.rpc('load_context', {});
      if (error) {
        const code = errorCodeFor(error);
        if (code === 'P0002') return null;
        throw error;
      }
      return asObject<StudentContext>(data);
    },

    async listNotes(userId) {
      const { data, error } = await client.rpc('list_notes', {});
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('La respuesta remota de notas no es una lista.');
      const notes = data.map((row) => {
        if (!isRecord(row) || !('data' in row)) return null;
        return asNote(row.data, userId);
      });
      if (notes.some((note) => note === null)) throw new Error('La respuesta remota de notas contiene una fila inválida.');
      return notes as SmartNote[];
    },

    async saveNote(note, userId) {
      const operationId = createOperationId('saveLearningNote');
      if (note.userId !== undefined && note.userId !== userId) {
        return {
          status: 'validation-error', success: false, operationId, target: 'supabase',
          message: 'La nota no pertenece a la sesión que intenta guardarla.',
        };
      }
      const { error } = await client.rpc('save_note', { p_note: sanitizeLearningForRemote({ ...note, userId }) });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar la nota en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },

    async deleteNote(noteId, _userId) {
      const operationId = createOperationId('deleteLearningNote');
      const { error } = await client.rpc('delete_note', { p_note_id: noteId });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el borrado de la nota en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },
  };
}
