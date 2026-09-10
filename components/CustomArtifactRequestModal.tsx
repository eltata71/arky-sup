import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Project, ArtifactTemplate, CustomArtifactRecommendation, ArtifactGenerationPhaseEvent, ArtifactGenerationPhaseListener, ArtifactGenerationStage } from '../types';
import { recommendationService, classifyAIError, AIServiceError } from '../services/ai';
import { buildDeterministicArtifactBrief } from '../services/artifacts/artifactBriefService';
import { extractArtifactBriefWithAI } from '../services/artifacts/artifactBriefExtractionService';
import { getArtifactGenerationFeatureFlags } from '../services/artifacts/artifactGenerationFlags';
import { buildArtifactRecommendationCandidates, candidateToLegacyRecommendation, type ArtifactRecommendationCandidate } from '../services/artifacts/artifactRecommendationService';
import { selectArtifactGenerationContext } from '../services/artifacts/artifactContextSelectionService';
import type { ArtifactGenerationContract } from '../services/artifacts/artifactGenerationContract';
import { CustomArtifactBriefWizard, type ArtifactBriefSource } from './CustomArtifactBriefWizard';
import { ArrowUturnLeftIcon, SparklesIcon, LightBulbIcon, CheckCircleIcon, Square2StackIcon } from './Icons';
import { CollapsibleSection, WizardStepProgress, type WizardStepNumber } from './artifacts/wizard';

interface CustomArtifactRequestModalProps {
  isOpen: boolean;
  project: Project;
  onClose: () => void;
  onGenerate: (template: ArtifactTemplate, onPhase?: ArtifactGenerationPhaseListener) => Promise<boolean>;
}

const MIN_IDEA_LENGTH = 20;
const MAX_PHASE_HISTORY = 30;
const GENERATION_STALL_WARNING_MS = 45000;
const GENERATION_LONG_RUNNING_MS = 120000;

const STAGE_LABELS: Record<ArtifactGenerationStage, string> = {
  recommendation: 'Recomendación',
  prompt: 'Prompt',
  'ai-generation': 'Generación IA',
  validation: 'Validación',
  parsing: 'Parsing',
  normalization: 'Normalización',
  'quality-gate': 'Quality gate',
  fallback: 'Fallback',
  persistence: 'Persistencia',
  render: 'Render',
  export: 'Exportación',
  refinement: 'Refinamiento',
};

const STATUS_STYLE: Record<string, { dot: string; chip: string; ring: string }> = {
  'in-progress': {
    dot: 'bg-blue-500 animate-pulse',
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    ring: 'ring-blue-300/60 dark:ring-blue-800/60',
  },
  success: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    ring: 'ring-emerald-300/60 dark:ring-emerald-800/60',
  },
  warning: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    ring: 'ring-amber-300/60 dark:ring-amber-800/60',
  },
  error: {
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    ring: 'ring-rose-300/60 dark:ring-rose-800/60',
  },
  skipped: {
    dot: 'bg-gray-300 dark:bg-gray-600',
    chip: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
    ring: 'ring-gray-300/60 dark:ring-gray-700/60',
  },
};

const formatDuration = (ms?: number): string | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

const stageStyle = (status: string) => STATUS_STYLE[status] ?? STATUS_STYLE.success;

const TOP_LEVEL_STEPS = [
  { number: 1 as WizardStepNumber, label: 'Idea' },
  { number: 2 as WizardStepNumber, label: 'Brief' },
  { number: 3 as WizardStepNumber, label: 'Fuentes' },
  { number: 4 as WizardStepNumber, label: 'Recomendaciones' },
  { number: 5 as WizardStepNumber, label: 'Confirmación' },
];

