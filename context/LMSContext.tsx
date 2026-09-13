import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { Course, SmartNote, UserProgress, LessonCache, LessonVersionStore, StudentContext, QuizResult, Certificate, DiagnosticResult } from '../types/lms';
import { useAuth } from './AuthContext';
import { can } from '../lib/authz';
import { pilotLearningService as learning } from '../services/learning';
import { useTrainingSync } from '../hooks/useTrainingSync';
import { XP_REWARDS, updateStreak, generateVerificationCode } from '../lib/lmsProgress';
import { applyVersionWrite, seedVersionsFromCache, versionKey } from '../lib/lmsVersions';
import { newPrefixedId } from '../lib/ids';

const defaultCourses: Course[] = [
  {
    id: 'seed-1',
    title: 'Arquitectura Orientada a Eventos (EDA)',
    description: 'Aprende a diseñar sistemas escalables y desacoplados utilizando eventos, Kafka y patrones asíncronos.',
    icon: 'server',
    category: 'Architecture',
    level: 'Avanzado',
    role: 'Arquitecto de Soluciones',
    isAIGenerated: false,
    modules: [
      {
        id: 'm1',
        title: 'Fundamentos de Eventos',
        level: 'Básico',
        lessons: [
          { id: 'l1', title: '¿Qué es EDA?', description: 'Conceptos básicos de la arquitectura orientada a eventos.' },
          { id: 'l2', title: 'Mensajes vs Eventos', description: 'Diferencias clave y cuándo usar cada uno.' }
        ]
      },
      {
        id: 'm2',
        title: 'Patrones Avanzados',
        level: 'Avanzado',
        lessons: [
          { id: 'l3', title: 'Event Sourcing', description: 'Almacenamiento del estado como una secuencia de eventos.' },
          { id: 'l4', title: 'CQRS', description: 'Separación de responsabilidades de comandos y consultas.' }
        ]
      }
    ]
  },
  {
    id: 'seed-2',
    title: 'FinOps para Arquitectos Cloud',
    description: 'Optimiza los costos de tu infraestructura en la nube sin sacrificar rendimiento ni escalabilidad.',
    icon: 'dollar-sign',
    category: 'Business',
    level: 'Intermedio',
    role: 'Arquitecto Empresarial',
    isAIGenerated: false,
    modules: [
      {
        id: 'm3',
        title: 'Introducción a FinOps',
        level: 'Básico',
        lessons: [
          { id: 'l5', title: 'Cultura FinOps', description: 'Alineando ingeniería, finanzas y negocio.' }
        ]
      }
    ]
  }
];

/** Returns a new progress object with XP added and the daily streak advanced. */
function applyActivity(progress: UserProgress, xpGain: number): UserProgress {
  return {
    ...progress,
    xp: (progress.xp || 0) + xpGain,
    streak: updateStreak(progress.streak),
  };
}

interface LMSContextType {
  syncError: string | null;
  resetCourseProgress: (courseId: string, lessonIds: string[]) => void;
  toggleLessonInProgress: (lessonId: string) => void;
  toggleCourseInProgress: (courseId: string) => void;
  courses: Course[];
  smartNotes: SmartNote[];
  progress: UserProgress;
  cache: LessonCache;
  studentContext: StudentContext;
  setStudentContext: (context: StudentContext) => void;
  addCourse: (course: Course) => void;
  deleteCourse: (courseId: string) => void;
  updateCourse: (courseId: string, updates: Partial<Course>) => void;
  touchCourse: (courseId: string) => void;
  addSmartNote: (note: SmartNote) => void;
  deleteSmartNote: (id: string) => void;
  toggleLessonRead: (lessonId: string) => void;
  toggleLessonFavorite: (lessonId: string) => void;
  toggleCourseFavorite: (courseId: string) => void;
  cacheContent: (lessonId: string, tabId: string, content: string) => void;
  getCachedContent: (lessonId: string, tabId: string) => string | undefined;
  /** Returns the immutable first-generated content for a lesson tab, if any. */
  getOriginalContent: (lessonId: string, tabId: string) => string | undefined;
  /** Restores the original first version as the live content and returns it. */
  restoreOriginalContent: (lessonId: string, tabId: string) => string | undefined;
  recordQuizResult: (result: QuizResult) => void;
  issueCertificate: (course: Course) => Certificate | null;
  saveDiagnostic: (result: DiagnosticResult) => void;
}

