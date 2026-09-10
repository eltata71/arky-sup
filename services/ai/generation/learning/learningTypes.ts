/**
 * What the LMS generators actually return.
 *
 * These three functions were typed `Promise<any>` when they were lifted out of
 * the monolith, and the shapes were not unknown: each prompt in
 * `courseAuthoring.ts` prints the exact JSON it asks for. `any` meant the
 * screens re-declared those shapes inline — `(c: any) => ({ title: c.title })`
 * — so a change to a prompt broke a `.map` in a page with nothing to catch it.
 *
 * They are deliberately *not* the LMS domain types from `types/lms.ts`. A
 * model's answer is raw material: it carries no ids, its `level` is whatever
 * string came back, and the caller is what turns it into a `Course`. Naming
 * that difference is the point — a `GeneratedCourse` is a proposal, a `Course`
 * is a record.
 */

import type { CourseCategory, CourseLevel } from '../../../../types/lms';

/** A course as the model proposes it, before the caller assigns ids. */
export interface GeneratedCourse {
  readonly title?: string;
  readonly description?: string;
  readonly category?: string;
  readonly level?: string;
  readonly modules?: readonly GeneratedModule[];
}

export interface GeneratedModule {
  readonly id?: string;
  readonly title?: string;
  readonly level?: string;
  readonly lessons?: readonly GeneratedLesson[];
}

export interface GeneratedLesson {
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
}

/** The filter set the catalog screen narrows knowledge cards with. */
export interface TopicFilters {
  readonly course?: string;
  readonly role?: string;
  readonly level?: string;
  readonly studyPlan?: string;
  readonly category?: string;
  readonly searchTerm?: string;
}

/** One "knowledge card" the model proposes for the catalog. */
export interface GeneratedTopic {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly summary: string;
  readonly course: string;
  readonly roles: readonly string[];
  readonly level: string;
  readonly studyPlans: readonly string[];
}

/**
 * Narrow a model's free-text `category`/`level` to the domain's union.
 *
 * The screens used to write `category: c.category || 'Architecture'` straight
 * into a `Course`, which typechecked only because the generator returned
 * `any`. It is not a formality: the prompt lists the allowed values, the model
 * mostly honours them, and "mostly" is how a course ends up with a level no
 * filter matches and disappears from the catalog. Falling back to the default
 * is the same behaviour those screens intended — now it actually happens.
 */
const COURSE_CATEGORIES: readonly CourseCategory[] = ['Tooling', 'Architecture', 'Business'];
const COURSE_LEVELS: readonly CourseLevel[] = ['Básico', 'Intermedio', 'Avanzado'];

export const asCourseCategory = (
  value: string | undefined,
  fallback: CourseCategory = 'Architecture',
): CourseCategory =>
  COURSE_CATEGORIES.includes(value as CourseCategory) ? (value as CourseCategory) : fallback;

export const asCourseLevel = (
  value: string | undefined,
  fallback: CourseLevel = 'Intermedio',
): CourseLevel =>
  COURSE_LEVELS.includes(value as CourseLevel) ? (value as CourseLevel) : fallback;

/**
 * The verdict on a submitted challenge.
 *
 * `evaluateChallenge` is one of the two LMS methods still inside the legacy
 * engine, and it returns `Promise<any>` there. The shape is not a mystery —
 * the prompt asks for exactly these three fields — so the façade narrows it at
 * the boundary. That is the whole job of a façade: the monolith's looseness
 * stops here rather than reaching the screen that renders a grade.
 */
export interface ChallengeEvaluation {
  readonly grade?: number;
  readonly feedback?: string;
  readonly improvements?: readonly string[];
}

/** One related concept the lesson offers to drill into. */
export interface RelatedConcept {
  readonly title: string;
  readonly description: string;
}

/** One multiple-choice question of a lesson quiz. */
export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

/**
 * A quiz and a concept list both arrive as parsed JSON from the model, so they
 * are `unknown` until checked. These guards are what let the screens fall back
 * honestly — anything that is not a quiz renders as Markdown instead of
 * throwing halfway through a `map` — and they live here rather than in the
 * modal because the shape belongs to the generator, not to the screen.
 */
export const isQuizQuestion = (value: unknown): value is QuizQuestion => {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  return typeof q.question === 'string' && Array.isArray(q.options) && typeof q.correctIndex === 'number';
};

export const isRelatedConcept = (value: unknown): value is RelatedConcept => {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.title === 'string' && typeof c.description === 'string';
};
