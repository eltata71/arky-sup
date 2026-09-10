
import React, { useState, useEffect } from 'react';
import { Course, CourseLevel, ArchitectRole, CourseCategory } from '../../types/lms';
import { Modal } from '../../components/Modal';

interface EditCourseModalProps {
    course: Course;
    isOpen: boolean;
    onClose: () => void;
    onSave: (courseId: string, updates: Partial<Course>) => void;
}

export const EditCourseModal: React.FC<EditCourseModalProps> = ({ course, isOpen, onClose, onSave }) => {
    const [title, setTitle] = useState(course.title);
    const [description, setDescription] = useState(course.description);
    const [courseContext, setCourseContext] = useState(course.courseContext || '');
    const [level, setLevel] = useState<CourseLevel>(course.level);
    const [role, setRole] = useState<ArchitectRole>(course.role);
    const [category, setCategory] = useState<CourseCategory>(course.category);

    useEffect(() => {
        setTitle(course.title);
        setDescription(course.description);
        setCourseContext(course.courseContext || '');
        setLevel(course.level);
        setRole(course.role);
        setCategory(course.category);
    }, [course]);

    const handleSave = () => {
        if (!title.trim()) return;
        onSave(course.id, {
            title: title.trim(),
            description: description.trim(),
            courseContext: courseContext.trim() || undefined,
            level,
            role,
            category,
        });
        onClose();
    };

    const levels: CourseLevel[] = ['Básico', 'Intermedio', 'Avanzado'];
    const roles: ArchitectRole[] = [
        'Arquitecto de Soluciones',
        'Arquitecto Empresarial',
        'Arquitecto de Software',
        'Arquitecto de Datos',
        'Arquitecto de Infraestructura',
        'Arquitecto de Seguridad',
    ];
    const categories: CourseCategory[] = ['Architecture', 'Business', 'Tooling'];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Editar Curso">
            <div className="space-y-5">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Título</label>
                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Descripción</label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={3}
                        className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                        Contexto del Curso <span className="font-normal text-gray-400">(guía para la generación de contenido IA)</span>
                    </label>
                    <textarea
                        value={courseContext}
                        onChange={e => setCourseContext(e.target.value)}
                        rows={4}
                        placeholder="Ej: Este curso asume un sistema core basado en COBOL. El equipo evalúa migrar a microservicios Java con integración hospitalaria..."
                        className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Nivel</label>
                        <select
                            value={level}
                            onChange={e => setLevel(e.target.value as CourseLevel)}
                            className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {levels.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Categoría</label>
                        <select
                            value={category}
                            onChange={e => setCategory(e.target.value as CourseCategory)}
                            className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Rol</label>
                        <select
                            value={role}
                            onChange={e => setRole(e.target.value as ArchitectRole)}
                            className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {roles.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!title.trim()}
                        className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </Modal>
    );
};
