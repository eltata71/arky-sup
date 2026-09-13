import type { Course, SmartNote, StudentContext, UserProgress } from '../../types/lms';
import { loadSupabaseDataClient, resolveBackend } from '../adapters';
import { isSupabasePilotEmail, parseSupabasePilotEmails } from '../identity';
import { createSupabaseLearningRepository, type SupabaseLearningRepository } from './SupabaseLearningRepository';
import { trainingService, type TrainingWriteResult } from './trainingService';

const env = (): Record<string, string | undefined> => import.meta.env as Record<string, string | undefined>;
let useSupabase = false;
let repository: Promise<SupabaseLearningRepository> | null = null;

export const shouldUseSupabaseLearningBackend = (
  email: string | null | undefined,
  backendEnv: Record<string, string | undefined>,
): boolean => resolveBackend(backendEnv, 'learning').backend === 'supabase'
  && isSupabasePilotEmail(email, parseSupabasePilotEmails(backendEnv.VITE_SUPABASE_PILOT_EMAILS));

export const configurePilotLearningBackend = (email: string | null | undefined): void => {
  useSupabase = shouldUseSupabaseLearningBackend(email, env());
  if (!useSupabase) repository = null;
};

const supabase = async (): Promise<SupabaseLearningRepository | null> => {
  if (!useSupabase) return null;
  repository ??= loadSupabaseDataClient(env()).then(client =>
    createSupabaseLearningRepository(client as unknown as Parameters<typeof createSupabaseLearningRepository>[0]),
  );
  return repository;
};

const write = async <T>(operation: (client: SupabaseLearningRepository) => Promise<T>): Promise<TrainingWriteResult | null> => {
  const client = await supabase();
  if (!client) return null;
  return operation(client) as unknown as TrainingWriteResult;
};

/** Routes the LMS only for the allowlisted Supabase pilot; Firebase remains the default. */
export const pilotLearningService = {
  async saveCourse(userId: string, course: Course): Promise<TrainingWriteResult> {
    return (await write(client => client.saveCourse(course, userId))) ?? trainingService.saveCourse(userId, course);
  },
  async getCourses(userId: string, isAdmin?: boolean): Promise<Course[]> {
    return (await supabase())?.listCourses(userId, isAdmin ?? false) ?? trainingService.getCourses(userId, isAdmin);
  },
  async updateCourse(userId: string, courseId: string, updates: Partial<Course>): Promise<TrainingWriteResult> {
    return (await write(client => client.updateCourse(courseId, updates, userId))) ?? trainingService.updateCourse(userId, courseId, updates);
  },
  async deleteCourse(userId: string, courseId: string): Promise<TrainingWriteResult> {
    return (await write(client => client.deleteCourse(courseId, userId))) ?? trainingService.deleteCourse(userId, courseId);
  },
  async saveSmartNote(userId: string, note: SmartNote): Promise<TrainingWriteResult> {
    return (await write(client => client.saveNote(note, userId))) ?? trainingService.saveSmartNote(userId, note);
  },
  async getSmartNotes(userId: string): Promise<SmartNote[]> {
    return (await supabase())?.listNotes(userId) ?? trainingService.getSmartNotes(userId);
  },
  async deleteSmartNote(userId: string, noteId: string): Promise<TrainingWriteResult> {
    return (await write(client => client.deleteNote(noteId, userId))) ?? trainingService.deleteSmartNote(userId, noteId);
  },
  async saveProgress(userId: string, progress: UserProgress): Promise<TrainingWriteResult> {
    return (await write(client => client.saveProgress(progress, userId))) ?? trainingService.saveProgress(userId, progress);
  },
  async getProgress(userId: string): Promise<UserProgress | null> {
    return (await supabase())?.loadProgress() ?? trainingService.getProgress(userId);
  },
  async saveContext(userId: string, context: StudentContext): Promise<TrainingWriteResult> {
    return (await write(client => client.saveContext(context, userId))) ?? trainingService.saveContext(userId, context);
  },
  async getContext(userId: string): Promise<StudentContext | null> {
    return (await supabase())?.loadContext() ?? trainingService.getContext(userId);
  },
};