export const CustomArtifactRequestModal: React.FC<CustomArtifactRequestModalProps> = ({
  isOpen,
  project,
  onClose,
  onGenerate,
}) => {
  const { settings } = useAppContext();
  const { addToast } = useToast();
  const [idea, setIdea] = useState('');
  const [recommendation, setRecommendation] = useState<CustomArtifactRecommendation | null>(null);
  const [generationContract, setGenerationContract] = useState<ArtifactGenerationContract | null>(null);
  const [briefSource, setBriefSource] = useState<ArtifactBriefSource>('deterministic');
  const [briefWarnings, setBriefWarnings] = useState<string[]>([]);
  const [briefAcceptedAiFields, setBriefAcceptedAiFields] = useState<string[]>([]);
  const [briefRejectedAiFields, setBriefRejectedAiFields] = useState<string[]>([]);
  const [recommendationCandidates, setRecommendationCandidates] = useState<ArtifactRecommendationCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | undefined>(undefined);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationPhase, setGenerationPhase] = useState<string | null>(null);
  const [phaseEvents, setPhaseEvents] = useState<ArtifactGenerationPhaseEvent[]>([]);
  const [showTechnical, setShowTechnical] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const lastPhaseAtRef = useRef<number | null>(null);
  const stallWarningShownRef = useRef(false);
  const longRunningWarningShownRef = useRef(false);
  const ideaInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIdea('');
      setRecommendation(null);
      setGenerationContract(null);
      setBriefSource('deterministic');
      setBriefWarnings([]);
      setBriefAcceptedAiFields([]);
      setBriefRejectedAiFields([]);
      setRecommendationCandidates([]);
      setSelectedCandidateId(undefined);
      setIsAnalyzing(false);
      setIsGenerating(false);
      setGenerationError(null);
      setGenerationPhase(null);
      setPhaseEvents([]);
      setShowTechnical(false);
      setReportCopied(false);
      startedAtRef.current = null;
      lastPhaseAtRef.current = null;
      stallWarningShownRef.current = false;
      longRunningWarningShownRef.current = false;
    }
  }, [isOpen]);

  // Focus the idea textarea when the wizard opens — supports keyboard-first flow.
  useEffect(() => {
    if (!isOpen || generationContract) return;
    const handle = window.setTimeout(() => ideaInputRef.current?.focus(), 80);
    return () => window.clearTimeout(handle);
  }, [isOpen, generationContract]);

  const handlePhase: ArtifactGenerationPhaseListener = (event) => {
    lastPhaseAtRef.current = Date.now();
    stallWarningShownRef.current = false;
    setPhaseEvents(prev => {
      const next = [...prev, event];
      return next.length > MAX_PHASE_HISTORY ? next.slice(next.length - MAX_PHASE_HISTORY) : next;
    });
    setGenerationPhase(event.message);
  };

  useEffect(() => {
    if (!isAnalyzing && !isGenerating) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const startedAt = startedAtRef.current ?? now;
      const lastPhaseAt = lastPhaseAtRef.current ?? startedAt;
      const silentForMs = now - lastPhaseAt;
      const totalMs = now - startedAt;

      if (silentForMs >= GENERATION_STALL_WARNING_MS && !stallWarningShownRef.current) {
        stallWarningShownRef.current = true;
        const seconds = Math.round(silentForMs / 1000);
        setGenerationPhase(`La operación sigue activa, pero no ha emitido nuevos eventos en ${seconds}s. Mantén esta ventana abierta; si falla, se mostrará diagnóstico técnico y opción de reintento.`);
        setPhaseEvents(prev => {
          const next: ArtifactGenerationPhaseEvent[] = [...prev, {
            stage: isGenerating ? 'ai-generation' : 'recommendation',
            status: 'warning',
            message: 'Sin nuevos eventos recientes; la operación continúa bajo observación.',
            detail: `Silencio operativo de ${seconds}s. Esto suele ocurrir con latencia de Gemini, red móvil/Safari o fallback de modelo.`,
            at: new Date().toISOString(),
            meta: { silentForMs, totalMs },
          }];
          return next.length > MAX_PHASE_HISTORY ? next.slice(next.length - MAX_PHASE_HISTORY) : next;
        });
      }

      if (totalMs >= GENERATION_LONG_RUNNING_MS && !longRunningWarningShownRef.current) {
        longRunningWarningShownRef.current = true;
        const seconds = Math.round(totalMs / 1000);
        setPhaseEvents(prev => {
          const next: ArtifactGenerationPhaseEvent[] = [...prev, {
            stage: isGenerating ? 'ai-generation' : 'recommendation',
            status: 'warning',
            message: 'Operación de larga duración detectada.',
            detail: `Tiempo acumulado ${seconds}s. Si el proveedor no responde, el servicio debe cerrar por timeout y dejar trazabilidad visible.`,
            at: new Date().toISOString(),
            meta: { totalMs },
          }];
          return next.length > MAX_PHASE_HISTORY ? next.slice(next.length - MAX_PHASE_HISTORY) : next;
        });
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [isAnalyzing, isGenerating]);

  const featureFlags = useMemo(() => getArtifactGenerationFeatureFlags(), []);
  const structuredBriefEnabled = featureFlags.structuredBrief;

  const totalDuration = useMemo(() => {
    if (!startedAtRef.current) return null;
    if (phaseEvents.length === 0) return null;
    const last = phaseEvents[phaseEvents.length - 1];
    return new Date(last.at).getTime() - startedAtRef.current;
  }, [phaseEvents]);

  // Derived current top-level step for the progress indicator at the top of
  // the modal — provides a stable orientation cue across analysis/generation.
  const currentTopStep: WizardStepNumber = generationContract ? 2 : 1;

  const technicalReport = useMemo(() => {
    const lines: string[] = [
      `# Reporte técnico — Artefacto a solicitud`,
      `reportGeneratedAt=${new Date().toISOString()}`,
      `projectId=${project.id}`,
      `projectName=${project.name}`,
      `ideaLength=${idea.trim().length}`,
      `idea=${idea.trim().slice(0, 1200)}`,
      `currentModel=${settings.aiConfig?.model ?? 'default'}`,
      `aiKeySource=${settings.aiConfig?.apiKeySource ?? 'global'}`,
      ...(() => {
        const modelEvent = phaseEvents.find(e => e.meta && (e.meta as Record<string, unknown>).modelSource);
        if (!modelEvent || !modelEvent.meta) return [];
        const meta = modelEvent.meta as Record<string, unknown>;
        return [
          `effectiveModel=${meta.model ?? 'unknown'}`,
          `effectiveModelSource=${meta.modelSource ?? 'unknown'}`,
          `effectiveModelTier=${meta.tier ?? 'unknown'}`,
        ];
      })(),
      `isAnalyzing=${isAnalyzing}`,
      `isGenerating=${isGenerating}`,
      `phaseEventCount=${phaseEvents.length}`,
    ];
    if (generationContract) {
      lines.push(`contract.id=${generationContract.id}`);
      lines.push(`contract=${JSON.stringify(generationContract, null, 2)}`);
      lines.push(`contract.requiredSourceArtifactIds=${generationContract.requiredSourceArtifactIds.join(',')}`);
      lines.push(`contract.optionalSourceArtifactIds=${generationContract.optionalSourceArtifactIds.join(',')}`);
      lines.push(`contract.excludedSourceArtifactIds=${generationContract.excludedSourceArtifactIds.join(',')}`);
      lines.push(`contract.acceptanceCriteria=${generationContract.acceptanceCriteria.join(' | ')}`);
      lines.push(`contract.exportTargets=${generationContract.exportTargets.join(',')}`);
      lines.push(`contract.audience=${generationContract.audience}`);
      lines.push(`contract.purpose=${generationContract.purpose}`);
      lines.push(`contract.detailLevel=${generationContract.detailLevel}`);
      lines.push(`contract.artifactFamily=${generationContract.artifactFamily}`);
      lines.push(`contract.qualityTarget=${generationContract.qualityTarget}`);
      lines.push(`brief.source=${briefSource}`);
      lines.push(`brief.acceptedAiFields=${briefAcceptedAiFields.join(',') || 'none'}`);
      lines.push(`brief.rejectedAiFields=${briefRejectedAiFields.join(',') || 'none'}`);
      lines.push(`brief.warnings=${briefWarnings.join(' | ') || 'none'}`);
      const selection = selectArtifactGenerationContext(project, generationContract);
      lines.push(`context.requiredSources=${selection.requiredSources.map(source => source.id).join(',') || 'none'}`);
      lines.push(`context.optionalSources=${selection.optionalSources.map(source => source.id).join(',') || 'none'}`);
      lines.push(`context.excludedSources=${selection.excludedSources.map(source => source.id).join(',') || 'none'}`);
      lines.push(`context.resolvedSourceMappings=${JSON.stringify(selection.resolvedSourceMappings)}`);
    }
    if (recommendation) {
      lines.push(`recommendation.template.name=${recommendation.template.name}`);
      lines.push(`recommendation.template.type=${recommendation.template.type}`);
      lines.push(`recommendation.template.representation=${recommendation.template.representation}`);
      lines.push(`recommendation.template.phase=${recommendation.template.phase}`);
      lines.push(`recommendation.audience=${recommendation.audience}`);
      lines.push(`recommendation.confidence=${recommendation.confidence}`);
      if (recommendation.candidateId) lines.push(`recommendation.candidateId=${recommendation.candidateId}`);
      if (recommendation.scoreBreakdown) lines.push(`recommendation.scoreBreakdown=${JSON.stringify(recommendation.scoreBreakdown)}`);
      if (recommendation.risks) lines.push(`recommendation.risks=${recommendation.risks.join(' | ')}`);
      if (recommendation.expectedOutput) lines.push(`recommendation.expectedOutput=${recommendation.expectedOutput}`);
      if (recommendation.matchedCatalogTemplateName) {
        lines.push(`recommendation.matchedCatalogTemplateName=${recommendation.matchedCatalogTemplateName}`);
      }
    }
    if (recommendationCandidates.length > 0) {
      lines.push(`recommendation.candidates=${JSON.stringify(recommendationCandidates.map(candidate => ({ id: candidate.id, name: candidate.template.name, confidence: candidate.confidence, scoreBreakdown: candidate.scoreBreakdown, risks: candidate.risks })), null, 2)}`);
    }
    if (generationError) lines.push(`generationError=${generationError}`);
    if (totalDuration !== null) lines.push(`totalDurationMs=${totalDuration}`);
    phaseEvents.forEach((event, index) => {
      lines.push(`event[${index}].at=${event.at}`);
      lines.push(`event[${index}].stage=${event.stage}`);
      lines.push(`event[${index}].status=${event.status}`);
      lines.push(`event[${index}].message=${event.message}`);
      if (event.detail) lines.push(`event[${index}].detail=${event.detail}`);
      if (typeof event.durationMs === 'number') lines.push(`event[${index}].durationMs=${event.durationMs}`);
      if (event.meta && Object.keys(event.meta).length > 0) {
        lines.push(`event[${index}].meta=${JSON.stringify(event.meta).slice(0, 800)}`);
      }
    });
    return lines.join('\n');
  }, [project, idea, settings.aiConfig, isAnalyzing, isGenerating, phaseEvents, recommendation, recommendationCandidates, generationContract, briefSource, briefAcceptedAiFields, briefRejectedAiFields, briefWarnings, generationError, totalDuration]);

  const handleCopyReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(technicalReport);
      setReportCopied(true);
      window.setTimeout(() => setReportCopied(false), 2200);
    } catch (err) {
      console.error('[CustomArtifactRequestModal] failed to copy technical report', err);
      addToast('No se pudo copiar el reporte. Selecciona el texto técnico manualmente desde la línea de tiempo.', 'warning');
    }
  }, [technicalReport, addToast]);

  const canAnalyze = idea.trim().length >= MIN_IDEA_LENGTH && !isAnalyzing && !isGenerating;
  const ideaCharsLeft = Math.max(0, MIN_IDEA_LENGTH - idea.trim().length);

  const handleAnalyze = async () => {
    if (!canAnalyze) return;
    setIsAnalyzing(true);
    setRecommendation(null);
    setRecommendationCandidates([]);
    setSelectedCandidateId(undefined);
    setGenerationError(null);
    setPhaseEvents([]);
    startedAtRef.current = Date.now();
    lastPhaseAtRef.current = startedAtRef.current;
    stallWarningShownRef.current = false;
    longRunningWarningShownRef.current = false;
    setGenerationPhase(structuredBriefEnabled ? 'Extrayendo brief estructurado editable...' : 'Analizando intención y buscando el mejor artefacto del catálogo...');
    try {
      if (structuredBriefEnabled) {
        const deterministic = buildDeterministicArtifactBrief(project, idea, { language: settings.language });
        const extraction = await extractArtifactBriefWithAI({
          project,
          request: idea,
          deterministicContract: deterministic,
          settings,
          onPhase: handlePhase,
          aiEnabled: featureFlags.aiBriefExtraction,
        });
        setGenerationContract(extraction.contract);
        setBriefSource(extraction.source);
        setBriefWarnings(extraction.warnings);
        setBriefAcceptedAiFields(extraction.acceptedAiFields);
        setBriefRejectedAiFields(extraction.rejectedAiFields);
        setGenerationPhase(extraction.source === 'ai-assisted'
          ? 'Brief estructurado asistido por IA listo. Revísalo, ajusta fuentes y construye recomendaciones.'
          : 'Brief estructurado listo. Revísalo, ajusta fuentes y construye recomendaciones.');
      } else {
        const result = await recommendationService.recommendCustomArtifactTemplate(project, idea, settings, { onPhase: handlePhase });
        setRecommendation(result);
        setGenerationPhase('Recomendación lista. Revisa el plan y confirma la generación.');
      }
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      const message = `No se pudo analizar la solicitud. ${friendly.userMessage}`;
      setGenerationError(message);
      setGenerationPhase('Análisis interrumpido. Puedes ajustar la solicitud y reintentar.');
      addToast(message, 'warning');
    } finally {
      setIsAnalyzing(false);
      setIsGenerating(false);
    }
  };

  const handleContractChange = useCallback((contract: ArtifactGenerationContract, reason = 'brief.edited') => {
    setGenerationContract(contract);
    handlePhase({
      stage: reason === 'context.sources-selected' ? 'prompt' : 'recommendation',
      status: 'success',
      message: reason,
      detail: reason === 'context.sources-selected' ? 'Se actualizó la selección controlada de fuentes/contexto.' : 'El brief estructurado fue editado por el usuario.',
      at: new Date().toISOString(),
      meta: {
        contractId: contract.id,
        requiredSources: contract.requiredSourceArtifactIds.length,
        optionalSources: contract.optionalSourceArtifactIds.length,
        excludedSources: contract.excludedSourceArtifactIds.length,
      },
    });
  }, []);

  const handleBuildStructuredRecommendations = useCallback(() => {
    if (!generationContract) return;
    setIsAnalyzing(true);
    setGenerationError(null);
    try {
      const selection = selectArtifactGenerationContext(project, generationContract);
      const conflicted = selection.resolvedSourceMappings.filter(mapping => mapping.resolution === 'excluded-conflict' || mapping.resolution === 'missing');
      handlePhase({
        stage: 'recommendation',
        status: conflicted.length > 0 ? 'warning' : 'success',
        message: 'context.sources-resolved',
        detail: `Fuentes obligatorias ${selection.requiredSources.length} · opcionales ${selection.optionalSources.length} · excluidas ${selection.excludedSources.length}.`,
        at: new Date().toISOString(),
        meta: {
          requiredSources: selection.requiredSources.length,
          optionalSources: selection.optionalSources.length,
          excludedSources: selection.excludedSources.length,
          versionMappings: selection.resolvedSourceMappings.filter(mapping => mapping.resolution === 'latest-version').length,
          unresolvedSources: conflicted.length,
        },
      });
      const candidates = buildArtifactRecommendationCandidates(
        project,
        generationContract,
        featureFlags.top3Recommendations ? 3 : 1,
      );
      setRecommendationCandidates(candidates);
      const selected = candidates[0];
      if (selected) {
        setSelectedCandidateId(selected.id);
        setRecommendation({
          ...candidateToLegacyRecommendation(selected),
          candidateId: selected.id,
          scoreBreakdown: selected.scoreBreakdown,
          risks: selected.risks,
          expectedOutput: selected.expectedOutput,
        });
      }
      handlePhase({
        stage: 'recommendation',
        status: 'success',
        message: 'recommendation.top3-built',
        detail: `${candidates.length} candidato(s) ordenados por score determinístico y contrato estructurado.`,
        at: new Date().toISOString(),
        meta: { candidateCount: candidates.length, top3Enabled: featureFlags.top3Recommendations },
      });
      setGenerationPhase('Recomendaciones listas. Selecciona un candidato y confirma la generación.');
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      const message = `No se pudieron construir recomendaciones. ${friendly.userMessage}`;
      setGenerationError(message);
      addToast(message, 'warning');
    } finally {
      setIsAnalyzing(false);
    }
  }, [addToast, featureFlags.top3Recommendations, generationContract, project]);

  const handleSelectCandidate = useCallback((candidate: ArtifactRecommendationCandidate) => {
    setSelectedCandidateId(candidate.id);
    setRecommendation({
      ...candidateToLegacyRecommendation(candidate),
      candidateId: candidate.id,
      scoreBreakdown: candidate.scoreBreakdown,
      risks: candidate.risks,
      expectedOutput: candidate.expectedOutput,
    });
    handlePhase({
      stage: 'recommendation',
      status: 'success',
      message: 'recommendation.selected',
      detail: `Seleccionado ${candidate.matchedCatalogTemplateName} con confianza ${Math.round(candidate.confidence * 100)}%.`,
      at: new Date().toISOString(),
      meta: { candidateId: candidate.id, confidence: candidate.confidence },
    });
  }, []);

  const handleGenerate = async () => {
    if (!recommendation || isGenerating) return;
    setIsGenerating(true);
    startedAtRef.current = Date.now();
    lastPhaseAtRef.current = startedAtRef.current;
    stallWarningShownRef.current = false;
    longRunningWarningShownRef.current = false;
    setGenerationError(null);
    setGenerationPhase('Generando contenido, validando estructura y preparando el canvas...');
    try {
      handlePhase({
        stage: 'prompt',
        status: 'success',
        message: generationContract ? 'contract.attached' : 'contract.not-applicable',
        detail: generationContract ? 'El contrato estructurado viaja dentro de ArtifactTemplate.requestContext.' : 'Flujo legacy sin contrato estructurado.',
        at: new Date().toISOString(),
        meta: { hasContract: Boolean(generationContract), contractId: generationContract?.id },
      });
      handlePhase({
        stage: 'ai-generation',
        status: 'in-progress',
        message: generationContract ? 'generation.started-with-contract' : 'generation.started',
        detail: 'Se delega al flujo existente onGenerate → handleCreateArtifact → proceedWithGeneration.',
        at: new Date().toISOString(),
      });
      const generated = await onGenerate(recommendation.template, handlePhase);
      if (generated) {
        setGenerationPhase('Artefacto generado. Abriendo el canvas...');
        onClose();
      } else {
        const message = 'La generación no se completó. Revisa la validación previa, conflictos de versión o reintenta con más contexto.';
        setGenerationError(message);
        setGenerationPhase('Generación detenida antes de persistir el artefacto.');
        addToast(message, 'warning');
      }
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      const message = `No se pudo generar el artefacto. ${friendly.userMessage}`;
      setGenerationError(message);
      setGenerationPhase('Generación fallida con diagnóstico visible.');
      addToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // When the structured brief flow is enabled, hide the legacy idea panel
  // once a contract exists — the embedded wizard owns the rest of the journey.
  const showIdeaPanel = !structuredBriefEnabled || !generationContract;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Artefacto a solicitud"
      description={structuredBriefEnabled ? "Describe la idea, revisa el brief estructurado, controla fuentes y elige una recomendación." : "Describe la idea y la IA recomendará el artefacto de arquitectura más adecuado."}
    >
      <div className="space-y-5">
        {structuredBriefEnabled && (
          <WizardStepProgress
            steps={TOP_LEVEL_STEPS}
            currentStep={currentTopStep}
            completedSteps={generationContract ? [1] : []}
            navigableSteps={generationContract ? [1, 2] : [1]}
            onNavigate={target => {
              // From the modal-level chip strip we can only navigate back to the
              // idea (step 1). All other steps are owned by the embedded wizard.
              if (target === 1) {
                setGenerationContract(null);
                setBriefSource('deterministic');
                setBriefWarnings([]);
                setBriefAcceptedAiFields([]);
                setBriefRejectedAiFields([]);
                setRecommendationCandidates([]);
                setSelectedCandidateId(undefined);
                setRecommendation(null);
                setGenerationPhase('Puedes ajustar la solicitud inicial y recrear el brief estructurado.');
              }
            }}
          />
        )}

        {showIdeaPanel && (
          <>
            <div className="rounded-2xl border border-primary-100 bg-primary-50/70 p-4 dark:border-primary-900/50 dark:bg-primary-950/20">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-white p-2 text-primary-600 shadow-sm dark:bg-gray-900 dark:text-primary-400">
                  <LightBulbIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Describe la idea en lenguaje natural</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {structuredBriefEnabled
                      ? 'Convertiremos tu idea en un brief editable. Después podrás revisar fuentes, elegir una recomendación y confirmar.'
                      : 'La IA comparará tu intención con el catálogo y propondrá el artefacto más adecuado.'}
                  </p>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Idea, concepto o mensaje arquitectónico</span>
              <textarea
                ref={ideaInputRef}
                value={idea}
                onChange={event => setIdea(event.target.value)}
                rows={6}
                aria-describedby="idea-hint"
                aria-invalid={!canAnalyze && idea.trim().length > 0 && idea.trim().length < MIN_IDEA_LENGTH}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                placeholder="Ejemplo: Necesito explicar al comité gerencial cómo la modernización del core reducirá riesgos operativos, qué sistemas se impactan y qué decisiones deben aprobarse."
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p id="idea-hint" className="text-xs text-gray-500 dark:text-gray-400">
                {ideaCharsLeft > 0
                  ? `Añade ${ideaCharsLeft} carácter${ideaCharsLeft === 1 ? '' : 'es'} más para continuar.`
                  : 'Listo. Incluye audiencia, decisión esperada y nivel de detalle si los conoces.'}
              </p>
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                aria-busy={isAnalyzing || undefined}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:focus-visible:ring-offset-gray-950"
              >
                <SparklesIcon className="h-5 w-5" />
                <span>{isAnalyzing ? 'Analizando...' : structuredBriefEnabled ? 'Crear brief estructurado' : 'Recomendar artefacto'}</span>
              </button>
            </div>
          </>
        )}

        {generationPhase && (
          <StatusBanner
            phase={generationPhase}
            durationLabel={totalDuration !== null ? formatDuration(totalDuration) : null}
            tone={generationError ? 'error' : isAnalyzing || isGenerating ? 'info' : 'success'}
          />
        )}

        {isAnalyzing && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="h-full w-full progress-indeterminate" />
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Conceptualizando la necesidad y comparando contra el catálogo de arquitectura...</p>
          </div>
        )}

        {generationError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
            <p className="font-semibold">Generación no completada</p>
            <p className="mt-1 leading-relaxed">{generationError}</p>
          </div>
        )}

        {phaseEvents.length > 0 && (
          <TechnicalTimelineDisclosure
            events={phaseEvents}
            showTechnical={showTechnical}
            onToggleTechnical={() => setShowTechnical(prev => !prev)}
            reportCopied={reportCopied}
            onCopyReport={handleCopyReport}
          />
        )}

        {structuredBriefEnabled && generationContract && (
          <CustomArtifactBriefWizard
            project={project}
            contract={generationContract}
            candidates={recommendationCandidates}
            selectedCandidateId={selectedCandidateId}
            showTop3={featureFlags.top3Recommendations}
            isAnalyzing={isAnalyzing}
            isGenerating={isGenerating}
            briefSource={briefSource}
            briefWarnings={briefWarnings}
            briefAcceptedAiFields={briefAcceptedAiFields}
            briefRejectedAiFields={briefRejectedAiFields}
            onContractChange={handleContractChange}
            onBuildRecommendations={handleBuildStructuredRecommendations}
            onSelectCandidate={handleSelectCandidate}
            onGenerate={handleGenerate}
            onBackToIdea={() => {
              setGenerationContract(null);
              setBriefSource('deterministic');
              setBriefWarnings([]);
              setBriefAcceptedAiFields([]);
              setBriefRejectedAiFields([]);
              setRecommendationCandidates([]);
              setSelectedCandidateId(undefined);
              setRecommendation(null);
              setGenerationPhase('Puedes ajustar la solicitud inicial y recrear el brief estructurado.');
            }}
          />
        )}

        {!structuredBriefEnabled && recommendation && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-gray-900 dark:text-emerald-300 dark:ring-emerald-900/60">
                  <CheckCircleIcon className="mr-1.5 h-4 w-4" />
                  Recomendación IA · {Math.round(recommendation.confidence * 100)}% confianza
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">{recommendation.template.name}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{recommendation.template.objective}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700">
                {recommendation.template.representation}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">Tipo</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.template.type}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">Vista</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.template.architecturalView}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">Fase</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.template.phase}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">Audiencia</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.audience}</dd>
              </div>
            </dl>

            {recommendation.matchedCatalogTemplateName && (
              <p className="mt-4 rounded-xl bg-white/80 px-3 py-2 text-sm text-gray-700 ring-1 ring-emerald-100 dark:bg-gray-900/70 dark:text-gray-300 dark:ring-emerald-900/60">
                Se reutilizará el estándar del catálogo: <strong>{recommendation.matchedCatalogTemplateName}</strong>.
              </p>
            )}

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">Por qué este artefacto</h4>
                <p className="mt-1 text-gray-600 dark:text-gray-400">{recommendation.rationale}</p>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">Qué se va a construir</h4>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-gray-600 dark:text-gray-400">
                  {recommendation.constructionPlan.map(step => <li key={step}>{step}</li>)}
                </ol>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button
                onClick={() => setRecommendation(null)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <ArrowUturnLeftIcon className="mr-2 h-5 w-5" />
                Ajustar solicitud
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
              >
                <SparklesIcon className="mr-2 h-5 w-5" />
                {isGenerating ? 'Generando...' : 'Generar este artefacto'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

interface StatusBannerProps {
  phase: string;
  durationLabel: string | null;
  tone: 'info' | 'success' | 'error';
}

const StatusBanner: React.FC<StatusBannerProps> = ({ phase, durationLabel, tone }) => {
  const palette = tone === 'error'
    ? 'border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100'
    : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100'
      : 'border-blue-200 bg-blue-50/80 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200';
  return (
    <div className={`rounded-xl border p-4 text-sm ${palette}`} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">Estado</p>
        {durationLabel && (
          <span className="text-[11px] font-medium opacity-80">{durationLabel} acumulado</span>
        )}
      </div>
      <p className="mt-1 leading-relaxed">{phase}</p>
    </div>
  );
};

interface TechnicalTimelineDisclosureProps {
  events: ArtifactGenerationPhaseEvent[];
  showTechnical: boolean;
  onToggleTechnical: () => void;
  reportCopied: boolean;
  onCopyReport: () => void;
}

const TechnicalTimelineDisclosure: React.FC<TechnicalTimelineDisclosureProps> = ({
  events,
  showTechnical,
  onToggleTechnical,
  reportCopied,
  onCopyReport,
}) => (
  <CollapsibleSection
    label={`Mostrar trazabilidad técnica (${events.length} ${events.length === 1 ? 'evento' : 'eventos'})`}
    openLabel={`Ocultar trazabilidad técnica (${events.length} ${events.length === 1 ? 'evento' : 'eventos'})`}
    tone="subtle"
    hint="Línea de tiempo de fases, advertencias y diagnósticos para soporte y debugging."
  >
    <div className="rounded-xl border border-gray-200 bg-white/70 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/40" aria-live="polite">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCopyReport}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          title="Copiar reporte técnico al portapapeles para soporte"
        >
          {reportCopied ? <CheckCircleIcon className="h-3 w-3" /> : <Square2StackIcon className="h-3 w-3" />}
          {reportCopied ? 'Reporte copiado' : 'Copiar reporte técnico'}
        </button>
        <button
          type="button"
          onClick={onToggleTechnical}
          aria-pressed={showTechnical}
          className="text-[11px] font-medium text-primary-700 hover:underline dark:text-primary-300"
        >
          {showTechnical ? 'Ocultar metadatos' : 'Ver metadatos por evento'}
        </button>
      </div>
      <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
        {events.map((event, index) => {
          const styles = stageStyle(event.status);
          const stageLabel = STAGE_LABELS[event.stage] ?? event.stage;
          const duration = formatDuration(event.durationMs);
          return (
            <li
              key={`${event.stage}-${event.at}-${index}`}
              className={`relative rounded-lg border border-gray-100 bg-white px-3 py-2 ring-1 dark:border-gray-800 dark:bg-gray-900/70 ${styles.ring}`}
            >
              <div className="flex items-center gap-3">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${styles.dot}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                      {stageLabel}
                      <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.chip}`}>
                        {event.status}
                      </span>
                    </p>
                    {duration && (
                      <span className="whitespace-nowrap text-[10px] text-gray-500 dark:text-gray-400">{duration}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-gray-700 dark:text-gray-300">{event.message}</p>
                  {event.detail && (
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{event.detail}</p>
                  )}
                  {showTechnical && event.meta && Object.keys(event.meta).length > 0 && (
                    <pre className="mt-1 max-h-24 overflow-auto rounded bg-gray-50 p-1.5 text-[10px] text-gray-700 dark:bg-gray-950 dark:text-gray-300">
{JSON.stringify(event.meta, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  </CollapsibleSection>
);
