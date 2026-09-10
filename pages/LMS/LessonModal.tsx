
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Course, Lesson, SmartNote, StudentContext, UserProgress, QuizResult } from '../../types/lms';
import { QUIZ_PASS_PERCENT } from '../../lib/lmsProgress';
import {
    XIcon, BrainCircuitIcon, CheckCircleIcon, DownloadIcon, PrinterIcon, MessageSquareIcon,
    StarIcon, ClockIcon, ArrowLeftIcon, RefreshCwIcon, HistoryIcon, AlertTriangleIcon,
    FileTextIcon, GraduationCap, LightbulbIcon, BookMarkedIcon, NetworkIcon, FlaskConicalIcon,
    BriefcaseIcon, PackageIcon, TargetIcon, RouteIcon, PresentationIcon, ScaleIcon, ShieldIcon,
    GaugeIcon, Link2Icon, ClipboardCheckIcon, MessagesSquareIcon, SparklesIcon, type LucideIcon,
} from 'lucide-react';
import {
    documentGenerationService,
    isQuizQuestion,
    isRelatedConcept,
    learningService,
} from '../../services/ai';
import type { ChallengeEvaluation, QuizQuestion, RelatedConcept } from '../../services/ai';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { v4 as uuidv4 } from 'uuid';
import { LessonMermaid } from './LessonMermaid';
import { LessonLab } from './LessonLab';
import { EvaluationResultCard } from './EvaluationResultCard';
import { SafeRichText } from '../../components/ui/SafeRichText';
import { renderMarkdownToSafeHtml } from '../../lib/richText';
import { escapeHtml } from '../../lib/codeHighlight';
import { errorMessageOf } from '../../lib/errorMessage';

interface Props {
    course: Course;
    lesson: Lesson;
    moduleTitle: string;
    onClose: () => void;
    onToggleRead: (id: string) => void;
    onToggleInProgress: (id: string) => void;
    onToggleFavorite: (id: string) => void;
    progress: UserProgress;
    onAddSmartNote: (note: SmartNote) => void;
    getCachedContent: (lessonId: string, tabId: string) => string | undefined;
    cacheContent: (lessonId: string, tabId: string, content: string) => void;
    getOriginalContent: (lessonId: string, tabId: string) => string | undefined;
    restoreOriginalContent: (lessonId: string, tabId: string) => string | undefined;
    studentContext: StudentContext;
    onRecordQuiz: (result: QuizResult) => void;
}

const LAB_TAB = 'Laboratorio (Diagrama)';

/**
 * Lesson sections grouped into intuitive families, each with an icon. Grouping
 * the 19 sections turns a long flat list into a scannable, navigable map and
 * gives the sidebar more visual life.
 */
const TAB_GROUPS: { label: string; tabs: { id: string; icon: LucideIcon }[] }[] = [
    { label: 'Fundamentos', tabs: [
        { id: 'Resumen Ejecutivo', icon: FileTextIcon },
        { id: 'Clase Magistral', icon: GraduationCap },
        { id: 'Analogía Simple (ELI5)', icon: LightbulbIcon },
        { id: 'Glosario', icon: BookMarkedIcon },
    ]},
    { label: 'Visual', tabs: [
        { id: 'Visualización', icon: NetworkIcon },
        { id: 'Mapa Mental', icon: BrainCircuitIcon },
        { id: LAB_TAB, icon: FlaskConicalIcon },
    ]},
    { label: 'Aplicación', tabs: [
        { id: 'Casos Aplicados', icon: BriefcaseIcon },
        { id: 'Artefactos', icon: PackageIcon },
        { id: 'Reto Práctico', icon: TargetIcon },
        { id: 'Plan de Migración', icon: RouteIcon },
    ]},
    { label: 'Estrategia', tabs: [
        { id: 'Pitch a C-Level', icon: PresentationIcon },
        { id: 'Matriz de Trade-offs', icon: ScaleIcon },
        { id: 'Anti-patrones', icon: AlertTriangleIcon },
        { id: 'Análisis de Seguridad (SecOps)', icon: ShieldIcon },
        { id: 'Métricas (KPIs/SLOs)', icon: GaugeIcon },
    ]},
    { label: 'Dominio', tabs: [
        { id: 'Conceptos Relacionados', icon: Link2Icon },
        { id: 'Evaluación (Quizzes)', icon: ClipboardCheckIcon },
        { id: 'Preparación de Entrevistas', icon: MessagesSquareIcon },
    ]},
];

