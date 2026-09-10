import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/authz';
import { useLMS } from '../hooks/useLMS';
import { Course, Lesson } from '../types/lms';
import { LMSDashboard } from './LMS/LMSDashboard';
import { LMSCatalog } from './LMS/LMSCatalog';
import { LMSAILab } from './LMS/LMSAILab';
import { LMSConsulting } from './LMS/LMSConsulting';
import { LMSSmartNotes } from './LMS/LMSSmartNotes';
import { CourseView } from './LMS/CourseView';
import { LessonModal } from './LMS/LessonModal';
import { StudentContextModal } from './LMS/StudentContextModal';
import { LMSDiagnostic } from './LMS/LMSDiagnostic';
import { LMSAnalytics } from './LMS/LMSAnalytics';
import { GraduationCap, BookOpenIcon, SparklesIcon, LightbulbIcon, BrainCircuitIcon, ArrowLeftIcon, UserCogIcon, TargetIcon, BarChart2Icon, CloudOff } from 'lucide-react';

type ViewState = 'dashboard' | 'catalog' | 'ai-lab' | 'consulting' | 'smart-notes' | 'diagnostic' | 'analytics';

export const TrainingCenterPage: React.FC = () => {
    const { profile } = useAuth();
    const lms = useLMS();
    const navigate = useNavigate();
    // `reviewer` reads the analytics too, which the old role list could not
    // express: it enumerated who, and the question is what.
    const canSeeAnalytics = can(profile, 'training:analytics');
    /**
     * Editing the shared curriculum is `training:author`; editing a course you
     * generated for yourself is just managing your own record. Conflating the
     * two either lets a student rewrite the catalogue or takes away the course
     * they just asked the AI Lab to build.
     */
    const canManageCourse = (course: Course) =>
        can(profile, 'training:author') || (!!course.userId && course.userId === profile?.uid);
    
    const [currentView, setCurrentView] = useState<ViewState>('dashboard');
    const [activeCourse, setActiveCourse] = useState<Course | null>(null);
    const [activeLesson, setActiveLesson] = useState<{lesson: Lesson, moduleTitle: string} | null>(null);
    const [showProfile, setShowProfile] = useState(false);

    const handleOpenCourse = (course: Course) => {
        lms.touchCourse(course.id);
        setActiveCourse(course);
    };

    const handleBackToPanel = () => {
        setActiveCourse(null);
    };

    const handleOpenLesson = (lesson: Lesson, moduleTitle: string) => {
        setActiveLesson({ lesson, moduleTitle });
    };

    const handleCloseLesson = () => {
        setActiveLesson(null);
    };

    const navItems = [
        { id: 'dashboard', label: 'Mis Cursos', icon: BookOpenIcon },
        { id: 'catalog', label: 'Catálogo de Rutas', icon: GraduationCap },
        { id: 'diagnostic', label: 'Diagnóstico', icon: TargetIcon },
        { id: 'ai-lab', label: 'Laboratorio IA', icon: SparklesIcon },
        { id: 'consulting', label: 'Consultoría IA', icon: LightbulbIcon },
        { id: 'smart-notes', label: 'Notas Inteligentes', icon: BrainCircuitIcon },
        ...(canSeeAnalytics ? [{ id: 'analytics', label: 'Analítica', icon: BarChart2Icon }] : []),
    ];

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 overflow-hidden">
            {/* Top Navigation Bar */}
            <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-4 md:pl-20 md:pr-6 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center space-x-3">
                    <button 
                        onClick={() => navigate('/')}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-300"
                        title="Volver al Dashboard"
                    >
                        <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                    <div className="p-2 bg-indigo-600 rounded-lg text-white">
                        <GraduationCap className="h-6 w-6" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Arky Academy</h1>
                </div>
                
                <div className="hidden md:flex items-center space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                    {navItems.map(item => {
                        const Icon = item.icon;
                        const isActive = currentView === item.id && !activeCourse;
                        return (
                            <button
                                key={item.id}
                                onClick={() => { setCurrentView(item.id as ViewState); setActiveCourse(null); }}
                                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${isActive ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                            >
                                <Icon className="h-4 w-4 mr-2" />
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={() => setShowProfile(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="Editar mi perfil de aprendizaje"
                >
                    <UserCogIcon className="h-4 w-4" />
                    <span className="hidden lg:inline">Mi Perfil</span>
                </button>
            </div>

            {/*
              * The Training Center's persistence banner.
              *
              * `LMSContext` has exposed `syncError` since it was written and
              * nothing rendered it, which was the second half of the same
              * defect as the service swallowing the failure: even once the
              * write reported honestly, there was nowhere for the report to
              * land. This is the Training Center's counterpart to
              * `PersistenceStatusBanner`, which covers the rest of the app.
              */}
            {lms.syncError && (
                <div
                    className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-100"
                    role="status"
                    aria-live="polite"
                >
                    <div className="flex items-start gap-3">
                        <CloudOff className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
                        <div>
                            <p className="text-sm font-semibold">Pendiente de sincronizar</p>
                            <p className="mt-0.5 text-sm opacity-90">{lms.syncError}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-6 md:p-12">
                {activeCourse ? (
                    <CourseView 
                        course={activeCourse} 
                        progress={lms.progress} 
                        notes={lms.smartNotes}
                        cache={lms.cache}
                        onBack={handleBackToPanel}
                        onOpenLesson={handleOpenLesson}
                        onToggleFavorite={lms.toggleCourseFavorite}
                        onResetProgress={lms.resetCourseProgress}
                        onIssueCertificate={lms.issueCertificate}
                    />
                ) : (
                    <div className="max-w-7xl mx-auto">
                        {currentView === 'dashboard' && <LMSDashboard courses={lms.courses} progress={lms.progress} onOpenCourse={handleOpenCourse} onNavigate={(view) => setCurrentView(view)} onDeleteCourse={lms.deleteCourse} onUpdateCourse={lms.updateCourse} onResetCourseProgress={lms.resetCourseProgress} canManageCourse={canManageCourse} />}
                        {currentView === 'catalog' && <LMSCatalog courses={lms.courses} progress={lms.progress} onOpenCourse={handleOpenCourse} onNavigate={(view) => setCurrentView(view)} onAddCourses={(newCourses) => newCourses.forEach(c => { lms.addCourse(c); lms.toggleCourseInProgress(c.id); })} />}
                        {currentView === 'ai-lab' && <LMSAILab onCourseGenerated={(c) => { lms.addCourse(c); lms.toggleCourseInProgress(c.id); handleOpenCourse(c); }} />}
                        {currentView === 'consulting' && <LMSConsulting />}
                        {currentView === 'diagnostic' && <LMSDiagnostic courses={lms.courses} progress={lms.progress} onSaveDiagnostic={lms.saveDiagnostic} onOpenCourse={handleOpenCourse} onNavigate={(view) => setCurrentView(view)} />}
                        {currentView === 'smart-notes' && <LMSSmartNotes notes={lms.smartNotes} onDelete={lms.deleteSmartNote} />}
                        {currentView === 'analytics' && canSeeAnalytics && <LMSAnalytics courses={lms.courses} />}
                    </div>
                )}
            </div>

            {/* Lesson Modal */}
            {activeLesson && activeCourse && (
                <LessonModal
                    course={activeCourse}
                    lesson={activeLesson.lesson}
                    moduleTitle={activeLesson.moduleTitle}
                    onClose={handleCloseLesson}
                    onToggleRead={lms.toggleLessonRead}
                    onToggleInProgress={lms.toggleLessonInProgress}
                    onToggleFavorite={lms.toggleLessonFavorite}
                    progress={lms.progress}
                    onAddSmartNote={lms.addSmartNote}
                    getCachedContent={lms.getCachedContent}
                    cacheContent={lms.cacheContent}
                    getOriginalContent={lms.getOriginalContent}
                    restoreOriginalContent={lms.restoreOriginalContent}
                    studentContext={lms.studentContext}
                    onRecordQuiz={lms.recordQuizResult}
                />
            )}

            {/* Learning Profile Modal */}
            <StudentContextModal
                isOpen={showProfile}
                context={lms.studentContext}
                onClose={() => setShowProfile(false)}
                onSave={lms.setStudentContext}
            />
        </div>
    );
};
