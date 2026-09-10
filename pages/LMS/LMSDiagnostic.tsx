import React, { useState } from 'react';
import { Course, ArchitectRole, DiagnosticQuestion, DiagnosticResult, CompetencyScore } from '../../types/lms';
import { learningService } from '../../services/ai';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { competencyLevel } from '../../lib/lmsProgress';
import { TargetIcon, Loader2Icon, SparklesIcon, ChevronRightIcon, RotateCcwIcon, CompassIcon } from 'lucide-react';
import { errorMessageOf } from '../../lib/errorMessage';

interface Props {
    courses: Course[];
    progress: { diagnostics?: Record<string, DiagnosticResult> };
    onSaveDiagnostic: (result: DiagnosticResult) => void;
    onOpenCourse: (course: Course) => void;
    onNavigate: (view: 'ai-lab') => void;
}

const ROLES: ArchitectRole[] = [
    'Arquitecto de Soluciones',
    'Arquitecto Empresarial',
    'Arquitecto de Software',
    'Arquitecto de Datos',
    'Arquitecto de Infraestructura',
    'Arquitecto de Seguridad',
];

type Phase = 'intro' | 'loading' | 'taking' | 'result';

const levelColor = (score: number) => score >= 85 ? 'bg-green-500' : score >= 65 ? 'bg-blue-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';

