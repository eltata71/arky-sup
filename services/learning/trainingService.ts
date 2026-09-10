/**
 * Training Center persistence.
 *
 * Every write here used to end in the same shape:
 *
 *     } catch (error) {
 *         console.warn("TrainingService: ... falling back to local storage", error);
 *
 * which meant a Firestore rejection — wrong permissions, quota, offline —
 * silently became a `localStorage` write. The rest of the product had already
 * been taught not to do that: `services/persistence.ts` classifies every
 * remote write into a `PersistenceResult`, and `AppContext` renders the
 * outcome. The Training Center was the one surface still deciding on its own
 * that a failed save was not worth mentioning, so a trainer who authored a
 * course saw a success and had a course that existed only in their browser.
 *
 * The local copy is still written — losing the work would be worse — but it is
 * now reported as what it is. A result with `target: 'local-draft'` says the
 * data is here and not there, and `LMSContext` turns that into the sync banner.
 */
import { db } from '../../firebase';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where
} from 'firebase/firestore';
import { Course, SmartNote, UserProgress, StudentContext } from '../../types/lms';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
    PersistenceResult,
    executeRemoteWrite,
    isWriteConfirmed,
    requireDb,
} from '../persistence';

const COURSES_COLLECTION = "courses";
const PROGRESS_COLLECTION = "lms_progress";
const CONTEXT_COLLECTION = "lms_context";
const NOTES_COLLECTION = "lms_notes";

