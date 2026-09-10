
import React, { useState, useRef, useEffect } from 'react';
import { Course, UserProgress } from '../../types/lms';
import { BookOpenIcon, StarIcon, SparklesIcon, ArrowRightIcon, PlayCircleIcon, MoreVerticalIcon, PencilIcon, Trash2Icon, BarChart2Icon, RotateCcwIcon, ExternalLinkIcon, TableIcon, LayoutGridIcon, FlameIcon, AwardIcon, ZapIcon, TrophyIcon } from 'lucide-react';
import { EditCourseModal } from './EditCourseModal';
import { levelFromXp } from '../../lib/lmsProgress';

interface Props {
    courses: Course[];
    progress: UserProgress;
    onOpenCourse: (course: Course) => void;
    onNavigate: (view: 'catalog' | 'ai-lab') => void;
    onDeleteCourse: (courseId: string) => void;
    onUpdateCourse: (courseId: string, updates: Partial<Course>) => void;
    onResetCourseProgress: (courseId: string, lessonIds: string[]) => void;
    /**
     * Whether this person may edit or withdraw this particular course.
     *
     * Two different things wear the same menu item here. A course somebody
     * generated for themselves in the AI Lab is *their record*, and taking that
     * away would break what the Training Center is for. A course in the shared
     * catalogue is the curriculum, and editing it changes what everyone studies
     * — that is `training:author`.
     *
     * Passed as a predicate rather than a boolean because the answer depends on
     * the course, and resolved by the screen that owns the session so this
     * component stays presentational.
     */
    canManageCourse: (course: Course) => boolean;
}