export const LMSDiagnostic: React.FC<Props> = ({ courses, progress, onSaveDiagnostic, onOpenCourse, onNavigate }) => {
    const { settings } = useAppContext();
    const { addToast } = useToast();
    const [role, setRole] = useState<ArchitectRole>('Arquitecto de Soluciones');
    const [phase, setPhase] = useState<Phase>('intro');
    const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
    const [answers, setAnswers] = useState<Record<number, number>>({});
    const [result, setResult] = useState<DiagnosticResult | null>(null);

    const savedResult = progress.diagnostics?.[role] || null;

    const startDiagnostic = async () => {
        setPhase('loading');
        setAnswers({});
        setResult(null);
        try {
            const qs = await learningService.generateRoleDiagnostic(role, settings);
            if (!qs.length) throw new Error('El diagnóstico llegó vacío. Intenta de nuevo.');
            setQuestions(qs);
            setPhase('taking');
        } catch (error) {
            addToast(errorMessageOf(error, 'No se pudo generar el diagnóstico.'), 'error');
            setPhase('intro');
        }
    };

    const recommendCourses = (): string[] => {
        const roleCourses = courses.filter(c => c.role === role);
        return roleCourses.slice(0, 4).map(c => c.title);
    };

    const finishDiagnostic = () => {
        const competencies: CompetencyScore[] = questions.map((q, i) => {
            const score = answers[i] === q.correctIndex ? 100 : 0;
            return { area: q.area, score, level: competencyLevel(score) };
        });
        const overall = Math.round(competencies.reduce((acc, c) => acc + c.score, 0) / (competencies.length || 1));
        const diagnostic: DiagnosticResult = {
            role,
            at: Date.now(),
            overall,
            competencies,
            recommendedCourseTitles: recommendCourses(),
        };
        setResult(diagnostic);
        onSaveDiagnostic(diagnostic);
        setPhase('result');
    };

    const renderResult = (r: DiagnosticResult) => {
        // Weakest areas first → the adaptive path tackles gaps first.
        const sorted = [...r.competencies].sort((a, b) => a.score - b.score);
        const recommended = r.recommendedCourseTitles
            .map(title => courses.find(c => c.title === title))
            .filter((c): c is Course => !!c);
        return (
            <div className="space-y-8">
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">{r.role}</p>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Mapa de Competencias</h3>
                        </div>
                        <div className="text-right">
                            <span className="text-3xl font-black text-indigo-600 dark:text-indigo-400">{r.overall}%</span>
                            <p className="text-xs text-gray-400">dominio general</p>
                        </div>
                    </div>
                    <div className="space-y-4">
                        {sorted.map((c, i) => (
                            <div key={i}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="font-medium text-gray-700 dark:text-gray-300">{c.area}</span>
                                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{c.level}</span>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-500 ${levelColor(c.score)}`} style={{ width: `${c.score}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Adaptive learning path */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm">
                    <div className="flex items-center mb-4 text-indigo-700 dark:text-indigo-300 font-bold">
                        <CompassIcon className="h-5 w-5 mr-2" /> Tu Ruta de Aprendizaje Recomendada
                    </div>
                    {recommended.length > 0 ? (
                        <div className="space-y-3">
                            {recommended.map((course, idx) => (
                                <div
                                    key={course.id}
                                    onClick={() => onOpenCourse(course)}
                                    className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors group"
                                >
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold flex items-center justify-center">{idx + 1}</div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-gray-900 dark:text-white line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{course.title}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{course.description}</p>
                                    </div>
                                    <ChevronRightIcon className="h-5 w-5 text-gray-400 group-hover:translate-x-1 transition-transform" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Aún no hay cursos para este rol en tu catálogo.</p>
                            <button onClick={() => onNavigate('ai-lab')} className="inline-flex items-center bg-indigo-600 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
                                <SparklesIcon className="h-4 w-4 mr-2" /> Generar cursos con IA
                            </button>
                        </div>
                    )}
                </div>

                <button onClick={() => setPhase('intro')} className="flex items-center text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                    <RotateCcwIcon className="h-4 w-4 mr-2" /> Repetir diagnóstico
                </button>
            </div>
        );
    };

    return (
        <div className="max-w-4xl mx-auto animate-fade-in space-y-8">
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center space-x-4 mb-2">
                    <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center shadow-inner">
                        <TargetIcon className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Diagnóstico de Competencias</h2>
                        <p className="text-gray-500 dark:text-gray-400">Descubre tus brechas y recibe una ruta de aprendizaje personalizada.</p>
                    </div>
                </div>
            </div>

            {phase === 'intro' && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                    <div>
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Selecciona tu rol</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {ROLES.map(r => (
                                <button
                                    key={r}
                                    onClick={() => setRole(r)}
                                    className={`text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${role === r ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                    {savedResult && (
                        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 p-4 text-sm text-indigo-800 dark:text-indigo-200">
                            Ya tienes un diagnóstico previo para este rol ({savedResult.overall}% general).{' '}
                            <button onClick={() => { setResult(savedResult); setPhase('result'); }} className="font-bold underline">Ver resultado</button>
                        </div>
                    )}
                    <button onClick={startDiagnostic} className="bg-indigo-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-md flex items-center">
                        <SparklesIcon className="h-5 w-5 mr-2" /> Iniciar diagnóstico
                    </button>
                </div>
            )}

            {phase === 'loading' && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-12 border border-gray-200 dark:border-gray-800 shadow-sm text-center flex flex-col items-center">
                    <Loader2Icon className="h-10 w-10 text-indigo-600 animate-spin mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">Generando tu diagnóstico para {role}…</p>
                </div>
            )}

            {phase === 'taking' && (
                <div className="space-y-6">
                    {questions.map((q, qi) => (
                        <div key={qi} className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">{q.area}</span>
                                <span className="text-xs text-gray-400">{qi + 1}/{questions.length}</span>
                            </div>
                            <p className="font-bold text-gray-900 dark:text-white mb-3">{q.question}</p>
                            <div className="space-y-2">
                                {q.options.map((opt, oi) => (
                                    <button
                                        key={oi}
                                        onClick={() => setAnswers(prev => ({ ...prev, [qi]: oi }))}
                                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors ${answers[qi] === oi ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                    <button
                        onClick={finishDiagnostic}
                        disabled={Object.keys(answers).length < questions.length}
                        className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        {Object.keys(answers).length < questions.length ? `Responde todas (${Object.keys(answers).length}/${questions.length})` : 'Ver mi diagnóstico'}
                    </button>
                </div>
            )}

            {phase === 'result' && result && renderResult(result)}
        </div>
    );
};
