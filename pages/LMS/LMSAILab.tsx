
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Course } from '../../types/lms';
import { SparklesIcon, BeakerIcon, CpuIcon, AlertTriangleIcon, KeyIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import { asCourseCategory, asCourseLevel, learningService } from '../../services/ai';
import { useAppContext } from '../../context/AppContext';
import { v4 as uuidv4 } from 'uuid';

interface Props {
    onCourseGenerated: (course: Course) => void;
}

type GenerationPhase = 'idle' | 'validating' | 'generating' | 'building' | 'done';

export const LMSAILab: React.FC<Props> = ({ onCourseGenerated }) => {
    const { settings } = useAppContext();
    const [topic, setTopic] = useState('');
    const [courseContext, setCourseContext] = useState('');
    const [phase, setPhase] = useState<GenerationPhase>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [validationHint, setValidationHint] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // Focus the input on mount for immediate UX
    useEffect(() => {
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 300);
        return () => clearTimeout(timer);
    }, []);

    const isGenerating = phase !== 'idle' && phase !== 'done';

    const checkApiKeyAvailability = useCallback((): boolean => {
        try {
            const apiKeySource = settings?.aiConfig?.apiKeySource || 'global';
            const userKey = typeof localStorage !== 'undefined' ? localStorage.getItem('user_gemini_key') : null;
            const globalKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY || '').toString().trim();

            if (apiKeySource === 'user') {
                return !!(userKey && userKey.trim().length > 0) || !!(globalKey.length > 0);
            }
            return !!(globalKey.length > 0) || !!(userKey && userKey.trim().length > 0);
        } catch {
            return false;
        }
    }, [settings?.aiConfig?.apiKeySource]);

    const handleGenerate = useCallback(async (topicOverride?: string) => {
        const topicToUse = (topicOverride ?? topic).trim();

        // Validate topic
        if (!topicToUse) {
            setValidationHint('Escribe un tema para generar el curso. Ej: "Arquitectura de Microservicios con Kafka"');
            inputRef.current?.focus();
            return;
        }

        setValidationHint(null);
        setErrorMessage(null);

        // Pre-validate API key
        if (!checkApiKeyAvailability()) {
            setErrorMessage('No se encontró una API Key de Gemini configurada. Ve a Ajustes > Configuración IA para configurarla, o ingresa tu llave personal en la sección correspondiente.');
            return;
        }

        setPhase('validating');

        try {
            // Phase 1: Generating syllabus via AI
            if (isMountedRef.current) setPhase('generating');

            const data = await learningService.generateCourseSyllabus(topicToUse, courseContext.trim() || undefined, settings);

            if (!isMountedRef.current) return;

            // Validate the AI response has actual content
            if (!data || (!data.title && !data.modules)) {
                throw new Error('La IA devolvió una respuesta vacía. Intenta reformular el tema o verifica tu conexión.');
            }

            // Phase 2: Building course object
            setPhase('building');

            const modules = (data.modules ?? []).map((m) => ({
                id: m.id || uuidv4(),
                title: m.title ?? '',
                level: asCourseLevel(m.level),
                lessons: (m.lessons ?? []).map((l) => ({
                    id: l.id || uuidv4(),
                    title: l.title ?? '',
                    description: l.description ?? ''
                }))
            }));

            if (modules.length === 0) {
                throw new Error('La IA generó un curso sin módulos. Intenta con un tema más específico, por ejemplo: "Patrones de Diseño para APIs REST en el sector Salud".');
            }

            const newCourse: Course = {
                id: uuidv4(),
                title: data.title || topicToUse,
                description: data.description || 'Curso generado por IA',
                icon: 'cpu',
                category: asCourseCategory(data.category),
                level: 'Intermedio',
                role: 'Arquitecto de Soluciones',
                modules,
                courseContext: courseContext.trim() || undefined,
                isAIGenerated: true
            };

            // Deliver the course — wrap in try-catch to isolate callback errors
            try {
                onCourseGenerated(newCourse);
            } catch (callbackError) {
                console.error("Error in onCourseGenerated callback:", callbackError);
                // Course was generated successfully but the callback failed
                // Still show success since the data was created
            }

            if (isMountedRef.current) {
                setPhase('done');
                setTopic('');
                setCourseContext('');
                // Reset phase after brief success indication
                setTimeout(() => {
                    if (isMountedRef.current) setPhase('idle');
                }, 1500);
            }
        } catch (error: unknown) {
            console.error("Error generating course:", error);
            if (isMountedRef.current) {
                const errMsg = error instanceof Error ? error.message : String(error);
                if (errMsg.includes('API Key') || errMsg.includes('API key') || errMsg.includes('apiKey')) {
                    setErrorMessage('API Key no válida o no configurada. Ve a Ajustes > Configuración IA para verificar tu llave.');
                } else if (errMsg.includes('fetch failed') || errMsg.includes('network') || errMsg.includes('Network')) {
                    setErrorMessage('Error de conexión. Verifica tu acceso a internet e intenta de nuevo.');
                } else if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate')) {
                    setErrorMessage('Se alcanzó el límite de peticiones de la API. Espera unos segundos e intenta de nuevo.');
                } else if (errMsg.includes('503') || errMsg.includes('unavailable')) {
                    setErrorMessage('El servicio de IA está temporalmente no disponible. Intenta de nuevo en unos momentos.');
                } else {
                    setErrorMessage(errMsg || 'Error al generar el curso. Revisa tu conexión y la configuración de la API Key en Ajustes.');
                }
                setPhase('idle');
            }
        }
    }, [topic, courseContext, settings, onCourseGenerated, checkApiKeyAvailability]);

    const handleSurpriseMe = useCallback(() => {
        const topics = [
            "Tecnología emergente en Arquitectura de Software 2026",
            "Event-Driven Architecture para sistemas de salud",
            "Domain-Driven Design aplicado a seguros de vida",
            "Arquitectura de APIs para ecosistemas de salud digital",
            "Observabilidad y Monitoreo en Microservicios",
            "Patrones de Integración Empresarial para aseguradoras",
            "Arquitectura Cloud-Native para el sector salud"
        ];
        const surpriseTopic = topics[Math.floor(Math.random() * topics.length)];
        setTopic(surpriseTopic);
        handleGenerate(surpriseTopic);
    }, [handleGenerate]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !isGenerating) {
            e.preventDefault();
            handleGenerate();
        }
    }, [isGenerating, handleGenerate]);

    const handleTopicChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setTopic(e.target.value);
        if (validationHint) setValidationHint(null);
        if (errorMessage) setErrorMessage(null);
    }, [validationHint, errorMessage]);

    const phaseLabel: Record<GenerationPhase, string> = {
        idle: 'Generar Curso',
        validating: 'Validando...',
        generating: 'Generando Sílabo con IA...',
        building: 'Construyendo curso...',
        done: 'Curso creado'
    };

    const hasApiKey = checkApiKeyAvailability();

    return (
        <div className="max-w-4xl mx-auto animate-fade-in space-y-8">
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center space-x-4 mb-6">
                    <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center shadow-inner">
                        <BeakerIcon className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Laboratorio IA</h2>
                        <p className="text-gray-500 dark:text-gray-400">Genera un curso completo y personalizado sobre cualquier tema arquitectónico en segundos.</p>
                    </div>
                </div>

                {/* API Key Warning */}
                {!hasApiKey && (
                    <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
                        <KeyIcon className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">API Key no configurada</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Para generar cursos con IA necesitas configurar tu API Key de Gemini en Ajustes &gt; Configuración IA.</p>
                        </div>
                    </div>
                )}

                <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 -mt-10 -mr-10 opacity-10 pointer-events-none">
                        <CpuIcon className="h-64 w-64" />
                    </div>
                    <div className="relative z-10 space-y-6">
                        <div>
                            <label className="block text-sm font-bold text-indigo-200 mb-3 uppercase tracking-wider">¿Qué quieres aprender hoy?</label>
                            <input
                                ref={inputRef}
                                type="text"
                                value={topic}
                                onChange={handleTopicChange}
                                onKeyDown={handleKeyDown}
                                disabled={isGenerating}
                                placeholder="Ej. Arquitectura Orientada a Eventos con Kafka..."
                                className={`w-full px-5 py-4 bg-white/10 border rounded-xl text-white placeholder-indigo-300/70 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:bg-white/20 transition-all text-lg shadow-inner disabled:opacity-60 ${validationHint ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-white/20'}`}
                            />
                            {validationHint && (
                                <p className="mt-2 text-sm text-yellow-300 flex items-center gap-1.5">
                                    <AlertTriangleIcon className="h-4 w-4 flex-shrink-0" />
                                    {validationHint}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-indigo-200 mb-2 uppercase tracking-wider">Contexto del Curso <span className="font-normal normal-case text-indigo-300/70">(opcional)</span></label>
                            <textarea
                                value={courseContext}
                                onChange={e => setCourseContext(e.target.value)}
                                disabled={isGenerating}
                                placeholder="Ej: Este curso asume una plataforma core basada en COBOL. El equipo conoce Java y está evaluando migrar a arquitectura de microservicios. Enfócate en integración con sistemas hospitalarios..."
                                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-indigo-300/60 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:bg-white/20 transition-all resize-none h-24 text-sm disabled:opacity-60"
                            />
                        </div>
                        <div className="flex flex-col sm:flex-row gap-4 pt-2">
                            <button
                                onClick={() => handleGenerate()}
                                disabled={isGenerating}
                                className={`flex-1 font-bold py-4 px-6 rounded-xl transition-all shadow-lg flex items-center justify-center group ${
                                    phase === 'done'
                                        ? 'bg-green-400 text-green-900 shadow-green-400/30'
                                        : isGenerating
                                            ? 'bg-yellow-400/70 text-indigo-900 cursor-wait'
                                            : topic.trim()
                                                ? 'bg-yellow-400 text-indigo-900 hover:bg-yellow-300 hover:shadow-xl'
                                                : 'bg-yellow-400/80 text-indigo-900 hover:bg-yellow-300 hover:shadow-xl'
                                }`}
                            >
                                {phase === 'done' ? (
                                    <span className="flex items-center">
                                        <CheckCircle2Icon className="h-5 w-5 mr-2" /> Curso creado
                                    </span>
                                ) : isGenerating ? (
                                    <span className="flex items-center">
                                        <Loader2Icon className="h-5 w-5 mr-2 animate-spin" /> {phaseLabel[phase]}
                                    </span>
                                ) : (
                                    <span className="flex items-center">
                                        <SparklesIcon className="h-5 w-5 mr-2 group-hover:rotate-12 transition-transform" /> Generar Curso
                                    </span>
                                )}
                            </button>
                            <button
                                onClick={handleSurpriseMe}
                                disabled={isGenerating}
                                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-4 px-6 rounded-xl border border-white/20 transition-all flex items-center justify-center backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <SparklesIcon className="h-5 w-5 mr-2" /> Sorpréndeme
                            </button>
                        </div>

                        {/* Progress indicator during generation */}
                        {isGenerating && (
                            <div className="mt-2 p-3 bg-white/10 rounded-xl border border-white/10">
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1">
                                        <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${phase === 'validating' || phase === 'generating' || phase === 'building' ? 'bg-yellow-400' : 'bg-white/30'}`} />
                                        <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${phase === 'generating' || phase === 'building' ? 'bg-yellow-400' : 'bg-white/30'}`} />
                                        <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${phase === 'building' ? 'bg-yellow-400' : 'bg-white/30'}`} />
                                    </div>
                                    <p className="text-sm text-indigo-200">
                                        {phase === 'validating' && 'Validando configuración...'}
                                        {phase === 'generating' && `Generando sílabo sobre "${topic.trim() || 'tema seleccionado'}"...`}
                                        {phase === 'building' && 'Construyendo estructura del curso...'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {errorMessage && (
                            <div className="mt-2 p-4 bg-red-500/20 border border-red-400/40 rounded-xl text-red-200 text-sm flex items-start gap-3">
                                <AlertTriangleIcon className="h-5 w-5 text-red-300 mt-0.5 flex-shrink-0" />
                                <div>
                                    <strong className="block mb-1">Error al generar el curso</strong>
                                    {errorMessage}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
