/**
 * Training Center persistence.
 *
 * Every write here used to end in the same shape:
 *
 *     } catch (error) {
 *         console.warn("TrainingService: ... falling back to local storage", error);
 *
 * which meant a database rejection — wrong permissions, quota, offline —
 * silently became a `localStorage` write. The rest of the product had already
 * been taught not to do that: `services/persistence` classifies every remote
 * write into a `PersistenceResult`, and `LMSContext` renders the outcome. The
 * Training Center was the one surface still deciding on its own that a failed
 * save was not worth mentioning, so a trainer who authored a course saw a
 * success and had a course that existed only in their browser.
 *
 * The local copy is still written — losing the work would be worse — but it is
 * now reported as what it is. A result with `target: 'local-draft'` says the
 * data is here and not there, and `LMSContext` turns that into the sync banner.
 *
 * **F9 made the remote PostgreSQL.** The shape above did not change; what went
 * away is the merge-with-local on every read. That merge existed because
 * Firestore rules could reject a read and return an empty list that looked like
 * "no courses", so the local copy was folded in to cover it. `api.list_courses`
 * *raises* on an insufficient permission instead of returning nothing, so the
 * failure is now distinguishable and the local copy is read only when the read
 * actually failed — which is the difference between degrading and guessing.
 */
import { Course, SmartNote, UserProgress, StudentContext } from '../../types/lms';
import {
    PersistenceResult,
    createFailureResult,
    isWriteConfirmed,
} from '../persistence';
import { loadSupabaseDataClient } from '../adapters';
import { createSupabaseLearningRepository, type SupabaseLearningRepository } from './SupabaseLearningRepository';

const COURSES_KEY = 'courses';
const PROGRESS_KEY = 'lms_progress';
const CONTEXT_KEY = 'lms_context';
const NOTES_KEY = 'lms_notes';

export type TrainingWriteResult = PersistenceResult<void>;

let remote: SupabaseLearningRepository | null = null;
const getRemote = async (): Promise<SupabaseLearningRepository> => {
    if (!remote) {
        const client = await loadSupabaseDataClient();
        remote = createSupabaseLearningRepository(
            client as unknown as Parameters<typeof createSupabaseLearningRepository>[0],
        );
    }
    return remote;
};

/** Solo para pruebas: olvida el repositorio remoto memorizado. */
export const resetTrainingServiceCache = (): void => { remote = null; };

class TrainingService {

    private getLocalItem<T>(key: string): T | null {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch {
            return null;
        }
    }