const LMSContext = createContext<LMSContextType | undefined>(undefined);
export const LMSProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, profile, isLoading: authLoading } = useAuth();
  const { syncError, trackWrite, reportSyncIssue } = useTrainingSync(user?.email);

  const [courses, setCourses] = useState<Course[]>(defaultCourses);
  const [smartNotes, setSmartNotes] = useState<SmartNote[]>([]);
  const [progress, setProgress] = useState<UserProgress>({
    readLessons: [],
    inProgressLessons: [],
    favoriteLessons: [],
    favoriteCourses: [],
    inProgressCourses: []
  });
  const [cache, setCache] = useState<LessonCache>({});
  // Immutable first-generation store, keyed identically to `cache`.
  const [versions, setVersions] = useState<LessonVersionStore>({});
  const [studentContext, setStudentContext] = useState<StudentContext>({
    industry: 'Tecnología',
    techStack: 'React, Node.js, AWS',
    currentProject: 'Migración a Microservicios'
  });

  // Save to localStorage (cache) for absolute persistence
  useEffect(() => {
    localStorage.setItem('lms_courses_cache', JSON.stringify(courses));
  }, [courses]);

  useEffect(() => {
    localStorage.setItem('lms_notes_cache', JSON.stringify(smartNotes));
  }, [smartNotes]);

  useEffect(() => {
    localStorage.setItem('lms_progress_cache', JSON.stringify(progress));
  }, [progress]);

  useEffect(() => {
    localStorage.setItem('lms_cache_cache', JSON.stringify(cache));
  }, [cache]);

  useEffect(() => {
    localStorage.setItem('lms_versions_cache', JSON.stringify(versions));
  }, [versions]);

  useEffect(() => {
    localStorage.setItem('lms_context_cache', JSON.stringify(studentContext));
  }, [studentContext]);

  // Load from Firestore/LocalStorage
  useEffect(() => {
    if (authLoading) return;

    const loadData = async () => {
      const uid = user?.uid;
      // Reading every course belongs to whoever authors the curriculum, which
      // is what the catalogue-wide query is for — not to administration as such.
      const readsWholeCatalog = can(profile, 'training:author');
      
      try {
        reportSyncIssue(null);
        
        // Load everything in parallel
        const [fetchedCourses, fetchedNotes, fetchedProgress, fetchedContext] = await Promise.all([
          learning.getCourses(uid || 'guest', readsWholeCatalog),
          uid ? learning.getSmartNotes(uid) : Promise.resolve([]),
          uid ? learning.getProgress(uid) : Promise.resolve(null),
          uid ? learning.getContext(uid) : Promise.resolve(null)
        ]);
        
        // Merge fetched courses with default courses and local cache
        const localCoursesCache = JSON.parse(localStorage.getItem('lms_courses_cache') || '[]');
        const mergedCourses = [...defaultCourses];
        
        // Add local cache first
        localCoursesCache.forEach((lc: Course) => {
            if (!mergedCourses.find(c => c.id === lc.id)) {
                mergedCourses.push(lc);
            }
        });

        // Then add/update with fetched courses (Firestore is source of truth)
        if (fetchedCourses && fetchedCourses.length > 0) {
          fetchedCourses.forEach(fc => {
            const index = mergedCourses.findIndex(c => c.id === fc.id);
            if (index === -1) {
              mergedCourses.push(fc);
            } else {
              mergedCourses[index] = fc;
            }
          });
        }
        
        setCourses(mergedCourses);

        // Notes
        const localNotesCache = JSON.parse(localStorage.getItem('lms_notes_cache') || '[]');
        const mergedNotes = [...localNotesCache];
        if (fetchedNotes && fetchedNotes.length > 0) {
            fetchedNotes.forEach(fn => {
                if (!mergedNotes.find(n => n.id === fn.id)) {
                    mergedNotes.push(fn);
                }
            });
        }
        setSmartNotes(mergedNotes);

        // Progress
        const localProgressCache = JSON.parse(localStorage.getItem('lms_progress_cache') || 'null');
        if (fetchedProgress) {
          setProgress(fetchedProgress);
        } else if (localProgressCache) {
          setProgress(localProgressCache);
        }

        // Context
        const localContextCache = JSON.parse(localStorage.getItem('lms_context_cache') || 'null');
        if (fetchedContext) {
          setStudentContext(fetchedContext);
        } else if (localContextCache) {
          setStudentContext(localContextCache);
        }

        // Cache
        const localCacheCache: LessonCache = JSON.parse(localStorage.getItem('lms_cache_cache') || '{}');
        if (Object.keys(localCacheCache).length > 0) {
            setCache(localCacheCache);
        }

        // Version store (first-generation snapshots). Backfill any cached entry
        // that predates versioning so its current text becomes its original.
        const localVersions: LessonVersionStore = JSON.parse(localStorage.getItem('lms_versions_cache') || '{}');
        const seededVersions = seedVersionsFromCache(localVersions, localCacheCache);
        if (Object.keys(seededVersions).length > 0) {
            setVersions(seededVersions);
        }

      } catch (error) {
        console.error("LMSProvider: Error loading data", error);
        reportSyncIssue("Modo Offline: Algunos datos podrían no estar sincronizados.");
        
        // Fallback to cache entirely
        const localCoursesCache = JSON.parse(localStorage.getItem('lms_courses_cache') || '[]');
        if (localCoursesCache.length > 0) setCourses(localCoursesCache);
        
        const localNotesCache = JSON.parse(localStorage.getItem('lms_notes_cache') || '[]');
        if (localNotesCache.length > 0) setSmartNotes(localNotesCache);
        
        const localProgressCache = JSON.parse(localStorage.getItem('lms_progress_cache') || 'null');
        if (localProgressCache) setProgress(localProgressCache);
        
        const localContextCache = JSON.parse(localStorage.getItem('lms_context_cache') || 'null');
        if (localContextCache) setStudentContext(localContextCache);
        
      }
    };

    loadData();
  }, [authLoading, user, profile, reportSyncIssue]);

  // Actions
  const addCourse = useCallback((course: Course) => {
    setCourses(prev => [...prev, course]);
    trackWrite(learning.saveCourse(user?.uid || 'guest', course));
  }, [user, trackWrite]);

  const deleteCourse = useCallback((courseId: string) => {
    setCourses(prev => prev.filter(c => c.id !== courseId));
    trackWrite(learning.deleteCourse(user?.uid || 'guest', courseId));
  }, [user, trackWrite]);

  const updateCourse = useCallback((courseId: string, updates: Partial<Course>) => {
    setCourses(prev => prev.map(c => c.id === courseId ? { ...c, ...updates } : c));
    trackWrite(learning.updateCourse(user?.uid || 'guest', courseId, updates));
  }, [user, trackWrite]);

  const touchCourse = useCallback((courseId: string) => {
    setProgress(prev => {
      const newProgress = {
        ...prev,
        courseLastAccessed: { ...(prev.courseLastAccessed || {}), [courseId]: Date.now() }
      };
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const addSmartNote = useCallback((note: SmartNote) => {
    setSmartNotes(prev => [...prev, note]);
    trackWrite(learning.saveSmartNote(user?.uid || 'guest', note));
  }, [user, trackWrite]);

  const deleteSmartNote = useCallback((id: string) => {
    setSmartNotes(prev => prev.filter(n => n.id !== id));
    trackWrite(learning.deleteSmartNote(user?.uid || 'guest', id));
  }, [user, trackWrite]);

  const toggleLessonRead = useCallback((lessonId: string) => {
    setProgress(prev => {
      const isRead = prev.readLessons.includes(lessonId);
      let newProgress: UserProgress = {
        ...prev,
        readLessons: isRead ? prev.readLessons.filter(id => id !== lessonId) : [...prev.readLessons, lessonId]
      };
      // Award XP + advance the streak only when newly completing a lesson.
      if (!isRead) newProgress = applyActivity(newProgress, XP_REWARDS.lessonRead);
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const recordQuizResult = useCallback((result: QuizResult) => {
    setProgress(prev => {
      const previous = prev.quizResults?.[result.lessonId];
      // Keep the best attempt by percentage.
      const keep = !previous || result.percent >= previous.percent ? result : previous;
      // Award quiz XP the first time the learner passes this quiz.
      const firstPass = result.passed && !(previous?.passed);
      let newProgress: UserProgress = {
        ...prev,
        quizResults: { ...(prev.quizResults || {}), [result.lessonId]: keep },
      };
      if (firstPass) newProgress = applyActivity(newProgress, XP_REWARDS.quizPassed);
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const issueCertificate = useCallback((course: Course): Certificate | null => {
    const allLessonIds = course.modules.flatMap(m => m.lessons.map(l => l.id));
    if (allLessonIds.length === 0) return null;
    // Require every lesson completed before issuing.
    const allRead = allLessonIds.every(id => progress.readLessons.includes(id));
    if (!allRead) return null;
    // Idempotent: return the existing certificate if already issued.
    const existing = progress.certificates?.find(c => c.courseId === course.id);
    if (existing) return existing;

    // Overall score from any quiz results captured for this course's lessons.
    const lessonQuiz = allLessonIds
      .map(id => progress.quizResults?.[id])
      .filter((q): q is QuizResult => !!q);
    const scorePercent = lessonQuiz.length > 0
      ? Math.round(lessonQuiz.reduce((acc, q) => acc + q.percent, 0) / lessonQuiz.length)
      : undefined;

    const certificate: Certificate = {
      id: newPrefixedId('cert'),
      courseId: course.id,
      courseTitle: course.title,
      userName: profile?.displayName || user?.email || 'Arquitecto Arky',
      issuedAt: Date.now(),
      verificationCode: generateVerificationCode(),
      scorePercent,
    };

    setProgress(prev => {
      if (prev.certificates?.some(c => c.courseId === course.id)) return prev;
      let newProgress: UserProgress = {
        ...prev,
        certificates: [...(prev.certificates || []), certificate],
        badges: Array.from(new Set([...(prev.badges || []), `course:${course.id}`])),
      };
      newProgress = applyActivity(newProgress, XP_REWARDS.courseCompleted);
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
    return certificate;
  }, [progress, profile, user, trackWrite]);

  const saveDiagnostic = useCallback((result: DiagnosticResult) => {
    setProgress(prev => {
      const previous = prev.diagnostics?.[result.role];
      let newProgress: UserProgress = {
        ...prev,
        diagnostics: { ...(prev.diagnostics || {}), [result.role]: result },
      };
      // Award diagnostic XP once per role.
      if (!previous) newProgress = applyActivity(newProgress, XP_REWARDS.diagnosticCompleted);
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const toggleLessonFavorite = useCallback((lessonId: string) => {
    setProgress(prev => {
      const isFav = prev.favoriteLessons.includes(lessonId);
      const newProgress = {
        ...prev,
        favoriteLessons: isFav ? prev.favoriteLessons.filter(id => id !== lessonId) : [...prev.favoriteLessons, lessonId]
      };
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const toggleCourseFavorite = useCallback((courseId: string) => {
    setProgress(prev => {
      const isFav = prev.favoriteCourses.includes(courseId);
      const newProgress = {
        ...prev,
        favoriteCourses: isFav ? prev.favoriteCourses.filter(id => id !== courseId) : [...prev.favoriteCourses, courseId]
      };
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const toggleCourseInProgress = useCallback((courseId: string) => {
    setProgress(prev => {
      const isProg = prev.inProgressCourses.includes(courseId);
      const newProgress = {
        ...prev,
        inProgressCourses: isProg ? prev.inProgressCourses.filter(id => id !== courseId) : [...prev.inProgressCourses, courseId]
      };
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const cacheContent = useCallback((lessonId: string, tabId: string, content: string) => {
    const key = versionKey(lessonId, tabId);
    setCache(prev => ({ ...prev, [key]: content }));
    // Preserve the very first version forever: the first write records the
    // original, later writes keep it intact and only bump revision metadata.
    setVersions(prev => applyVersionWrite(prev, key, content));
  }, []);

  const getCachedContent = useCallback((lessonId: string, tabId: string) => {
    return cache[versionKey(lessonId, tabId)];
  }, [cache]);

  const getOriginalContent = useCallback((lessonId: string, tabId: string) => {
    return versions[versionKey(lessonId, tabId)]?.original;
  }, [versions]);

  const restoreOriginalContent = useCallback((lessonId: string, tabId: string) => {
    const key = versionKey(lessonId, tabId);
    const original = versions[key]?.original;
    if (original === undefined) return undefined;
    setCache(prev => ({ ...prev, [key]: original }));
    return original;
  }, [versions]);

  const resetCourseProgress = useCallback((courseId: string, lessonIds: string[]) => {
    setProgress(prev => {
      const newProgress = {
        ...prev,
        readLessons: prev.readLessons.filter(id => !lessonIds.includes(id)),
        inProgressLessons: prev.inProgressLessons.filter(id => !lessonIds.includes(id)),
        favoriteLessons: prev.favoriteLessons.filter(id => !lessonIds.includes(id)),
      };
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const toggleLessonInProgress = useCallback((lessonId: string) => {
    setProgress(prev => {
      const isProg = prev.inProgressLessons.includes(lessonId);
      const newProgress = {
        ...prev,
        inProgressLessons: isProg ? prev.inProgressLessons.filter(id => id !== lessonId) : [...prev.inProgressLessons, lessonId]
      };
      trackWrite(learning.saveProgress(user?.uid || 'guest', newProgress));
      return newProgress;
    });
  }, [user, trackWrite]);

  const updateStudentContext = useCallback((context: StudentContext) => {
    setStudentContext(context);
    trackWrite(learning.saveContext(user?.uid || 'guest', context));
  }, [user, trackWrite]);

  // Memoised for the same reason as the other providers: every member is
  // already stable (state, or a `useCallback` with its own dependencies), so
  // the identity now changes only when the learning data does.
  const value = useMemo<LMSContextType>(() => ({
      syncError,
      resetCourseProgress,
      toggleLessonInProgress,
      toggleCourseInProgress,
      courses,
      smartNotes,
      progress,
      cache,
      studentContext,
      setStudentContext: updateStudentContext,
      addCourse,
      deleteCourse,
      updateCourse,
      touchCourse,
      addSmartNote,
      deleteSmartNote,
      toggleLessonRead,
      toggleLessonFavorite,
      toggleCourseFavorite,
      cacheContent,
      getCachedContent,
      getOriginalContent,
      restoreOriginalContent,
      recordQuizResult,
      issueCertificate,
      saveDiagnostic
  }), [syncError, resetCourseProgress, toggleLessonInProgress, toggleCourseInProgress, courses, smartNotes, progress, cache, studentContext, updateStudentContext, addCourse, deleteCourse, updateCourse, touchCourse, addSmartNote, deleteSmartNote, toggleLessonRead, toggleLessonFavorite, toggleCourseFavorite, cacheContent, getCachedContent, getOriginalContent, restoreOriginalContent, recordQuizResult, issueCertificate, saveDiagnostic]);

  return (
    <LMSContext.Provider value={value}>
      {children}
    </LMSContext.Provider>
  );
};

export const useLMS = () => {
  const context = useContext(LMSContext);
  if (context === undefined) {
    throw new Error('useLMS must be used within an LMSProvider');
  }
  return context;
};