export type TrainingWriteResult = PersistenceResult<void>;

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
    private asLocalDraft(remote: TrainingWriteResult, message: string): TrainingWriteResult {
        return { ...remote, success: false, target: 'local-draft', message };
    }

    // --- Courses ---

    async saveCourse(userId: string, course: Course): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'saveCourse', userId }, async () => {
            const courseRef = doc(requireDb(db), COURSES_COLLECTION, course.id);
            await setDoc(courseRef, sanitizeForFirestore({ ...course, userId, updatedAt: new Date().toISOString() }));
        });
        if (isWriteConfirmed(result)) return result;

        const courses = this.getLocalItem<Course[]>(COURSES_COLLECTION) || [];
        const index = courses.findIndex(c => c.id === course.id);
        if (index !== -1) {
            courses[index] = { ...course, userId };
        } else {
            courses.push({ ...course, userId });
        }
        this.setLocalItem(COURSES_COLLECTION, courses);
        return this.asLocalDraft(result, 'El curso se guardó sólo en este navegador. No está publicado para el resto del equipo.');
    }

    async getCourses(userId: string, isAdmin?: boolean): Promise<Course[]> {
        try {
            let q;
            if (isAdmin) {
                q = collection(requireDb(db), COURSES_COLLECTION);
            } else {
                q = query(collection(requireDb(db), COURSES_COLLECTION), where("userId", "==", userId));
            }
            const snapshot = await getDocs(q);
            const firestoreCourses = snapshot.docs.map(doc => {
                const data = doc.data() as Course;
                return { ...data, id: doc.id };
            });

            // Merge with local storage to ensure no data is lost if Firestore rules act up
            const localCourses = this.getLocalItem<Course[]>(COURSES_COLLECTION) || [];
            const userLocalCourses = isAdmin ? localCourses : localCourses.filter(c => c.userId === userId);

            const merged = [...firestoreCourses];
            userLocalCourses.forEach(lc => {
                if (!merged.find(c => c.id === lc.id)) {
                    merged.push(lc);
                } else {
                    // If it exists in both, use the one with the latest updatedAt if available
                    const index = merged.findIndex(c => c.id === lc.id);
                    const firestoreDate = merged[index].updatedAt ? new Date(merged[index].updatedAt!).getTime() : 0;
                    const localDate = lc.updatedAt ? new Date(lc.updatedAt).getTime() : 0;
                    if (localDate > firestoreDate) {
                        merged[index] = lc;
                    }
                }
            });
            return merged;
        } catch (error) {
            console.warn("TrainingService: Error getting courses, falling back to local storage", error);
            const allCourses = this.getLocalItem<Course[]>(COURSES_COLLECTION) || [];
            if (isAdmin) return allCourses;
            return allCourses.filter(c => c.userId === userId);
        }
    }

    async updateCourse(userId: string, courseId: string, updates: Partial<Course>): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'updateCourse', userId }, async () => {
            const courseRef = doc(requireDb(db), COURSES_COLLECTION, courseId);
            await updateDoc(courseRef, sanitizeForFirestore({ ...updates, updatedAt: new Date().toISOString() }));
        });
        if (isWriteConfirmed(result)) return result;

        const courses = this.getLocalItem<Course[]>(COURSES_COLLECTION) || [];
        const index = courses.findIndex(c => c.id === courseId);
        if (index !== -1) {
            courses[index] = { ...courses[index], ...updates };
            this.setLocalItem(COURSES_COLLECTION, courses);
        }
        return this.asLocalDraft(result, 'El cambio en el curso quedó sólo en este navegador. Reintenta o revisa permisos.');
    }

    async deleteCourse(userId: string, courseId: string): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'deleteCourse', userId }, async () => {
            const courseRef = doc(requireDb(db), COURSES_COLLECTION, courseId);
            await deleteDoc(courseRef);
        });
        if (isWriteConfirmed(result)) return result;

        let courses = this.getLocalItem<Course[]>(COURSES_COLLECTION) || [];
        courses = courses.filter(c => c.id !== courseId);
        this.setLocalItem(COURSES_COLLECTION, courses);
        return this.asLocalDraft(result, 'El curso se ocultó en este navegador, pero sigue existiendo en la base de datos.');
    }

    // --- Smart Notes ---

    async saveSmartNote(userId: string, note: SmartNote): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'saveSmartNote', userId }, async () => {
            const noteRef = doc(requireDb(db), `users/${userId}/${NOTES_COLLECTION}`, note.id);
            await setDoc(noteRef, sanitizeForFirestore({ ...note, userId }));
        });
        if (isWriteConfirmed(result)) return result;

        const notes = this.getLocalItem<SmartNote[]>(NOTES_COLLECTION) || [];
        notes.push({ ...note, userId });
        this.setLocalItem(NOTES_COLLECTION, notes);
        return this.asLocalDraft(result, 'La nota se guardó sólo en este navegador. No estará en tus otros dispositivos.');
    }

    async getSmartNotes(userId: string): Promise<SmartNote[]> {
        try {
            const q = query(collection(requireDb(db), `users/${userId}/${NOTES_COLLECTION}`));
            const snapshot = await getDocs(q);
            const firestoreNotes = snapshot.docs.map(doc => doc.data() as SmartNote);

            const localNotes = this.getLocalItem<SmartNote[]>(NOTES_COLLECTION) || [];
            const userLocalNotes = localNotes.filter(n => n.userId === userId);

            const merged = [...firestoreNotes];
            userLocalNotes.forEach(ln => {
                if (!merged.find(n => n.id === ln.id)) {
                    merged.push(ln);
                }
            });
            return merged;
        } catch (error) {
            console.warn("TrainingService: Error getting smart notes, falling back to local storage", error);
            const allNotes = this.getLocalItem<SmartNote[]>(NOTES_COLLECTION) || [];
            return allNotes.filter(n => n.userId === userId);
        }
    }

    async deleteSmartNote(userId: string, noteId: string): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'deleteSmartNote', userId }, async () => {
            const noteRef = doc(requireDb(db), `users/${userId}/${NOTES_COLLECTION}`, noteId);
            await deleteDoc(noteRef);
        });
        if (isWriteConfirmed(result)) return result;

        let notes = this.getLocalItem<SmartNote[]>(NOTES_COLLECTION) || [];
        notes = notes.filter(n => n.id !== noteId);
        this.setLocalItem(NOTES_COLLECTION, notes);
        return this.asLocalDraft(result, 'La nota se ocultó en este navegador, pero sigue guardada en tu cuenta.');
    }

    // --- Progress ---

    async saveProgress(userId: string, progress: UserProgress): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'saveProgress', userId }, async () => {
            const progressRef = doc(requireDb(db), `users/${userId}/${PROGRESS_COLLECTION}`, 'main');
            await setDoc(progressRef, sanitizeForFirestore({ ...progress, userId, updatedAt: new Date().toISOString() }));
        });
        if (isWriteConfirmed(result)) return result;

        this.setLocalItem(`${PROGRESS_COLLECTION}_${userId}`, progress);
        return this.asLocalDraft(result, 'Tu avance se guardó sólo en este navegador. No se verá reflejado en otro dispositivo.');
    }

    async getProgress(userId: string): Promise<UserProgress | null> {
        try {
            const progressRef = doc(requireDb(db), `users/${userId}/${PROGRESS_COLLECTION}`, 'main');
            const snapshot = await getDoc(progressRef);
            const firestoreProgress = snapshot.exists() ? (snapshot.data() as UserProgress) : null;

            const localProgress = this.getLocalItem<UserProgress>(`${PROGRESS_COLLECTION}_${userId}`);

            if (!firestoreProgress) return localProgress;
            if (!localProgress) return firestoreProgress;

            // Merge logic: if both exist, we could compare updatedAt, but for simplicity we return firestore if it exists
            // However, if firestore is empty due to rules, localProgress is returned
            return firestoreProgress;
        } catch (error) {
            console.warn("TrainingService: Error getting progress, falling back to local storage", error);
            return this.getLocalItem<UserProgress>(`${PROGRESS_COLLECTION}_${userId}`);
        }
    }

    // --- Context ---

    async saveContext(userId: string, context: StudentContext): Promise<TrainingWriteResult> {
        const result = await executeRemoteWrite<void>({ operationName: 'saveContext', userId }, async () => {
            const contextRef = doc(requireDb(db), `users/${userId}/${CONTEXT_COLLECTION}`, 'main');
            await setDoc(contextRef, sanitizeForFirestore({ ...context, userId, updatedAt: new Date().toISOString() }));
        });
        if (isWriteConfirmed(result)) return result;

        this.setLocalItem(`${CONTEXT_COLLECTION}_${userId}`, context);
        return this.asLocalDraft(result, 'Tu perfil de aprendizaje se guardó sólo en este navegador.');
    }

    async getContext(userId: string): Promise<StudentContext | null> {
        try {
            const contextRef = doc(requireDb(db), `users/${userId}/${CONTEXT_COLLECTION}`, 'main');
            const snapshot = await getDoc(contextRef);
            const firestoreContext = snapshot.exists() ? (snapshot.data() as StudentContext) : null;

            const localContext = this.getLocalItem<StudentContext>(`${CONTEXT_COLLECTION}_${userId}`);

            if (!firestoreContext) return localContext;
            return firestoreContext;
        } catch (error) {
            console.warn("TrainingService: Error getting context, falling back to local storage", error);
            return this.getLocalItem<StudentContext>(`${CONTEXT_COLLECTION}_${userId}`);
        }
    }
}

export const trainingService = new TrainingService();
