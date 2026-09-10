import React from 'react';
import { Course } from '../../types/lms';
import { BarChart2Icon, BookOpenIcon, LayersIcon, SparklesIcon, UsersIcon } from 'lucide-react';

interface Props {
    courses: Course[];
}

/**
 * Instructor / admin analytics (#5). Aggregates catalog-level metrics that are
 * available client-side (no cross-user reads required): course counts by role,
 * category and level, AI-generated share, and content depth. Gives teachers and
 * admins a live picture of the program's breadth.
 */
export const LMSAnalytics: React.FC<Props> = ({ courses }) => {
    const total = courses.length;
    const aiGenerated = courses.filter(c => c.isAIGenerated).length;
    const totalModules = courses.reduce((acc, c) => acc + c.modules.length, 0);
    const totalLessons = courses.reduce((acc, c) => acc + c.modules.reduce((a, m) => a + m.lessons.length, 0), 0);

    const countBy = (key: (c: Course) => string): { label: string; count: number }[] => {
        const map = new Map<string, number>();
        courses.forEach(c => { const k = key(c); map.set(k, (map.get(k) || 0) + 1); });
        return Array.from(map.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };

    const byRole = countBy(c => c.role);
    const byCategory = countBy(c => c.category);
    const byLevel = countBy(c => c.level);

    const stat = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-2">{icon}<span className="text-xs font-bold uppercase tracking-wider">{label}</span></div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{value}</p>
        </div>
    );

    const distribution = (title: string, rows: { label: string; count: number }[]) => {
        const max = Math.max(1, ...rows.map(r => r.count));
        return (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{title}</h3>
                <div className="space-y-3">
                    {rows.map(r => (
                        <div key={r.label}>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-700 dark:text-gray-300">{r.label}</span>
                                <span className="font-bold text-gray-500 dark:text-gray-400">{r.count}</span>
                            </div>
                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                            </div>
                        </div>
                    ))}
                    {rows.length === 0 && <p className="text-sm text-gray-400">Sin datos.</p>}
                </div>
            </div>
        );
    };

    return (
        <div className="max-w-5xl mx-auto animate-fade-in space-y-8">
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm flex items-center space-x-4">
                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center shadow-inner">
                    <BarChart2Icon className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                    <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Analítica del Programa</h2>
                    <p className="text-gray-500 dark:text-gray-400">Vista para instructores y administradores del catálogo de formación.</p>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {stat(<BookOpenIcon className="h-5 w-5" />, 'Cursos', total)}
                {stat(<LayersIcon className="h-5 w-5" />, 'Módulos', totalModules)}
                {stat(<UsersIcon className="h-5 w-5" />, 'Lecciones', totalLessons)}
                {stat(<SparklesIcon className="h-5 w-5" />, 'Generados por IA', `${aiGenerated}/${total}`)}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {distribution('Cursos por Rol', byRole)}
                {distribution('Cursos por Categoría', byCategory)}
                {distribution('Cursos por Nivel', byLevel)}
            </div>
        </div>
    );
};
