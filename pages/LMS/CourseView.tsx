
import React, { useState } from 'react';

import { Course, Lesson, UserProgress, SmartNote, LessonCache, Certificate } from '../../types/lms';
import { ArrowLeftIcon, CheckCircleIcon, PlayCircleIcon, StarIcon, DownloadIcon, RefreshCwIcon, ClockIcon, BrainCircuitIcon, AwardIcon } from 'lucide-react';
import { CertificateCard } from './CertificateView';
import { SafeRichText } from '../../components/ui/SafeRichText';

interface Props {
    course: Course;
    progress: UserProgress;
    notes: SmartNote[];
    cache: LessonCache;
    onBack: () => void;
    onOpenLesson: (lesson: Lesson, moduleTitle: string) => void;
    onToggleFavorite: (id: string) => void;
    onResetProgress: (courseId: string, lessonIds: string[]) => void;
    onIssueCertificate: (course: Course) => Certificate | null;
}

export const CourseView: React.FC<Props> = ({ course, progress, notes, cache, onBack, onOpenLesson, onToggleFavorite, onResetProgress, onIssueCertificate }) => {
    const [activeTab, setActiveTab] = useState<'syllabus' | 'notes'>('syllabus');
    const [filter, setFilter] = useState<'all' | 'read' | 'unread' | 'in-progress' | 'favorite'>('all');

    const isFav = progress.favoriteCourses.includes(course.id);
    const allLessonIds = course.modules.flatMap(m => m.lessons.map(l => l.id));
    const totalLessons = allLessonIds.length;
    const readLessons = allLessonIds.filter(id => progress.readLessons.includes(id)).length;
    const percent = totalLessons === 0 ? 0 : Math.round((readLessons / totalLessons) * 100);
    const courseNotes = notes.filter(n => n.courseId === course.id);
    const certificate = progress.certificates?.find(c => c.courseId === course.id);
    const isComplete = totalLessons > 0 && percent === 100;

    const handleOfflineDownload = () => {
        let exportData = `# ${course.title}\n\n${course.description}\n\n`;
        
        course.modules.forEach(mod => {
            exportData += `## ${mod.title}\n\n`;
            mod.lessons.forEach(lesson => {
                exportData += `### ${lesson.title}\n\n`;
                // Find all cached tabs for this lesson
                Object.keys(cache).forEach(key => {
                    if (key.startsWith(lesson.id + '_')) {
                        const tabName = key.split('_')[1];
                        exportData += `#### ${tabName}\n\n${cache[key]}\n\n`;
                    }
                });
            });
        });

        const blob = new Blob([exportData], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${course.title.replace(/\s+/g, '_')}_Offline.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="animate-fade-in max-w-7xl mx-auto">
            <button onClick={onBack} className="flex items-center text-sm font-medium text-gray-500 hover:text-indigo-600 transition-colors mb-6">
                <ArrowLeftIcon className="h-4 w-4 mr-2" /> Volver al panel
            </button>

            {/* Certificate banner — shown once the course is fully completed */}
            {certificate ? (
                <div className="mb-8">
                    <CertificateCard certificate={certificate} />
                </div>
            ) : isComplete ? (
                <div className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 p-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm">
                            <AwardIcon className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">¡Curso completado!</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Has terminado todas las lecciones. Reclama tu certificado.</p>
                        </div>
                    </div>
                    <button
                        onClick={() => onIssueCertificate(course)}
                        className="bg-indigo-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-md whitespace-nowrap"
                    >
                        Obtener Certificado
                    </button>
                </div>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Panel: Course Info */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden sticky top-6">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
                        
                        <div className="relative z-10">
                            <div className="flex items-center space-x-2 mb-4">
                                <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                    {course.category}
                                </span>
                                <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                    {course.level}
                                </span>
                            </div>
                            
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3 leading-tight">{course.title}</h1>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{course.description}</p>
                            
                            <div className="space-y-4 pt-6 border-t border-gray-100 dark:border-gray-800">
                                <div>
                                    <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                                        <span>Progreso del curso</span>
                                        <span className="text-indigo-600 dark:text-indigo-400 font-bold">{percent}%</span>
                                    </div>
                                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                        <div className="bg-indigo-600 h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${percent}%` }}></div>
                                    </div>
                                </div>

                                <div className="pt-4 pb-2">
                                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Filtros de Lecciones</div>
                                    <div className="flex flex-col gap-2">
                                        <button onClick={() => setFilter('all')} className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'all' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}`}>Todas las lecciones</button>
                                        <button onClick={() => setFilter('read')} className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'read' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}`}>Completadas</button>
                                        <button onClick={() => setFilter('in-progress')} className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'in-progress' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}`}>En Progreso</button>
                                        <button onClick={() => setFilter('unread')} className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'unread' ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}`}>No Iniciadas</button>
                                        <button onClick={() => setFilter('favorite')} className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'favorite' ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50'}`}>Favoritas</button>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
                                    <button 
                                        onClick={() => onToggleFavorite(course.id)}
                                        className={`w-full flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${isFav ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                                    >
                                        <StarIcon className={`h-4 w-4 mr-2 ${isFav ? 'fill-current' : ''}`} />
                                        {isFav ? 'En Favoritos' : 'Marcar como Favorito'}
                                    </button>
                                    
                                    <button onClick={handleOfflineDownload} className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors">
                                        <DownloadIcon className="h-4 w-4 mr-2" /> Descargar para Offline
                                    </button>
                                    
                                    <button onClick={() => onResetProgress(course.id, allLessonIds)} className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                                        <RefreshCwIcon className="h-4 w-4 mr-2" /> Reiniciar Progreso
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Panel: Content */}
                <div className="lg:col-span-9">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden min-h-[600px]">
                        {/* Tabs */}
                        <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 px-4 pt-4">
                            <button 
                                onClick={() => setActiveTab('syllabus')}
                                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'syllabus' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}
                            >
                                Plan de Estudio
                            </button>
                            <button 
                                onClick={() => setActiveTab('notes')}
                                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors flex items-center ${activeTab === 'notes' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}
                            >
                                Notas del Curso <span className="ml-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded-full text-xs">{courseNotes.length}</span>
                            </button>
                        </div>

                        <div className="p-6">
                            {activeTab === 'syllabus' ? (
                                <div className="space-y-8">
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Plan de Estudio</h2>
                                    </div>
                                    
                                    <div className="space-y-8">
                                        {course.modules.map((mod, idx) => {
                                            const filteredLessons = mod.lessons.filter(lesson => {
                                                if (filter === 'all') return true;
                                                if (filter === 'read') return progress.readLessons.includes(lesson.id);
                                                if (filter === 'unread') return !progress.readLessons.includes(lesson.id) && !progress.inProgressLessons.includes(lesson.id);
                                                if (filter === 'in-progress') return progress.inProgressLessons.includes(lesson.id);
                                                if (filter === 'favorite') return progress.favoriteLessons.includes(lesson.id);
                                                return true;
                                            });

                                            if (filteredLessons.length === 0) return null;

                                            const modLessonIds = mod.lessons.map(l => l.id);
                                            const modRead = modLessonIds.filter(id => progress.readLessons.includes(id)).length;
                                            const modPct = modLessonIds.length === 0 ? 0 : Math.round((modRead / modLessonIds.length) * 100);
                                            const modDone = modLessonIds.length > 0 && modRead === modLessonIds.length;

                                            return (
                                                <div key={mod.id || `mod-${idx}`} className="relative">
                                                    <div className="flex items-center mb-4">
                                                        <div className={`font-bold w-8 h-8 rounded-lg flex items-center justify-center mr-3 shadow-sm transition-colors ${modDone ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'}`}>
                                                            {modDone ? <CheckCircleIcon className="h-5 w-5" /> : idx + 1}
                                                        </div>
                                                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">{mod.title}</h3>
                                                        <span className="ml-auto text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">{mod.level}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 mb-4 pl-11">
                                                        <div className="flex-1 max-w-xs bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-500 ease-out ${modDone ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${modPct}%` }} />
                                                        </div>
                                                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{modRead}/{modLessonIds.length} lecciones</span>
                                                    </div>
                                                    
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-11">
                                                        {filteredLessons.map((lesson, lIdx) => {
                                                            const isRead = progress.readLessons.includes(lesson.id);
                                                            const isProg = progress.inProgressLessons.includes(lesson.id);
                                                            const isFav = progress.favoriteLessons.includes(lesson.id);
                                                            const hasContent = Object.keys(cache).some(k => k.startsWith(lesson.id + '_'));

                                                            return (
                                                                <div
                                                                    key={lesson.id || `lesson-${lIdx}`}
                                                                    onClick={() => onOpenLesson(lesson, mod.title)}
                                                                    className={`bg-white dark:bg-gray-800 rounded-xl p-5 border shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group flex flex-col h-full ${isRead ? 'border-green-200 dark:border-green-900/50' : isProg ? 'border-amber-200 dark:border-amber-900/50' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'}`}
                                                                >
                                                                    <div className="flex items-start justify-between mb-3">
                                                                        <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isRead ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : isProg ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 dark:group-hover:bg-indigo-900/30 dark:group-hover:text-indigo-400'}`}>
                                                                            {isRead ? <CheckCircleIcon className="h-5 w-5" /> : isProg ? <ClockIcon className="h-5 w-5" /> : <PlayCircleIcon className="h-5 w-5 ml-0.5" />}
                                                                        </div>
                                                                        {isFav && <StarIcon className="h-5 w-5 text-amber-400 fill-current" />}
                                                                    </div>

                                                                    <h4 className="text-base font-bold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors mb-2 leading-tight">
                                                                        {lesson.title}
                                                                    </h4>
                                                                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{lesson.description}</p>

                                                                    <div className="flex items-center gap-2 mt-auto pt-4">
                                                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${isRead ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : isProg ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                                                                            {isRead ? 'Completada' : isProg ? 'En progreso' : 'Nueva'}
                                                                        </span>
                                                                        {hasContent && (
                                                                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 flex items-center gap-1" title="Ya tiene contenido generado y guardado">
                                                                                <BrainCircuitIcon className="h-3 w-3" /> Contenido listo
                                                                            </span>
                                                                        )}
                                                                        <PlayCircleIcon className="h-4 w-4 ml-auto text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 transition-colors" />
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {courseNotes.length === 0 ? (
                                        <div className="col-span-full text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                                            <BrainCircuitIcon className="mx-auto h-12 w-12 text-gray-400" />
                                            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No hay notas para este curso</h3>
                                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Genera notas inteligentes desde las lecciones.</p>
                                        </div>
                                    ) : (
                                        courseNotes.map(note => (
                                            <div key={note.id} className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm relative group">
                                                <div className="text-xs font-bold text-indigo-500 mb-2">{note.tabId}</div>
                                                <div className="prose prose-sm dark:prose-invert max-w-none mb-4 line-clamp-6">
                                                    <SafeRichText markdown={note.content} />
                                                </div>
                                                <div className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                                                    <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
