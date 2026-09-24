export type CourseCategory = 'Tooling' | 'Architecture' | 'Business';
export type CourseLevel = 'Básico' | 'Intermedio' | 'Avanzado';
export type ArchitectRole = 'Arquitecto Empresarial' | 'Arquitecto de Soluciones' | 'Arquitecto de Software' | 'Arquitecto de Datos' | 'Arquitecto de Infraestructura' | 'Arquitecto de Seguridad';

export interface Lesson {
  id: string;
  title: string;
  description: string;
}

export interface CourseModule {
  id: string;
  title: string;
  level: CourseLevel;
  lessons: Lesson[];
}

export interface Course {
  id: string;
  /** Stored row revision (F6-03): travels with the course, never in a map nor in the document. */
  revision?: number;
  title: string;
  description: string;
  icon: string;
  category: CourseCategory;
  level: CourseLevel;
  role: ArchitectRole;
  modules: CourseModule[];
  courseContext?: string;
  isAIGenerated?: boolean;
  userId?: string;
  updatedAt?: string;
}

export interface SmartNote {
  id: string;
  courseId: string;
  lessonId: string;
  tabId: string;
  content: string;
  createdAt: number;
  userId?: string;
}

export interface UserProgress {
  readLessons: string[];
  inProgressLessons: string[];
  favoriteLessons: string[];
  favoriteCourses: string[];
  inProgressCourses: string[];
  courseLastAccessed?: Record<string, number>; // courseId → Unix ms timestamp of last access

  // --- Assessment & certification (#1) ---
  /** Best quiz result per lesson, keyed by lessonId. */
  quizResults?: Record<string, QuizResult>;
  /** Earned course certificates. */
  certificates?: Certificate[];

  // --- Gamification (#5) ---
  /** Accumulated experience points. */
  xp?: number;
  /** Daily activity streak. */
  streak?: StreakState;
  /** Earned badge ids. */
  badges?: string[];

  // --- Adaptive learning (#2) ---
  /** Latest diagnostic result per architect role. */
  diagnostics?: Record<string, DiagnosticResult>;
}

/** Result of an interactive lesson quiz. */
export interface QuizResult {
  lessonId: string;
  courseId: string;
  score: number;   // correct answers
  total: number;   // total questions
  percent: number; // 0-100
  passed: boolean; // percent >= QUIZ_PASS_PERCENT
  at: number;      // Unix ms timestamp
}

/** A verifiable course completion certificate. */
export interface Certificate {
  id: string;
  courseId: string;
  courseTitle: string;
  userName: string;
  issuedAt: number;           // Unix ms timestamp
  verificationCode: string;   // short human-readable verification code
  scorePercent?: number;      // overall course score when available
}

/** Daily streak bookkeeping. */
export interface StreakState {
  count: number;
  /** Last active calendar day in YYYY-MM-DD (local). */
  lastActiveDate: string;
}

export type CompetencyLevel = 'Novato' | 'Competente' | 'Avanzado' | 'Experto';

/** A single competency area score within a diagnostic. */
export interface CompetencyScore {
  area: string;
  score: number; // 0-100
  level: CompetencyLevel;
}

/** Result of a role-based skill diagnostic that drives adaptive paths. */
export interface DiagnosticResult {
  role: ArchitectRole;
  at: number; // Unix ms timestamp
  overall: number; // 0-100
  competencies: CompetencyScore[];
  /** Ordered course titles recommended to close the detected gaps. */
  recommendedCourseTitles: string[];
}

/** A single diagnostic question (multiple choice). */
export interface DiagnosticQuestion {
  area: string;
  question: string;
  options: string[];
  correctIndex: number;
}

/** Per-dimension score within a practical diagram evaluation (#3). */
export interface DiagramDimensionScore {
  name: string;
  score: number; // 0-100
  feedback: string;
}

/** AI evaluation of a student's diagram submitted in the practical lab. */
export interface DiagramChallengeEvaluation {
  grade: number; // 0-100 overall
  summary: string;
  dimensions: DiagramDimensionScore[];
  improvements: string[];
}

export interface LessonCache {
  [lessonId_tabId: string]: string;
}

/**
 * Immutable record of the *first* generated version of a lesson tab. When a
 * student regenerates a section the live `LessonCache` entry is replaced, but
 * this preserves the original text so it can always be restored. Keyed the same
 * way as `LessonCache` (`lessonId_tabId`).
 */
export interface LessonContentVersion {
  /** The very first generated content for this lesson tab. Never overwritten. */
  original: string;
  /** Unix ms timestamp when the original was first generated. */
  originalAt: number;
  /** Unix ms timestamp of the latest regeneration (only set after a regen). */
  updatedAt?: number;
  /** How many times the section has been regenerated after the original. */
  revisions?: number;
}

export interface LessonVersionStore {
  [lessonId_tabId: string]: LessonContentVersion;
}

export interface StudentContext {
  industry: string;
  techStack: string;
  currentProject: string;
}
