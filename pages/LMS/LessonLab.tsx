import React, { useState, useEffect } from 'react';
import { learningService } from '../../services/ai';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { DiagramChallengeEvaluation } from '../../types/lms';
import { LessonMermaid } from './LessonMermaid';

import { FlaskConicalIcon, Loader2Icon, SparklesIcon, RefreshCwIcon } from 'lucide-react';
import { SafeRichText } from '../../components/ui/SafeRichText';
import { errorMessageOf } from '../../lib/errorMessage';

interface Props {
    courseTitle: string;
    lessonTitle: string;
    role: string;
    level: string;
}

const STARTER_MERMAID = `graph TD
  A[Cliente] --> B[API Gateway]
  B --> C[Servicio]
  C --> D[(Base de Datos)]`;

/**
 * Practical lab (#3): a diagram-based architecture challenge. The student
 * receives an AI-generated scenario, drafts a Mermaid diagram with live
 * preview, and gets a rigorous, per-dimension evaluation grounded in the
 * diagram-quality rubric — turning passive reading into hands-on practice.
 */
export const LessonLab: React.FC<Props> = ({ courseTitle, lessonTitle, role, level }) => {
    const { settings } = useAppContext();
    const { addToast } = useToast();
    const [challenge, setChallenge] = useState('');
    const [isLoadingChallenge, setIsLoadingChallenge] = useState(false);
    const [code, setCode] = useState(STARTER_MERMAID);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluation, setEvaluation] = useState<DiagramChallengeEvaluation | null>(null);

    const loadChallenge = async () => {
        setIsLoadingChallenge(true);
        setEvaluation(null);
        try {
            const text = await learningService.generateDiagramChallenge(courseTitle, lessonTitle, role, level, settings);
            setChallenge(text);
        } catch (error) {
            addToast(errorMessageOf(error, 'No se pudo generar el reto de diagrama.'), 'error');
        } finally {
            setIsLoadingChallenge(false);
        }
    };

    useEffect(() => {
        loadChallenge();
        // Regenerate the challenge when the lesson changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lessonTitle]);

    const handleEvaluate = async () => {
        if (!code.trim()) return;
        setIsEvaluating(true);
        try {
            const result = await learningService.evaluateDiagramChallenge(challenge, code, settings);
            setEvaluation(result);
            addToast(`Evaluación lista: ${result.grade}/100`, result.grade >= 70 ? 'success' : 'info');
        } catch (error) {
            addToast(errorMessageOf(error, 'No se pudo evaluar el diagrama.'), 'error');
        } finally {
            setIsEvaluating(false);
        }
    };

    const scoreColor = (s: number) => s >= 80 ? 'text-green-600' : s >= 60 ? 'text-amber-500' : 'text-red-500';
    const barColor = (s: number) => s >= 80 ? 'bg-green-500' : s >= 60 ? 'bg-amber-500' : 'bg-red-500';

    return (
        <div className="space-y-6">
            {/* Challenge */}
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-5 border border-indigo-100 dark:border-indigo-800">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center text-indigo-700 dark:text-indigo-300 font-bold">
                        <FlaskConicalIcon className="h-5 w-5 mr-2" /> Reto de Diseño
                    </div>
                    <button
                        onClick={loadChallenge}
                        disabled={isLoadingChallenge}
                        className="flex items-center text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                    >
                        <RefreshCwIcon className={`h-3.5 w-3.5 mr-1 ${isLoadingChallenge ? 'animate-spin' : ''}`} /> Nuevo reto
                    </button>
                </div>
                {isLoadingChallenge ? (
                    <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                        <Loader2Icon className="h-4 w-4 mr-2 animate-spin" /> Generando reto…
                    </div>
                ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        <SafeRichText markdown={challenge || ''} />
                    </div>
                )}
            </div>

            {/* Editor + live preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Tu diagrama (Mermaid)</label>
                    <textarea
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        spellCheck={false}
                        className="w-full h-72 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs leading-5"
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Vista previa</label>
                    <div className="h-72 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-950">
                        <LessonMermaid content={code} />
                    </div>
                </div>
            </div>

            <button
                onClick={handleEvaluate}
                disabled={isEvaluating || !code.trim()}
                className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center"
            >
                {isEvaluating ? <><Loader2Icon className="h-5 w-5 mr-2 animate-spin" /> Evaluando diagrama…</> : <><SparklesIcon className="h-5 w-5 mr-2" /> Evaluar Diagrama</>}
            </button>

            {/* Evaluation */}
            {evaluation && (
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm animate-fade-in space-y-5">
                    <div className="flex items-center justify-between">
                        <h4 className="text-lg font-bold text-gray-900 dark:text-white">Evaluación del Arquitecto-Profesor</h4>
                        <span className={`text-2xl font-black ${scoreColor(evaluation.grade)}`}>{evaluation.grade}/100</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{evaluation.summary}</p>

                    {evaluation.dimensions.length > 0 && (
                        <div className="space-y-3">
                            {evaluation.dimensions.map((dim, i) => (
                                <div key={i}>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="font-medium text-gray-700 dark:text-gray-300">{dim.name}</span>
                                        <span className={`font-bold ${scoreColor(dim.score)}`}>{dim.score}</span>
                                    </div>
                                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                        <div className={`h-full rounded-full ${barColor(dim.score)}`} style={{ width: `${Math.max(0, Math.min(100, dim.score))}%` }} />
                                    </div>
                                    {dim.feedback && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{dim.feedback}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    {evaluation.improvements.length > 0 && (
                        <div>
                            <h5 className="font-bold text-gray-900 dark:text-white mb-2 text-sm">Puntos de mejora</h5>
                            <ul className="list-disc pl-5 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                                {evaluation.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