const TABS = TAB_GROUPS.flatMap(g => g.tabs.map(t => t.id));

/**
 * Interactive multiple-choice quiz for the "Evaluación (Quizzes)" tab. The AI
 * now returns structured JSON; this component lets the student answer, scores
 * the attempt, and reveals per-option feedback. Falls back to plain Markdown
 * rendering when the content is not valid quiz JSON (e.g. older cached quizzes
 * generated before this format), so nothing ever breaks.
 */
const LessonQuiz: React.FC<{ content: string; onScored?: (score: number, total: number) => void }> = ({ content, onScored }) => {
    const questions = useMemo<QuizQuestion[] | null>(() => {
        try {
            const parsed = JSON.parse(content);
            if (!Array.isArray(parsed) || parsed.length === 0) return null;
            return parsed.every(isQuizQuestion) ? parsed : null;
        } catch {
            return null;
        }
    }, [content]);

    const [answers, setAnswers] = useState<Record<number, number>>({});
    const [submitted, setSubmitted] = useState(false);

    // Reset interaction state whenever a different quiz loads.
    useEffect(() => {
        setAnswers({});
        setSubmitted(false);
    }, [content]);

    if (!questions) {
        return (
            <div className="prose prose-sm dark:prose-invert max-w-none">
                <SafeRichText markdown={content} />
            </div>
        );
    }

    const answeredCount = Object.keys(answers).length;
    const score = questions.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0);
    const percent = Math.round((score / questions.length) * 100);

    return (
        <div className="space-y-6">
            {questions.map((q, qi) => {
                const selected = answers[qi];
                return (
                    <div key={qi} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                        <p className="font-bold text-gray-900 dark:text-white mb-4">{qi + 1}. {q.question}</p>
                        <div className="space-y-2">
                            {q.options.map((opt, oi) => {
                                const isSelected = selected === oi;
                                const isCorrect = oi === q.correctIndex;
                                let stateClass = 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600';
                                if (submitted) {
                                    if (isCorrect) stateClass = 'border-green-400 bg-green-50 dark:bg-green-900/20 dark:border-green-700';
                                    else if (isSelected) stateClass = 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-700';
                                    else stateClass = 'border-gray-200 dark:border-gray-700 opacity-70';
                                } else if (isSelected) {
                                    stateClass = 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20';
                                }
                                return (
                                    <button
                                        key={oi}
                                        type="button"
                                        disabled={submitted}
                                        onClick={() => setAnswers(prev => ({ ...prev, [qi]: oi }))}
                                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors flex items-center gap-3 ${stateClass} ${submitted ? 'cursor-default' : 'cursor-pointer'}`}
                                    >
                                        <span className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                                            {String.fromCharCode(65 + oi)}
                                        </span>
                                        <span className="text-gray-800 dark:text-gray-200">{opt}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {submitted && q.explanation && (
                            <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-800">
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">Explicación: </span>{q.explanation}
                            </div>
                        )}
                    </div>
                );
            })}

            {!submitted ? (
                <button
                    type="button"
                    onClick={() => { setSubmitted(true); onScored?.(score, questions.length); }}
                    disabled={answeredCount < questions.length}
                    className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                    {answeredCount < questions.length ? `Responde todas (${answeredCount}/${questions.length})` : 'Calificar Quiz'}
                </button>
            ) : (
                <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-5 border border-indigo-100 dark:border-indigo-800">
                    <div>
                        <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">Resultado</p>
                        <p className={`text-2xl font-black ${percent >= 80 ? 'text-green-600' : percent >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                            {score}/{questions.length} <span className="text-base font-bold">({percent}%)</span>
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setAnswers({}); setSubmitted(false); }}
                        className="flex items-center px-4 py-2 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-900 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                    >
                        <RefreshCwIcon className="h-4 w-4 mr-2" /> Reintentar
                    </button>
                </div>
            )}
        </div>
    );
};

export const LessonModal: React.FC<Props> = ({
    course, lesson, moduleTitle, onClose, onToggleRead, onToggleInProgress, onToggleFavorite, progress,
    onAddSmartNote, getCachedContent, cacheContent, getOriginalContent, restoreOriginalContent,
    studentContext, onRecordQuiz
}) => {
    const { settings } = useAppContext();
    const { addToast } = useToast();
    const [lessonStack, setLessonStack] = useState<Lesson[]>([lesson]);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const currentLesson = lessonStack[lessonStack.length - 1];
    const isRead = progress.readLessons.includes(currentLesson.id);
    const isProg = progress.inProgressLessons.includes(currentLesson.id);
    const isFav = progress.favoriteLessons.includes(currentLesson.id);

    const [activeTab, setActiveTab] = useState(TABS[0]);
    const [content, setContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isCached, setIsCached] = useState(false);
    const [showRegenConfirm, setShowRegenConfirm] = useState(false);
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [challengeResponse, setChallengeResponse] = useState('');
    const [evaluation, setEvaluation] = useState<ChallengeEvaluation | null>(null);
    const [chatHistory, setChatHistory] = useState<{role: string, text: string}[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatting, setIsChatting] = useState(false);

    
    const handleChat = async () => {
        if (!chatInput.trim() || isChatting) return;
        const userMsg = chatInput;
        // Snapshot the history BEFORE appending the new message so the tutor
        // receives the prior turns as memory (the inline implementation used to
        // send no history at all, making the tutor stateless).
        const priorHistory = chatHistory;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsChatting(true);

        try {
            const reply = await learningService.chatWithLesson(
                course.title,
                currentLesson.title,
                activeTab,
                userMsg,
                priorHistory,
                settings,
                content,          // ground the tutor in the section currently on screen
                studentContext,   // calibrate depth/examples to the student profile
            );
            setChatHistory(prev => [...prev, { role: 'model', text: reply || 'No recibí respuesta. Intenta reformular tu pregunta.' }]);
        } catch (error) {
            const msg = errorMessageOf(error, 'Error de conexión con el Tutor IA.');
            setChatHistory(prev => [...prev, { role: 'model', text: msg }]);
            addToast('El Tutor IA no pudo responder. Revisa tu conexión o la API Key.', 'error');
        } finally {
            setIsChatting(false);
        }
    };

    // Reset the tutor conversation when the student moves to another lesson so
    // memory from a previous topic never bleeds into a new one.
    useEffect(() => {
        setChatHistory([]);
        setChatInput('');
    }, [currentLesson.id]);

    // Keep the newest tutor message in view.
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory, isChatting]);

    const loadContent = async (tab: string, force = false) => {
        // The practical Lab manages its own AI calls — skip generic generation.
        if (tab === LAB_TAB) {
            setContent('');
            setIsLoading(false);
            setIsCached(false);
            return;
        }
        if (!force) {
            const cached = getCachedContent(currentLesson.id, tab);
            if (cached) {
                setContent(cached);
                setIsCached(true);
                return;
            }
        }

        setIsLoading(true);
        setIsCached(false);
        setContent('');
        setEvaluation(null);
        setChallengeResponse('');

        try {
            const generated = await learningService.generateLessonTabContent(
                course.title, currentLesson.title, tab, course.role, course.level,
                studentContext, settings,
                course.description,
                course.courseContext
            );
            setContent(generated);
            cacheContent(currentLesson.id, tab, generated);
        } catch (error) {
            console.error(error);
            setContent(errorMessageOf(error, 'Error al generar el contenido. Por favor, intenta de nuevo.'));
            addToast('No se pudo generar el contenido de esta sección.', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // `loadContent` is recreated on every render, so the mount effect calls it
    // through a ref: depending on the function itself would regenerate the
    // lesson on every render, and leaving it out would call a stale closure.
    const loadContentRef = useRef(loadContent);
    loadContentRef.current = loadContent;

    useEffect(() => {
        void loadContentRef.current(activeTab);
    }, [activeTab, currentLesson.id]);

    // The original (first) generation for the section currently on screen, plus
    // whether what we're showing has diverged from it (i.e. was regenerated).
    const originalContent = activeTab === LAB_TAB ? undefined : getOriginalContent(currentLesson.id, activeTab);
    const isRegenerated = !!originalContent && !!content && originalContent !== content;

    // Regeneration is now an explicit, confirmed action so the student never
    // loses the first version by accident.
    const handleRegenerate = () => {
        if (isLoading || !content) return;
        setShowRegenConfirm(true);
    };

    const handleConfirmRegenerate = () => {
        setShowRegenConfirm(false);
        loadContent(activeTab, true);
    };

    const handleRestoreOriginal = () => {
        const original = restoreOriginalContent(currentLesson.id, activeTab);
        if (original !== undefined) {
            setContent(original);
            setIsCached(true);
            addToast('Versión original restaurada.', 'success');
        }
    };

    const handleQuizScored = (score: number, total: number) => {
        if (total === 0) return;
        const percent = Math.round((score / total) * 100);
        const passed = percent >= QUIZ_PASS_PERCENT;
        onRecordQuiz({
            lessonId: currentLesson.id,
            courseId: course.id,
            score, total, percent, passed,
            at: Date.now(),
        });
        addToast(
            passed ? `¡Quiz aprobado! ${score}/${total} (${percent}%)` : `Quiz: ${score}/${total} (${percent}%). ¡Sigue practicando!`,
            passed ? 'success' : 'warning',
        );
    };

    const handleCreateSmartNote = async () => {
        if (!content) return;
        setIsSynthesizing(true);
        try {
            const synthesized = await documentGenerationService.synthesizeSmartNote(content, settings);
            const note: SmartNote = {
                id: uuidv4(),
                courseId: course.id,
                lessonId: currentLesson.id,
                tabId: activeTab,
                content: synthesized,
                createdAt: Date.now()
            };
            onAddSmartNote(note);
            addToast('Nota Inteligente guardada en tu Segundo Cerebro.', 'success');
        } catch (error) {
            console.error(error);
            addToast(errorMessageOf(error, 'Error al crear la nota inteligente.'), 'error');
        } finally {
            setIsSynthesizing(false);
        }
    };

    const handleEvaluateChallenge = async () => {
        if (!challengeResponse.trim()) return;
        setIsLoading(true);
        try {
            const evalResult = await learningService.evaluateChallenge(content, challengeResponse, settings);
            setEvaluation(evalResult);
        } catch (error) {
            console.error(error);
            addToast(errorMessageOf(error, 'Error al evaluar el reto.'), 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrintPDF = () => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        
        const printDocument = iframe.contentWindow?.document;
        if (printDocument) {
            // The iframe is same-origin, so anything injected here runs with
            // the app's own origin — a worse sink than a React render, not a
            // lesser one. Lesson bodies and course titles both come from
            // Firestore and from model output, so the body is sanitised and
            // every interpolated title is escaped. The print script below is
            // this file's own literal, not content.
            printDocument.write(`
                <html><head><title>${escapeHtml(currentLesson.title)} - ${escapeHtml(activeTab)}</title>
                <style>body{font-family:sans-serif;line-height:1.6;padding:40px;max-width:800px;margin:0 auto;color:#333;}
                h1{border-bottom:2px solid #2563eb;padding-bottom:10px;}
                pre{background:#f4f4f4;padding:15px;border-radius:5px;overflow-x:auto;}
                </style></head><body>
                <h1>${escapeHtml(course.title)} &gt; ${escapeHtml(currentLesson.title)}</h1>
                <h2>${escapeHtml(activeTab)}</h2>
                ${renderMarkdownToSafeHtml(content)}
                <script>window.onload=function(){setTimeout(function(){window.print();},500);}</script>
                </body></html>
            `);
            printDocument.close();
            
            // Clean up the iframe after printing
            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
            }, 5000);
        }
    };

    const handleExportMD = () => {
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentLesson.title.replace(/\s+/g, '_')}_${activeTab.replace(/\s+/g, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleConceptClick = (concept: RelatedConcept) => {
        const conceptId = `concept_${concept.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
        const newLesson: Lesson = {
            id: conceptId,
            title: concept.title,
            description: concept.description
        };
        setLessonStack(prev => [...prev, newLesson]);
        setActiveTab('Resumen Ejecutivo');
    };

    const handleBack = () => {
        if (lessonStack.length > 1) {
            setLessonStack(prev => prev.slice(0, -1));
            setActiveTab('Conceptos Relacionados');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-50 dark:bg-gray-950 animate-fade-in">
            {/* Header */}
            <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center space-x-4">
                    {lessonStack.length > 1 && (
                        <button onClick={handleBack} className="p-2 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-gray-100 dark:bg-gray-800 rounded-full transition-colors mr-2">
                            <ArrowLeftIcon className="h-5 w-5" />
                        </button>
                    )}
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{course.title} &bull; {moduleTitle}</div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{currentLesson.title}</h2>
                    </div>
                </div>
                <div className="flex items-center space-x-4">
                    
                    <button 
                        onClick={() => onToggleFavorite(currentLesson.id)}
                        className={`p-2 rounded-lg transition-colors ${isFav ? 'bg-amber-100 text-amber-500 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-400 hover:text-amber-500 dark:bg-gray-800 dark:text-gray-500'}`}
                        title="Marcar como Favorita"
                    >
                        <StarIcon className={`h-6 w-6 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                    <button 
                        onClick={() => onToggleInProgress(currentLesson.id)}
                        className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors ${isProg ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                    >
                        <ClockIcon className="h-5 w-5 mr-2" />
                        {isProg ? 'En Progreso' : 'Marcar En Progreso'}
                    </button>
                    <button 
                        onClick={() => onToggleRead(currentLesson.id)}

                        className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors ${isRead ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                    >
                        <CheckCircleIcon className="h-5 w-5 mr-2" />
                        {isRead ? 'Completada' : 'Marcar Completada'}
                    </button>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-full transition-colors">
                        <XIcon className="h-6 w-6" />
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Tabs */}
                <div className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 overflow-y-auto py-4">
                    <div className="px-4 mb-4">
                        <div className="flex items-center gap-2 mb-3">
                            <SparklesIcon className="h-4 w-4 text-indigo-500" />
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Contenido Dinámico IA</h3>
                        </div>
                        {(() => {
                            const generatable = TABS.filter(t => t !== LAB_TAB);
                            const generated = generatable.filter(t => !!getCachedContent(currentLesson.id, t)).length;
                            const pct = Math.round((generated / generatable.length) * 100);
                            return (
                                <div>
                                    <div className="flex justify-between text-[11px] font-medium text-gray-400 mb-1.5">
                                        <span>Secciones generadas</span>
                                        <span className="text-indigo-600 dark:text-indigo-400 font-bold">{generated}/{generatable.length}</span>
                                    </div>
                                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                        <div className="bg-indigo-500 h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                    <nav className="space-y-4 px-2 pb-4">
                        {TAB_GROUPS.map(group => (
                            <div key={group.label}>
                                <div className="px-3 mb-1 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{group.label}</div>
                                <div className="space-y-0.5">
                                    {group.tabs.map(({ id: tab, icon: Icon }) => {
                                        const isActive = activeTab === tab;
                                        const hasContent = tab !== LAB_TAB && !!getCachedContent(currentLesson.id, tab);
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setActiveTab(tab)}
                                                className={`group relative w-full text-left pl-3 pr-2 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2.5 ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'}`}
                                            >
                                                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-indigo-500" />}
                                                <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-indigo-500' : 'text-gray-400 group-hover:text-gray-500 dark:group-hover:text-gray-300'}`} />
                                                <span className="flex-1 truncate">{tab}</span>
                                                {hasContent && <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-green-500" title="Generada y guardada" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto p-8 relative">
                    <div className="max-w-4xl mx-auto">
                        {/* Toolbar */}
                        <div className="flex items-center justify-between mb-8 bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
                            <div className="flex items-center space-x-3">
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">{activeTab}</h3>
                                {isRegenerated ? (
                                    <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1" title="Estás viendo una versión regenerada. La primera versión sigue guardada.">
                                        <HistoryIcon className="h-3 w-3" /> Regenerada
                                    </span>
                                ) : isCached && (
                                    <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Guardada</span>
                                )}
                            </div>
                            <div className="flex items-center space-x-2">
                                {isRegenerated && (
                                    <button onClick={handleRestoreOriginal} disabled={isLoading} className="px-3 py-2 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 text-sm font-medium" title="Volver a la primera versión generada">
                                        <HistoryIcon className="h-4 w-4" /> Restaurar original
                                    </button>
                                )}
                                <button onClick={handleRegenerate} disabled={isLoading || !content} className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 rounded-lg transition-colors disabled:opacity-50" title="Regenerar contenido (la primera versión se conserva)">
                                    <RefreshCwIcon className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                                <button onClick={handleCreateSmartNote} disabled={isLoading || isSynthesizing || !content} className="p-2 text-pink-600 bg-pink-50 hover:bg-pink-100 dark:bg-pink-900/20 dark:hover:bg-pink-900/40 rounded-lg transition-colors flex items-center" title="Crear Nota Inteligente">
                                    {isSynthesizing ? <BrainCircuitIcon className="h-5 w-5 animate-pulse" /> : <BrainCircuitIcon className="h-5 w-5" />}
                                </button>
                                <button onClick={handleExportMD} disabled={isLoading || !content} className="p-2 text-gray-600 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg transition-colors" title="Exportar Markdown">
                                    <DownloadIcon className="h-5 w-5" />
                                </button>
                                <button onClick={handlePrintPDF} disabled={isLoading || !content} className="p-2 text-gray-600 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg transition-colors" title="Imprimir PDF">
                                    <PrinterIcon className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                                <p className="text-gray-500 dark:text-gray-400 font-medium animate-pulse">Generando contenido con IA basado en tu rol y nivel...</p>
                            </div>
                        ) : (
                            <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                                {activeTab === 'Reto Práctico' ? (
                                    <div className="space-y-6">
                                        <div className="prose prose-sm dark:prose-invert max-w-none mb-8">
                                            <SafeRichText markdown={content} />
                                        </div>
                                        <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
                                            <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Tu Propuesta de Solución</h4>
                                            <textarea 
                                                value={challengeResponse}
                                                onChange={e => setChallengeResponse(e.target.value)}
                                                placeholder="Escribe tu arquitectura o código aquí..."
                                                className="w-full h-48 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4 font-mono text-sm"
                                            />
                                            <button 
                                                onClick={handleEvaluateChallenge}
                                                disabled={!challengeResponse.trim()}
                                                className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                            >
                                                Evaluar Solución
                                            </button>
                                        </div>
                                        {evaluation && (
                                            <EvaluationResultCard evaluation={evaluation} />
                                        )}
                                    </div>
                                ) : activeTab === 'Conceptos Relacionados' ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {(() => {
                                            try {
                                                const parsed: unknown = JSON.parse(content);
                                                if (!Array.isArray(parsed)) throw new Error("Not an array");
                                                const concepts = parsed.filter(isRelatedConcept);
                                                if (concepts.length === 0) throw new Error("No concepts");
                                                return concepts.map((concept, idx) => (
                                                    <div key={idx} onClick={() => handleConceptClick(concept)} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer group">
                                                        <h4 className="font-bold text-gray-900 dark:text-white mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{concept.title}</h4>
                                                        <p className="text-sm text-gray-600 dark:text-gray-400">{concept.description}</p>
                                                    </div>
                                                ));
                                            } catch {
                                                return (
                                                    <div className="col-span-full prose prose-sm dark:prose-invert max-w-none">
                                                        <SafeRichText markdown={content} />
                                                    </div>
                                                );
                                            }
                                        })()}
                                    </div>
                                ) : activeTab === 'Visualización' ? (
                                    <LessonMermaid content={content} />
                                ) : activeTab === 'Evaluación (Quizzes)' ? (
                                    <LessonQuiz content={content} onScored={handleQuizScored} />
                                ) : activeTab === LAB_TAB ? (
                                    <LessonLab courseTitle={course.title} lessonTitle={currentLesson.title} role={course.role} level={course.level} />
                                ) : (
                                    <div className="prose prose-sm dark:prose-invert max-w-none">
                                        <SafeRichText markdown={content} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Tutor IA Sidebar */}
                <div className="w-80 bg-gray-50 dark:bg-gray-900/50 border-l border-gray-200 dark:border-gray-800 flex flex-col">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center">
                        <MessageSquareIcon className="h-5 w-5 text-indigo-500 mr-2" />
                        <h3 className="font-bold text-gray-900 dark:text-white">Tutor IA</h3>
                    </div>
                    
                    <div className="flex-1 p-4 overflow-y-auto space-y-4">
                        <div className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 p-3 rounded-lg text-sm">
                            ¡Hola! Soy tu tutor IA. Estoy consciente de que estamos viendo <strong>{activeTab}</strong> sobre <strong>{currentLesson.title}</strong>. ¿Tienes alguna duda?
                        </div>
                        {chatHistory.map((msg, idx) => (
                            <div key={idx} className={`p-3 rounded-lg text-sm ${msg.role === 'user' ? 'bg-gray-100 dark:bg-gray-800 ml-8 text-gray-900 dark:text-white' : 'bg-indigo-50 dark:bg-indigo-900/20 mr-8 text-indigo-900 dark:text-indigo-100'}`}>
                                <SafeRichText markdown={msg.text} />
                            </div>
                        ))}
                        {isChatting && <div className="text-xs text-indigo-500 animate-pulse">Escribiendo...</div>}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex gap-2">
                        <input 
                            type="text" 
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleChat()}
                            placeholder="Pregunta algo..." 
                            className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" 
                        />
                        <button onClick={handleChat} disabled={!chatInput.trim() || isChatting} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                            <MessageSquareIcon className="h-4 w-4" />
                        </button>
                    </div>

                </div>
            </div>

            {/* Regenerate confirmation — guarantees the first version is never lost by accident */}
            {showRegenConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4" onClick={() => setShowRegenConfirm(false)}>
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <RefreshCwIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Regenerar esta sección</h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    Se generará un texto nuevo para <strong>{activeTab}</strong>. Tu <strong>primera versión se conservará</strong> y podrás restaurarla cuando quieras.
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setShowRegenConfirm(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                                Cancelar
                            </button>
                            <button onClick={handleConfirmRegenerate} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center gap-2">
                                <RefreshCwIcon className="h-4 w-4" /> Generar nueva versión
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