    private setLocalItem<T>(key: string, value: T): void {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error("LocalStorage error", e);
        }
    }

    /**
     * The remote write did not land, and the data was kept in this browser.
     *
     * The remote failure's `status` and `errorCode` are preserved, because the
     * reason it failed is what tells a user whether to retry or to call an
     * administrator. Only the target and the message change: "saved here" and
     * "saved" are not the same claim, and the message is the one the user
     * reads.
     */
    private asLocalDraft(remoteResult: PersistenceResult<unknown>, message: string): TrainingWriteResult {
        return { ...remoteResult, success: false, target: 'local-draft', message } as TrainingWriteResult;
    }

    private async write(
        operationName: string,
        operation: (client: SupabaseLearningRepository) => Promise<PersistenceResult<unknown>>,
    ): Promise<PersistenceResult<unknown>> {
        try {
            return await operation(await getRemote());
        } catch (error) {
            return createFailureResult(operationName, error);
        }
    }

    // --- Courses ---

    async saveCourse(userId: string, course: Course): Promise<TrainingWriteResult> {
        const result = await this.write('saveCourse', (client) => client.saveCourse(course, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        const courses = this.getLocalItem<Course[]>(COURSES_KEY) || [];
        const index = courses.findIndex(c => c.id === course.id);
        if (index !== -1) {
            courses[index] = { ...course, userId };
        } else {
            courses.push({ ...course, userId });
        }
        this.setLocalItem(COURSES_KEY, courses);
        return this.asLocalDraft(result, 'El curso se guardó sólo en este navegador. No está publicado para el resto del equipo.');
    }

    async getCourses(userId: string, isAdmin?: boolean): Promise<Course[]> {
        try {
            return await (await getRemote()).listCourses(userId, isAdmin ?? false);
        } catch (error) {
            console.warn('TrainingService: no se pudieron leer los cursos; se usa el espejo local', error);
            const allCourses = this.getLocalItem<Course[]>(COURSES_KEY) || [];
            return isAdmin ? allCourses : allCourses.filter(c => c.userId === userId);
        }
    }

    async updateCourse(userId: string, courseId: string, updates: Partial<Course>): Promise<TrainingWriteResult> {
        const result = await this.write('updateCourse', (client) => client.updateCourse(courseId, updates, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        const courses = this.getLocalItem<Course[]>(COURSES_KEY) || [];
        const index = courses.findIndex(c => c.id === courseId);
        if (index !== -1) {
            courses[index] = { ...courses[index], ...updates };
            this.setLocalItem(COURSES_KEY, courses);
        }
        return this.asLocalDraft(result, 'El cambio en el curso quedó sólo en este navegador. Reintenta o revisa permisos.');
    }

    async deleteCourse(userId: string, courseId: string): Promise<TrainingWriteResult> {
        const result = await this.write('deleteCourse', (client) => client.deleteCourse(courseId, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        let courses = this.getLocalItem<Course[]>(COURSES_KEY) || [];
        courses = courses.filter(c => c.id !== courseId);
        this.setLocalItem(COURSES_KEY, courses);
        return this.asLocalDraft(result, 'El curso se ocultó en este navegador, pero sigue existiendo en la base de datos.');
    }

    // --- Smart Notes ---

    async saveSmartNote(userId: string, note: SmartNote): Promise<TrainingWriteResult> {
        const result = await this.write('saveSmartNote', (client) => client.saveNote(note, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        const notes = this.getLocalItem<SmartNote[]>(NOTES_KEY) || [];
        notes.push({ ...note, userId });
        this.setLocalItem(NOTES_KEY, notes);
        return this.asLocalDraft(result, 'La nota se guardó sólo en este navegador. No estará en tus otros dispositivos.');
    }

    async getSmartNotes(userId: string): Promise<SmartNote[]> {
        try {
            return await (await getRemote()).listNotes(userId);
        } catch (error) {
            console.warn('TrainingService: no se pudieron leer las notas; se usa el espejo local', error);
            const allNotes = this.getLocalItem<SmartNote[]>(NOTES_KEY) || [];
            return allNotes.filter(n => n.userId === userId);
        }
    }

    async deleteSmartNote(userId: string, noteId: string): Promise<TrainingWriteResult> {
        const result = await this.write('deleteSmartNote', (client) => client.deleteNote(noteId, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        let notes = this.getLocalItem<SmartNote[]>(NOTES_KEY) || [];
        notes = notes.filter(n => n.id !== noteId);
        this.setLocalItem(NOTES_KEY, notes);
        return this.asLocalDraft(result, 'La nota se ocultó en este navegador, pero sigue guardada en tu cuenta.');
    }

    // --- Progress ---

    async saveProgress(userId: string, progress: UserProgress): Promise<TrainingWriteResult> {
        const result = await this.write('saveProgress', (client) => client.saveProgress(progress, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        this.setLocalItem(`${PROGRESS_KEY}_${userId}`, progress);
        return this.asLocalDraft(result, 'Tu avance se guardó sólo en este navegador. No se verá reflejado en otro dispositivo.');
    }

    async getProgress(userId: string): Promise<UserProgress | null> {
        try {
            return await (await getRemote()).loadProgress();
        } catch (error) {
            console.warn('TrainingService: no se pudo leer el avance; se usa el espejo local', error);
            return this.getLocalItem<UserProgress>(`${PROGRESS_KEY}_${userId}`);
        }
    }

    // --- Context ---

    async saveContext(userId: string, context: StudentContext): Promise<TrainingWriteResult> {
        const result = await this.write('saveContext', (client) => client.saveContext(context, userId));
        if (isWriteConfirmed(result)) return result as TrainingWriteResult;

        this.setLocalItem(`${CONTEXT_KEY}_${userId}`, context);
        return this.asLocalDraft(result, 'Tu perfil de aprendizaje se guardó sólo en este navegador.');
    }

    async getContext(userId: string): Promise<StudentContext | null> {
        try {
            return await (await getRemote()).loadContext();
        } catch (error) {
            console.warn('TrainingService: no se pudo leer el perfil; se usa el espejo local', error);
            return this.getLocalItem<StudentContext>(`${CONTEXT_KEY}_${userId}`);
        }
    }
}

export const trainingService = new TrainingService();