export const LMSDashboard: React.FC<Props> = ({ courses, progress, onOpenCourse, onNavigate, onDeleteCourse, onUpdateCourse, onResetCourseProgress, canManageCourse }) => {
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [editingCourse, setEditingCourse] = useState<Course | null>(null);
    const [statsCourse, setStatsCourse] = useState<Course | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpenId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const myCourses = courses.filter(c => {
        const hasProgress = c.modules.some(m => m.lessons.some(l =>
            progress.readLessons.includes(l.id) || progress.inProgressLessons.includes(l.id)));
        return hasProgress || progress.favoriteCourses.includes(c.id);
    }).sort((a, b) => {
        const ta = progress.courseLastAccessed?.[a.id] ?? 0;
        const tb = progress.courseLastAccessed?.[b.id] ?? 0;
        return tb - ta;
    });

    const recentCourse = myCourses.length > 0 ? myCourses[0] : null;

    const getCourseStats = (course: Course) => {
        const allLessons = course.modules.flatMap(m => m.lessons);
        const total = allLessons.length;
        const read = allLessons.filter(l => progress.readLessons.includes(l.id)).length;
        const inProg = allLessons.filter(l => progress.inProgressLessons.includes(l.id)).length;
        const percent = total === 0 ? 0 : Math.round((read / total) * 100);
        const lastTs = progress.courseLastAccessed?.[course.id];
        const lastAccessed = lastTs ? new Date(lastTs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sin actividad';
        return { total, read, inProg, percent, lastAccessed };
    };

    const renderCourseMenu = (course: Course) => (
        <div ref={menuOpenId === course.id ? menuRef : undefined} className="relative">
            <button
                onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === course.id ? null : course.id); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Opciones del curso"
            >
                <MoreVerticalIcon className="h-4 w-4" />
            </button>
            {menuOpenId === course.id && (
                <div className="absolute right-0 top-8 w-52 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
                    <button
                        onClick={e => { e.stopPropagation(); setMenuOpenId(null); onOpenCourse(course); }}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <ExternalLinkIcon className="h-4 w-4 mr-3 text-indigo-500" /> Abrir curso
                    </button>
                    {canManageCourse(course) && (
                    <button
                        onClick={e => { e.stopPropagation(); setMenuOpenId(null); setEditingCourse(course); }}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <PencilIcon className="h-4 w-4 mr-3 text-blue-500" /> Editar curso
                    </button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); setMenuOpenId(null); setStatsCourse(course); }}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <BarChart2Icon className="h-4 w-4 mr-3 text-green-500" /> Estadísticas
                    </button>
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                            const lessonIds = course.modules.flatMap(m => m.lessons.map(l => l.id));
                            onResetCourseProgress(course.id, lessonIds);
                        }}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <RotateCcwIcon className="h-4 w-4 mr-3 text-orange-500" /> Resetear progreso
                    </button>
                    {canManageCourse(course) && (
                    <>
                    <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                    <button
                        onClick={e => { e.stopPropagation(); setMenuOpenId(null); setConfirmDeleteId(course.id); }}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <Trash2Icon className="h-4 w-4 mr-3" /> Eliminar curso
                    </button>
                    </>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Hero Section */}
            <div className="relative bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900 rounded-3xl p-8 md:p-12 overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 w-96 h-96 bg-white opacity-5 rounded-full blur-3xl -mr-20 -mt-20"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-500 opacity-20 rounded-full blur-3xl -ml-20 -mb-20"></div>

                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="max-w-2xl">
                        <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-4 tracking-tight">
                            Tu carrera como Arquitecto, <span className="text-yellow-400">potenciada por IA</span>
                        </h1>
                        <p className="text-indigo-100 text-lg mb-8 leading-relaxed">
                            Explora rutas de aprendizaje curadas o genera un curso personalizado sobre cualquier tecnología emergente en segundos.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button
                                onClick={() => onNavigate('ai-lab')}
                                className="bg-yellow-400 text-indigo-900 font-bold px-6 py-3 rounded-xl hover:bg-yellow-300 transition-all shadow-lg hover:shadow-xl flex items-center justify-center group"
                            >
                                <SparklesIcon className="h-5 w-5 mr-2 group-hover:rotate-12 transition-transform" />
                                Generar Curso con IA
                            </button>
                            <button
                                onClick={() => onNavigate('catalog')}
                                className="bg-white/10 text-white border border-white/20 font-semibold px-6 py-3 rounded-xl hover:bg-white/20 transition-all flex items-center justify-center"
                            >
                                Explorar Catálogo
                            </button>
                        </div>
                    </div>

                    {/* Quick Resume Card */}
                    {recentCourse && (() => {
                        const { total, read, percent } = getCourseStats(recentCourse);
                        return (
                            <div className="hidden lg:block w-80 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 shadow-2xl">
                                <div className="text-xs font-bold text-indigo-200 uppercase tracking-wider mb-3">Continuar Aprendiendo</div>
                                <h3 className="text-lg font-bold text-white mb-1 line-clamp-2">{recentCourse.title}</h3>
                                <p className="text-xs text-indigo-300 mb-3">{read} de {total} lecciones completadas</p>
                                <div className="w-full bg-white/20 rounded-full h-1.5 mb-4">
                                    <div className="bg-yellow-400 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                                </div>
                                <button
                                    onClick={() => onOpenCourse(recentCourse)}
                                    className="w-full bg-white text-indigo-900 font-bold py-2 rounded-lg hover:bg-indigo-50 transition-colors flex items-center justify-center"
                                >
                                    <PlayCircleIcon className="h-4 w-4 mr-2" /> Retomar
                                </button>
                            </div>
                        );
                    })()}
                </div>
            </div>

            {/* Gamification strip (#5) */}
            {(() => {
                const xp = progress.xp || 0;
                const lvl = levelFromXp(xp);
                const streak = progress.streak?.count || 0;
                const certificates = progress.certificates?.length || 0;
                return (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-200 dark:border-gray-800 shadow-sm">
                            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-2">
                                <TrophyIcon className="h-5 w-5" />
                                <span className="text-xs font-bold uppercase tracking-wider">Nivel {lvl.level}</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{lvl.title}</p>
                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 mt-2 overflow-hidden">
                                <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${lvl.progressPercent}%` }} />
                            </div>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-200 dark:border-gray-800 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-500 mb-2">
                                <ZapIcon className="h-5 w-5" />
                                <span className="text-xs font-bold uppercase tracking-wider">Experiencia</span>
                            </div>
                            <p className="text-2xl font-black text-gray-900 dark:text-white">{xp} <span className="text-sm font-bold text-gray-400">XP</span></p>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-200 dark:border-gray-800 shadow-sm">
                            <div className="flex items-center gap-2 text-orange-500 mb-2">
                                <FlameIcon className="h-5 w-5" />
                                <span className="text-xs font-bold uppercase tracking-wider">Racha</span>
                            </div>
                            <p className="text-2xl font-black text-gray-900 dark:text-white">{streak} <span className="text-sm font-bold text-gray-400">{streak === 1 ? 'día' : 'días'}</span></p>
                        </div>
                        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-200 dark:border-gray-800 shadow-sm">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-2">
                                <AwardIcon className="h-5 w-5" />
                                <span className="text-xs font-bold uppercase tracking-wider">Certificados</span>
                            </div>
                            <p className="text-2xl font-black text-gray-900 dark:text-white">{certificates}</p>
                        </div>
                    </div>
                );
            })()}

            {/* My Courses Section */}
            <div>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Mi Aprendizaje</h2>
                    <div className="flex items-center gap-3">
                        {myCourses.length > 0 && (
                            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                <button
                                    onClick={() => setViewMode('table')}
                                    className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                                    title="Vista tabla"
                                >
                                    <TableIcon className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode('cards')}
                                    className={`p-1.5 rounded-md transition-all ${viewMode === 'cards' ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                                    title="Vista tarjetas"
                                >
                                    <LayoutGridIcon className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                        {myCourses.length > 0 && (
                            <button onClick={() => onNavigate('catalog')} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center">
                                Ver todo <ArrowRightIcon className="h-4 w-4 ml-1" />
                            </button>
                        )}
                    </div>
                </div>

                {myCourses.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl p-10 border border-gray-200 dark:border-gray-800 shadow-sm text-center">
                        <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <BookOpenIcon className="h-10 w-10 text-indigo-500" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Aún no tienes cursos activos</h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                            Comienza tu viaje de aprendizaje explorando nuestro catálogo de rutas arquitectónicas o crea un curso a tu medida.
                        </p>
                        <button
                            onClick={() => onNavigate('catalog')}
                            className="bg-indigo-600 text-white font-medium px-6 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors inline-flex items-center"
                        >
                            Ir al Catálogo <ArrowRightIcon className="h-4 w-4 ml-2" />
                        </button>
                    </div>
                ) : viewMode === 'table' ? (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Curso</th>
                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Descripción</th>
                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider whitespace-nowrap">Última Actividad</th>
                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Progreso</th>
                                        <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider"></th>
                                        <th className="px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {myCourses.map(course => {
                                        const { total, read, percent, lastAccessed } = getCourseStats(course);
                                        return (
                                            <tr key={course.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        {progress.favoriteCourses.includes(course.id) && (
                                                            <StarIcon className="h-3.5 w-3.5 text-amber-400 fill-current flex-shrink-0" />
                                                        )}
                                                        <div className="min-w-0">
                                                            <span className="font-medium text-gray-900 dark:text-white line-clamp-1 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer transition-colors" onClick={() => onOpenCourse(course)}>
                                                                {course.title}
                                                            </span>
                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 block">{course.category}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="text-gray-500 dark:text-gray-400 line-clamp-2 max-w-xs text-xs">{course.description}</p>
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                                                    {lastAccessed}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-20 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                                            <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                                                        </div>
                                                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{percent}%</span>
                                                        <span className="text-[10px] text-gray-400 whitespace-nowrap">({read}/{total})</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <button
                                                        onClick={() => onOpenCourse(course)}
                                                        className="inline-flex items-center text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                                    >
                                                        <PlayCircleIcon className="h-3.5 w-3.5 mr-1.5" /> Continuar
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {renderCourseMenu(course)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {myCourses.map(course => {
                            const { total, read, percent } = getCourseStats(course);

                            return (
                                <div key={course.id} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all relative group flex flex-col h-full">
                                    {/* Favorite star */}
                                    {progress.favoriteCourses.includes(course.id) && (
                                        <div className="absolute top-4 left-4 bg-amber-50 dark:bg-amber-900/20 p-1.5 rounded-full shadow-sm">
                                            <StarIcon className="h-4 w-4 text-amber-400 fill-current" />
                                        </div>
                                    )}

                                    {/* Three-dot menu */}
                                    <div className="absolute top-3 right-3">
                                        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                            {renderCourseMenu(course)}
                                        </div>
                                    </div>

                                    {/* Card content — clickable */}
                                    <div onClick={() => onOpenCourse(course)} className="cursor-pointer flex flex-col flex-1">
                                        <div className="flex items-center space-x-3 mb-4">
                                            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
                                                <BookOpenIcon className="h-6 w-6" />
                                            </div>
                                            <div className="flex-1 min-w-0 pr-6">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">{course.category}</span>
                                                <h3 className="text-lg font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-indigo-600 transition-colors">{course.title}</h3>
                                            </div>
                                        </div>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-6 flex-grow">{course.description}</p>
                                        <div className="space-y-2 mt-auto">
                                            <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
                                                <span>{read} de {total} lecciones</span>
                                                <span className="text-indigo-600 dark:text-indigo-400 font-bold">{percent}%</span>
                                            </div>
                                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                                <div className="bg-indigo-600 h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${percent}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Edit Course Modal */}
            {editingCourse && (
                <EditCourseModal
                    course={editingCourse}
                    isOpen={true}
                    onClose={() => setEditingCourse(null)}
                    onSave={onUpdateCourse}
                />
            )}

            {/* Statistics Modal */}
            {statsCourse && (() => {
                const { total, read, inProg, percent, lastAccessed } = getCourseStats(statsCourse);
                return (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => setStatsCourse(null)} />
                        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 ring-1 ring-gray-900/5 dark:ring-white/10">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{statsCourse.title}</h2>
                            <p className="text-xs text-indigo-500 font-semibold uppercase tracking-wider mb-5">{statsCourse.category} · {statsCourse.level}</p>
                            <div className="space-y-3 mb-5">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Total de lecciones</span>
                                    <span className="font-bold text-gray-900 dark:text-white">{total}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Lecciones completadas</span>
                                    <span className="font-bold text-green-600">{read}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">En progreso</span>
                                    <span className="font-bold text-blue-600">{inProg}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Progreso general</span>
                                    <span className="font-bold text-indigo-600">{percent}%</span>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                                    <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${percent}%` }} />
                                </div>
                                <div className="flex justify-between text-sm pt-1">
                                    <span className="text-gray-500 dark:text-gray-400">Último acceso</span>
                                    <span className="font-semibold text-gray-700 dark:text-gray-300 text-right">{lastAccessed}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Módulos</span>
                                    <span className="font-bold text-gray-900 dark:text-white">{statsCourse.modules.length}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setStatsCourse(null)}
                                className="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-xl hover:bg-indigo-700 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                );
            })()}

            {/* Delete Confirmation Modal */}
            {confirmDeleteId && (() => {
                const course = courses.find(c => c.id === confirmDeleteId);
                return (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)} />
                        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 ring-1 ring-gray-900/5 dark:ring-white/10">
                            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Trash2Icon className="h-6 w-6 text-red-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-2">Eliminar Curso</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                                ¿Estás seguro de que deseas eliminar <span className="font-semibold text-gray-700 dark:text-gray-300">"{course?.title}"</span>? Esta acción no se puede deshacer.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="flex-1 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => { onDeleteCourse(confirmDeleteId); setConfirmDeleteId(null); }}
                                    className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors"
                                >
                                    Eliminar
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};
