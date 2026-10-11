import { useUiTranslation } from '../lib/i18n/UiTranslationContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useAppContext, type Project } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ArtifactTemplate, CustomArtifactRecommendation } from '../types';
import type { ArtifactGenerationPhaseEvent, ArtifactGenerationPhaseListener } from '../lib/artifacts';
import { GENERATION_PHASE_COPY } from '../lib/artifacts/generationPhaseCopy';
import { recommendationService, classifyAIError, AIServiceError } from '../services/ai';
import { buildDeterministicArtifactBrief } from '../services/artifacts/domain/artifactBriefService';
import { extractArtifactBriefWithAI } from '../services/artifacts/application/artifactBriefExtractionService';
import { getArtifactGenerationFeatureFlags } from '../services/artifacts/domain/artifactGenerationFlags';
import { buildArtifactRecommendationCandidates, candidateToLegacyRecommendation, type ArtifactRecommendationCandidate } from '../services/artifacts/domain/artifactRecommendationService';
import { selectArtifactGenerationContext } from '../services/artifacts/domain/artifactContextSelectionService';
import type { ArtifactGenerationContract } from '../types';
import { CustomArtifactBriefWizard, type ArtifactBriefSource } from './CustomArtifactBriefWizard';
import { ArrowUturnLeftIcon, SparklesIcon, LightBulbIcon, CheckCircleIcon } from './Icons';
import { StatusBanner, TechnicalTimelineDisclosure, formatDuration } from './artifacts/requestModal/GenerationStatus';
import { WizardStepProgress, type WizardStepNumber } from './artifacts/wizard';

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
  const t = useUiTranslation();
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
    setGenerationPhase(GENERATION_PHASE_COPY[event.stage].description);
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
        setGenerationPhase(t("uiDynamicGenerated.la-operacion-sigue-activa-pe.004a1b", { p0: String(seconds) }));
        setPhaseEvents(prev => {
          const next: ArtifactGenerationPhaseEvent[] = [...prev, {
            stage: isGenerating ? 'ai-generation' : 'recommendation',
            status: 'warning',
            message: t("Sin nuevos eventos recientes; la operación continúa bajo observación."),
            detail: t("uiDynamicGenerated.silencio-operativo-de-p0-s-e.989457", { p0: String(seconds) }),
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
            message: t("Operación de larga duración detectada."),
            detail: `Tiempo acumulado ${seconds}s. Si el proveedor no responde, el servicio debe cerrar por timeout y dejar trazabilidad visible.`,
            at: new Date().toISOString(),
            meta: { totalMs },
          }];
          return next.length > MAX_PHASE_HISTORY ? next.slice(next.length - MAX_PHASE_HISTORY) : next;
        });
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [isAnalyzing, isGenerating, t]);

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
      addToast(t("uiMessage.no-se-pudo-copiar-el-reporte.dfc41f"), 'warning');
    }
  }, [technicalReport, addToast, t]);

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
        setGenerationPhase(t('uiState.0'));
      }
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      const message = t("uiDynamicGenerated.no-se-pudo-analizar-la-solic.99d175", { p0: String(friendly.userMessage) });
      setGenerationError(message);
      setGenerationPhase(t('uiState.1'));
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
        detail: t("uiDynamicGenerated.p0-candidato-s-ordenados-por.6a1941", { p0: String(candidates.length) }),
        at: new Date().toISOString(),
        meta: { candidateCount: candidates.length, top3Enabled: featureFlags.top3Recommendations },
      });
      setGenerationPhase(t('uiState.2'));
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      const message = t("uiDynamicGenerated.no-se-pudieron-construir-rec.2d41c3", { p0: String(friendly.userMessage) });
      setGenerationError(message);
      addToast(message, 'warning');
    } finally {
      setIsAnalyzing(false);
    }
  }, [addToast, featureFlags.top3Recommendations, generationContract, project, t]);

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
    setGenerationPhase(t('uiState.3'));
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
        setGenerationPhase(t('uiState.4'));
        onClose();
      } else {
        const message = 'La generación no se completó. Revisa la validación previa, conflictos de versión o reintenta con más contexto.';
        setGenerationError(message);
        setGenerationPhase(t('uiState.5'));
        addToast(message, 'warning');
      }
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      const message = t("uiDynamicGenerated.no-se-pudo-generar-el-artefa.d81c60", { p0: String(friendly.userMessage) });
      setGenerationError(message);
      setGenerationPhase(t('uiState.6'));
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
      title={t("projectHub.customArtifact")}
      description={structuredBriefEnabled ? "Describe la idea, revisa el brief estructurado, controla fuentes y elige una recomendación." : "Describe la idea y la IA recomendará el artefacto de arquitectura más adecuado."}
    >
      <div className="space-y-5">
        {structuredBriefEnabled && (
          <WizardStepProgress
            steps={TOP_LEVEL_STEPS.map(step => ({ ...step, label: t(step.label) }))}
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
                setGenerationPhase(t('uiState.7'));
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
                  <h3 className="font-semibold text-gray-900 dark:text-white">{t("ui.describe-la-idea-en-lenguaje.d84d79")}</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {structuredBriefEnabled
                      ? t("uiExpr.convertiremos-tu-idea-en-un.0c1a77")
                      : t("uiExpr.la-ia-comparara-tu-intencion.93ccb8")}
                  </p>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t("ui.idea-concepto-o-mensaje-arqu.e18fd2")}</span>
              <textarea
                ref={ideaInputRef}
                value={idea}
                onChange={event => setIdea(event.target.value)}
                rows={6}
                aria-describedby="idea-hint"
                aria-invalid={!canAnalyze && idea.trim().length > 0 && idea.trim().length < MIN_IDEA_LENGTH}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                placeholder={t("ui.ejemplo-necesito-explicar-al.7c1dc3")}
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p id="idea-hint" className="text-xs text-gray-500 dark:text-gray-400">
                {ideaCharsLeft > 0
                  ? t(ideaCharsLeft === 1 ? 'brief.moreCharacterOne' : 'brief.moreCharacterMany', { count: String(ideaCharsLeft) })
                  : t("uiExpr.listo-incluye-audiencia-deci.c55df5")}
              </p>
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                aria-busy={isAnalyzing || undefined}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:focus-visible:ring-offset-gray-950"
              >
                <SparklesIcon className="h-5 w-5" />
                <span>{isAnalyzing ? t("ui.analizando.7cb616") : structuredBriefEnabled ? t("uiExpr.crear-brief-estructurado.ac0ee0") : t("uiExpr.recomendar-artefacto.e0cf62")}</span>
              </button>
            </div>
          </>
        )}

        {generationPhase && (
          <StatusBanner
            phase={generationPhase}
            stage={phaseEvents[phaseEvents.length - 1]?.stage}
            durationLabel={totalDuration !== null ? formatDuration(totalDuration) : null}
            tone={generationError ? 'error' : isAnalyzing || isGenerating ? 'info' : 'success'}
          />
        )}

        {isAnalyzing && (
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="h-full w-full progress-indeterminate" />
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t("ui.conceptualizando-la-necesida.f46b0f")}</p>
          </div>
        )}

        {generationError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
            <p className="font-semibold">{t("ui.generacion-no-completada.052221")}</p>
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
              setGenerationPhase(t('uiState.7'));
            }}
          />
        )}

        {!structuredBriefEnabled && recommendation && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-gray-900 dark:text-emerald-300 dark:ring-emerald-900/60">
                  <CheckCircleIcon className="mr-1.5 h-4 w-4" />
                  {t("ui.recomendacion-ia.1c918f")} {Math.round(recommendation.confidence * 100)}{t("ui.confianza.947a35")}
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
                <dt className="font-semibold text-gray-800 dark:text-gray-200">{t("projectHub.type")}</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.template.type}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">{t("ui.vista.462d2d")}</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.template.architecturalView}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">{t("projectHub.phase")}</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.template.phase}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-200">{t("ui.audiencia.af8f94")}</dt>
                <dd className="text-gray-600 dark:text-gray-400">{recommendation.audience}</dd>
              </div>
            </dl>

            {recommendation.matchedCatalogTemplateName && (
              <p className="mt-4 rounded-xl bg-white/80 px-3 py-2 text-sm text-gray-700 ring-1 ring-emerald-100 dark:bg-gray-900/70 dark:text-gray-300 dark:ring-emerald-900/60">
                {t("ui.se-reutilizara-el-estandar-d.4f7463")} <strong>{recommendation.matchedCatalogTemplateName}</strong>.
              </p>
            )}

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">{t("ui.por-que-este-artefacto.ba0f2b")}</h4>
                <p className="mt-1 text-gray-600 dark:text-gray-400">{recommendation.rationale}</p>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">{t("ui.que-se-va-a-construir.40703a")}</h4>
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
                {t("ui.ajustar-solicitud.ee97e3")}
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
              >
                <SparklesIcon className="mr-2 h-5 w-5" />
                {isGenerating ? t("generating") : t("uiExpr.generar-este-artefacto.5b0720")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
