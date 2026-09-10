
import React, { useState } from 'react';
import { Course, CourseCategory, CourseLevel, ArchitectRole, UserProgress } from '../../types/lms';
import { BookOpenIcon, SparklesIcon, ChevronRightIcon, Loader2Icon, TableIcon, LayoutGridIcon } from 'lucide-react';
import { asCourseCategory, asCourseLevel, learningService } from '../../services/ai';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { v4 as uuidv4 } from 'uuid';
import { errorMessageOf } from '../../lib/errorMessage';

interface Props {
    courses: Course[];
    progress: UserProgress;
    onOpenCourse: (course: Course) => void;
    onNavigate: (view: 'ai-lab') => void;
    onAddCourses: (courses: Course[]) => void;
}

export const LMSCatalog: React.FC<Props> = ({ courses, progress, onOpenCourse, onNavigate, onAddCourses }) => {
    const { settings } = useAppContext();
    const { addToast } = useToast();
    const [selectedRole, setSelectedRole] = useState<ArchitectRole>('Arquitecto de Soluciones');
    const [selectedLevel, setSelectedLevel] = useState<CourseLevel | 'Todos'>('Todos');
    const [selectedCategory, setSelectedCategory] = useState<CourseCategory | 'Todas'>('Todas');
    const [isGenerating, setIsGenerating] = useState(false);
    const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

    const roles: ArchitectRole[] = [
        'Arquitecto de Soluciones',
        'Arquitecto Empresarial',
        'Arquitecto de Software',
        'Arquitecto de Datos',
        'Arquitecto de Infraestructura',
        'Arquitecto de Seguridad'
    ];

    const filteredCourses = courses.filter(c => {
        if (c.role !== selectedRole) return false;
        if (selectedLevel !== 'Todos' && c.level !== selectedLevel) return false;
        if (selectedCategory !== 'Todas' && c.category !== selectedCategory) return false;
        return true;
    }).sort((a, b) => {
        const accessA = progress.courseLastAccessed?.[a.id] ?? 0;
        const accessB = progress.courseLastAccessed?.[b.id] ?? 0;
        if (accessA !== accessB) return accessB - accessA;
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
    });

    // Typed as the unions the filters actually hold, so the pills cannot drift
    // from `CourseCategory`/`CourseLevel` and the click handlers need no cast.
    const categories: Array<CourseCategory | 'Todas'> = ['Todas', 'Tooling', 'Architecture', 'Business'];
    const levels: Array<CourseLevel | 'Todos'> = ['Todos', 'Básico', 'Intermedio', 'Avanzado'];

    const handleGenerateCatalog = async () => {
        setIsGenerating(true);
        try {
            const generatedData = await learningService.generateRoleCatalog(selectedRole, settings);

            const newCourses: Course[] = generatedData.map((c) => ({
                id: uuidv4(),
                title: c.title ?? '',
                description: c.description ?? '',
                icon: 'book',
                category: asCourseCategory(c.category),
                level: asCourseLevel(c.level),
                role: selectedRole,
                isAIGenerated: true,
                modules: (c.modules ?? []).map((m) => ({
                    id: uuidv4(),
                    title: m.title ?? '',
                    level: asCourseLevel(m.level),
                    lessons: (m.lessons ?? []).map((l) => ({
                        id: uuidv4(),
                        title: l.title ?? '',
                        description: l.description ?? ''
                    }))
                }))
            }));

            if (newCourses.length === 0) {
                addToast('La IA no devolvió cursos. Intenta de nuevo.', 'warning');
            } else {
                onAddCourses(newCourses);
                addToast(`Catálogo generado: ${newCourses.length} cursos para ${selectedRole}.`, 'success');
            }
        } catch (error) {
            console.error("Error generating catalog:", error);
            addToast(errorMessageOf(error, 'Hubo un error al generar el catálogo. Intenta de nuevo.'), 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const getLastAccessed = (courseId: string) => {
        const lastTs = progress.courseLastAccessed?.[courseId];
        return lastTs ? new Date(lastTs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sin actividad';
    };

    return (
        <div className="animate-fade-in max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Panel: Filters & Controls */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm sticky top-6">
                        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2 leading-tight">Catálogo de Rutas</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            Selecciona tu rol y descubre rutas de aprendizaje diseñadas para ti.
                        </p>

                        <div className="space-y-6">
                            {/* Role Selector */}
                            <div>
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Rol Profesional</div>
                                <div className="flex flex-col gap-2">
                                    {roles.map(role => (
                                        <button
                                            key={role}
                                            onClick={() => setSelectedRole(role)}
                                            className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${selectedRole === role ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                                        >
                                            {role}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-6 border-t border-gray-100 dark:border-gray-800 space-y-6">
                                {/* Category Pills */}
                                <div>
                                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Categoría</div>
                                    <div className="flex flex-wrap gap-2">
                                        {categories.map(cat => (
                                            <button
                                                key={cat}
                                                onClick={() => setSelectedCategory(cat)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedCategory === cat ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Level Pills */}
                                <div>
                                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Nivel</div>
                                    <div className="flex flex-wrap gap-2">
                                        {levels.map(lvl => (
                                            <button
                                                key={lvl}
                                                onClick={() => setSelectedLevel(lvl)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedLevel === lvl ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                                            >
                                                {lvl}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Panel: Course Grid/Table */}
                <div className="lg:col-span-9">
                    {/* View Toggle Header */}
                    {!isGenerating && filteredCourses.length > 0 && (
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">{filteredCourses.length} cursos encontrados</p>
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
                        </div>
                    )}

                    {/* Empty State */}
                    {filteredCourses.length === 0 && !isGenerating && (
                        <div className="bg-white dark:bg-gray-900 rounded-2xl p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center flex flex-col items-center justify-center min-h-[400px]">
                            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-6">
                                <SparklesIcon className="h-10 w-10 text-indigo-500" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Catálogo no disponible</h3>
                            <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">
                                Aún no tenemos cursos predeterminados para el rol de <strong>{selectedRole}</strong>.
                                Podemos generar un catálogo completo de 8 cursos especializados usando IA ahora mismo.
                            </p>
                            <button
                                onClick={handleGenerateCatalog}
                                className="bg-indigo-600 text-white font-bold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg flex items-center"
                            >
                                <SparklesIcon className="h-5 w-5 mr-2" /> Generar Catálogo con IA
                            </button>
                        </div>
                    )}

                    {/* Loading State */}
                    {isGenerating && (
                        <div className="bg-white dark:bg-gray-900 rounded-2xl p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center flex flex-col items-center justify-center min-h-[400px]">
                            <Loader2Icon className="h-12 w-12 text-indigo-600 animate-spin mb-6" />
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Diseñando el Catálogo...</h3>
                            <p className="text-gray-500 dark:text-gray-400 max-w-md">
                                Nuestra IA está estructurando 8 cursos completos con módulos y tarjetas de conocimiento para el rol de {selectedRole}. Esto tomará unos segundos.
                            </p>
                        </div>
                    )}

                    {/* Table View */}
                    {!isGenerating && filteredCourses.length > 0 && viewMode === 'table' && (
                        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead>
                                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                            <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Curso</th>
                                            <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Descripción</th>
                                            <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Categoría</th>
                                            <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Nivel</th>
                                            <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Módulos</th>
                                            <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider whitespace-nowrap">Última Actividad</th>
                                            <th className="px-4 py-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredCourses.map(course => (
                                            <tr key={course.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group" onClick={() => onOpenCourse(course)}>
                                                <td className="px-4 py-3">
                                                    <span className="font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">{course.title}</span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="text-gray-500 dark:text-gray-400 line-clamp-2 max-w-xs text-xs">{course.description}</p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 whitespace-nowrap">
                                                        {course.category}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap">
                                                        {course.level}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                                                    <div className="flex items-center gap-1.5">
                                                        <BookOpenIcon className="h-3.5 w-3.5" />
                                                        {course.modules.length}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                    {getLastAccessed(course.id)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <button className="inline-flex items-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">
                                                        Ver Curso <ChevronRightIcon className="h-3.5 w-3.5 ml-1" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Cards View */}
                    {!isGenerating && filteredCourses.length > 0 && viewMode === 'cards' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {/* AI Lab Card */}
                            <div
                                onClick={() => onNavigate('ai-lab')}
                                className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-2xl p-6 border-2 border-dashed border-indigo-300 dark:border-indigo-700/50 shadow-sm hover:shadow-lg hover:border-indigo-500 dark:hover:border-indigo-500 transition-all cursor-pointer group flex flex-col items-center justify-center text-center min-h-[280px]"
                            >
                                <div className="w-16 h-16 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-md mb-4 group-hover:scale-110 transition-transform">
                                    <SparklesIcon className="h-8 w-8 text-yellow-500" />
                                </div>
                                <h3 className="text-xl font-bold text-indigo-900 dark:text-indigo-100 mb-2">¿Falta algo?</h3>
                                <p className="text-sm text-indigo-700/70 dark:text-indigo-300/70 mb-6">
                                    Genera un curso completamente personalizado sobre cualquier tecnología usando IA.
                                </p>
                                <span className="inline-flex items-center font-bold text-indigo-600 dark:text-indigo-400 group-hover:underline">
                                    Ir al Laboratorio IA <ChevronRightIcon className="h-4 w-4 ml-1" />
                                </span>
                            </div>

                            {/* Course Cards */}
                            {filteredCourses.map(course => (
                                <div key={course.id} onClick={() => onOpenCourse(course)} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col h-full min-h-[280px]">
                                    <div className="flex items-start justify-between mb-4">
                                        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                                            {course.category}
                                        </span>
                                        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                            {course.level}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3 group-hover:text-indigo-600 transition-colors leading-tight">{course.title}</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3 mb-6 flex-grow">{course.description}</p>

                                    <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800 mt-auto">
                                        <div className="flex items-center text-xs font-medium text-gray-500">
                                            <BookOpenIcon className="h-4 w-4 mr-1.5" />
                                            {course.modules.length} Módulos
                                        </div>
                                        <div className="flex items-center text-sm font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform">
                                            Ver Curso <ChevronRightIcon className="h-4 w-4 ml-1" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
