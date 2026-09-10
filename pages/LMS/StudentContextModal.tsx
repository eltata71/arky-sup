import React, { useState } from 'react';
import { StudentContext } from '../../types/lms';
import { XIcon, UserCogIcon } from 'lucide-react';

interface Props {
    isOpen: boolean;
    context: StudentContext;
    onClose: () => void;
    onSave: (context: StudentContext) => void;
}

/**
 * Lets the student edit their learning profile (industry, tech stack, current
 * project). This calibration feeds the AI lesson generator and the context-aware
 * Tutor IA, so depth and examples match the student's real environment. Before
 * this existed the profile was a hardcoded default with no way to change it.
 */
export const StudentContextModal: React.FC<Props> = ({ isOpen, context, onClose, onSave }) => {
    const [industry, setIndustry] = useState(context.industry);
    const [techStack, setTechStack] = useState(context.techStack);
    const [currentProject, setCurrentProject] = useState(context.currentProject);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave({
            industry: industry.trim(),
            techStack: techStack.trim(),
            currentProject: currentProject.trim(),
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 ring-1 ring-gray-900/5 dark:ring-white/10">
                <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                            <UserCogIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Mi Perfil de Aprendizaje</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">La IA usa esto para calibrar profundidad y ejemplos.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                        <XIcon className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Industria</label>
                        <input
                            type="text"
                            value={industry}
                            onChange={e => setIndustry(e.target.value)}
                            placeholder="Ej. Seguros de Salud y Vida"
                            className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Stack tecnológico de referencia</label>
                        <input
                            type="text"
                            value={techStack}
                            onChange={e => setTechStack(e.target.value)}
                            placeholder="Ej. React, Node.js, AWS, Kafka"
                            className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Proyecto actual</label>
                        <textarea
                            value={currentProject}
                            onChange={e => setCurrentProject(e.target.value)}
                            placeholder="Ej. Migración del core de pólizas a microservicios"
                            className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none h-20"
                        />
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors"
                    >
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
};
