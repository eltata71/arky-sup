import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, Project } from '../types';
import type { ArtifactGenerationContract, ArtifactAudience, ArtifactDetailLevel, ArtifactFamilyPreference, ArtifactPurpose } from '../services/artifacts/artifactGenerationContract';
import type { ArtifactRecommendationCandidate } from '../services/artifacts/artifactRecommendationService';
import { validateArtifactGenerationContract } from '../services/artifacts/artifactGenerationContract';
import { updateArtifactBriefFromForm } from '../services/artifacts/artifactBriefService';
import { selectArtifactGenerationContext } from '../services/artifacts/artifactContextSelectionService';
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, InformationCircleIcon, MagnifyingGlassIcon, SparklesIcon, XCircleIcon } from './Icons';
import {
  CollapsibleSection,
  RecommendationCard,
  SourceSelectionCard,
  WizardStepProgress,
  type SourceUse,
  type WizardStepNumber,
} from './artifacts/wizard';

export type ArtifactBriefSource = 'deterministic' | 'ai-assisted';

interface CustomArtifactBriefWizardProps {
  project: Project;
  contract: ArtifactGenerationContract;
  candidates: ArtifactRecommendationCandidate[];
  selectedCandidateId?: string;
  showTop3: boolean;
  isAnalyzing: boolean;
  isGenerating: boolean;
  /** Whether the brief was produced deterministically or improved by AI. */
  briefSource?: ArtifactBriefSource;
  /** Non-blocking warnings from brief extraction / AI merge. */
  briefWarnings?: string[];
  /** Fields safely accepted from the AI proposal after deterministic merge. */
  briefAcceptedAiFields?: string[];
  /** Fields rejected from the AI proposal for traceability/support. */
  briefRejectedAiFields?: string[];
  onContractChange: (contract: ArtifactGenerationContract, reason?: string) => void;
  onBuildRecommendations: () => void;
  onSelectCandidate: (candidate: ArtifactRecommendationCandidate) => void;
  onGenerate: () => void;
  onBackToIdea: () => void;
}

const audienceOptions: Array<{ value: ArtifactAudience; label: string }> = [
  { value: 'mixed', label: 'Mixta' },
  { value: 'executive', label: 'Ejecutiva' },
  { value: 'technical', label: 'Técnica' },
  { value: 'operations', label: 'Operaciones' },
  { value: 'business', label: 'Negocio' },
];

const familyOptions: Array<{ value: ArtifactFamilyPreference; label: string }> = [
  { value: 'auto', label: 'Automático' },
  { value: 'document', label: 'Documento' },
  { value: 'diagram', label: 'Diagrama' },
  { value: 'hybrid', label: 'Híbrido' },
  { value: 'table', label: 'Tabla' },
  { value: 'matrix', label: 'Matriz' },
  { value: 'presentation', label: 'Presentación' },
];

const purposeOptions: Array<{ value: ArtifactPurpose; label: string }> = [
  { value: 'explanation', label: 'Explicar' },
  { value: 'decision', label: 'Decidir' },
  { value: 'design', label: 'Diseñar' },
  { value: 'implementation', label: 'Implementar' },
  { value: 'analysis', label: 'Analizar' },
  { value: 'governance', label: 'Gobernar' },
  { value: 'comparison', label: 'Comparar' },
  { value: 'validation', label: 'Validar' },
  { value: 'communication', label: 'Comunicar' },
];

const detailOptions: Array<{ value: ArtifactDetailLevel; label: string }> = [
  { value: 'executive', label: 'Ejecutivo' },
  { value: 'conceptual', label: 'Conceptual' },
  { value: 'logical', label: 'Lógico' },
  { value: 'physical', label: 'Físico' },
  { value: 'technical', label: 'Técnico' },
  { value: 'deep-technical', label: 'Técnico profundo' },
];

const audienceLabel = (value: ArtifactAudience): string => audienceOptions.find(option => option.value === value)?.label ?? value;
const purposeLabel = (value: ArtifactPurpose): string => purposeOptions.find(option => option.value === value)?.label ?? value;
const detailLabel = (value: ArtifactDetailLevel): string => detailOptions.find(option => option.value === value)?.label ?? value;
const familyLabel = (value: ArtifactFamilyPreference): string => familyOptions.find(option => option.value === value)?.label ?? value;

const listToText = (items: string[]): string => items.join('\n');
const textToList = (value: string): string[] => value.split(/\n|;|,/).map(item => item.trim()).filter(Boolean).slice(0, 10);

const sourceUseFor = (contract: ArtifactGenerationContract, artifactId: string): SourceUse => {
  if (contract.requiredSourceArtifactIds.includes(artifactId)) return 'required';
  if (contract.optionalSourceArtifactIds.includes(artifactId)) return 'optional';
  if (contract.excludedSourceArtifactIds.includes(artifactId)) return 'excluded';
  return 'none';
};

const latestArtifacts = (artifacts: Artifact[]): Artifact[] => {
  const byGroup = new Map<string, Artifact>();
  artifacts.forEach(artifact => {
    const group = artifact.versionGroupId || artifact.id;
    const current = byGroup.get(group);
    if (!current || artifact.version > current.version) byGroup.set(group, artifact);
  });
  return Array.from(byGroup.values()).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
};

const briefReadiness = (
  contract: ArtifactGenerationContract,
  validationErrors: string[],
): { ready: boolean; message: string } => {
  if (validationErrors.length > 0) return { ready: false, message: validationErrors[0] };
  if (contract.normalizedIntent.trim().length < 25) {
    return { ready: false, message: 'Detalla la intención normalizada (al menos 25 caracteres) para avanzar con un brief sólido.' };
  }
  return { ready: true, message: 'El brief está suficientemente claro para continuar a la selección de fuentes.' };
};

/** Show the source search input when the project has at least this many artifacts. */
const SOURCE_FILTER_THRESHOLD = 6;

const matchesSourceQuery = (artifact: Artifact, query: string): boolean => {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    artifact.name,
    artifact.type,
    artifact.architecturalView,
    artifact.phase,
    artifact.objective,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
};

const WIZARD_STEPS = [
  { number: 1 as WizardStepNumber, label: 'Idea' },
  { number: 2 as WizardStepNumber, label: 'Brief' },
  { number: 3 as WizardStepNumber, label: 'Fuentes' },
  { number: 4 as WizardStepNumber, label: 'Recomendaciones' },
  { number: 5 as WizardStepNumber, label: 'Confirmación' },
];

export const CustomArtifactBriefWizard: React.FC<CustomArtifactBriefWizardProps> = ({
  project,
  contract,
  candidates,
  selectedCandidateId,
  showTop3,
  isAnalyzing,
  isGenerating,
  briefSource = 'deterministic',
  briefWarnings = [],
  briefAcceptedAiFields = [],
  briefRejectedAiFields = [],
  onContractChange,
  onBuildRecommendations,
  onSelectCandidate,
  onGenerate,
  onBackToIdea,
}) => {
  const [step, setStep] = useState<2 | 3 | 4 | 5>(2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const validationErrors = useMemo(() => validateArtifactGenerationContract(contract), [contract]);
  const artifacts = useMemo(() => latestArtifacts(project.artifacts ?? []), [project.artifacts]);
  const filteredArtifacts = useMemo(
    () => artifacts.filter(artifact => matchesSourceQuery(artifact, sourceQuery)),
    [artifacts, sourceQuery],
  );
  const showSourceFilter = artifacts.length >= SOURCE_FILTER_THRESHOLD;
  const selectedCandidate = candidates.find(candidate => candidate.id === selectedCandidateId) ?? candidates[0];
  const sourceMappingWarnings = useMemo(
    () => selectArtifactGenerationContext(project, contract).resolvedSourceMappings.filter(mapping => mapping.warning),
    [project, contract],
  );
  const readiness = useMemo(() => briefReadiness(contract, validationErrors), [contract, validationErrors]);
  const sourceCounts = useMemo(() => ({
    suggested: artifacts.length,
    required: contract.requiredSourceArtifactIds.length,
    optional: contract.optionalSourceArtifactIds.length,
    excluded: contract.excludedSourceArtifactIds.length,
  }), [artifacts.length, contract.requiredSourceArtifactIds.length, contract.optionalSourceArtifactIds.length, contract.excludedSourceArtifactIds.length]);

  const completedSteps = useMemo(() => {
    const completed: WizardStepNumber[] = [1];
    if (step > 2 || readiness.ready) completed.push(2);
    if (step > 3) completed.push(3);
    if (step > 4) completed.push(4);
    return completed;
  }, [step, readiness.ready]);

  const navigableSteps = useMemo<WizardStepNumber[]>(() => {
    const reachable: WizardStepNumber[] = [1, 2];
    if (step >= 3 || readiness.ready) reachable.push(3);
    if (step >= 4 || candidates.length > 0) reachable.push(4);
    if (selectedCandidate) reachable.push(5);
    return reachable;
  }, [step, readiness.ready, candidates.length, selectedCandidate]);

  const patchContract = (patch: Partial<ArtifactGenerationContract>, reason = 'brief.edited') => {
    onContractChange(updateArtifactBriefFromForm(contract, patch), reason);
  };

  const setSourceUse = (artifactId: string, use: SourceUse) => {
    const without = (ids: string[]) => ids.filter(id => id !== artifactId);
    patchContract({
      requiredSourceArtifactIds: use === 'required' ? [...without(contract.requiredSourceArtifactIds), artifactId] : without(contract.requiredSourceArtifactIds),
      optionalSourceArtifactIds: use === 'optional' ? [...without(contract.optionalSourceArtifactIds), artifactId] : without(contract.optionalSourceArtifactIds),
      excludedSourceArtifactIds: use === 'excluded' ? [...without(contract.excludedSourceArtifactIds), artifactId] : without(contract.excludedSourceArtifactIds),
    }, 'context.sources-selected');
  };

  // Move focus to the active step heading whenever the user advances or
  // navigates back.  Heading is tabIndex={-1} so it can receive focus without
  // joining the tab order; screen readers will announce the new step context.
  useEffect(() => {
    stepHeadingRef.current?.focus({ preventScroll: false });
  }, [step]);

  const handleNavigate = (target: WizardStepNumber) => {
    if (target === 1) {
      onBackToIdea();
      return;
    }
    if (target >= 2 && target <= 5) {
      setStep(target as 2 | 3 | 4 | 5);
    }
  };

  return (
    <div className="space-y-5">
      <WizardStepProgress
        steps={WIZARD_STEPS}
        currentStep={step}
        completedSteps={completedSteps}
        navigableSteps={navigableSteps}
        onNavigate={handleNavigate}
      />

      {step === 2 && (
        <section
          aria-labelledby="wizard-step-2-title"
          className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-950/50"
        >
          <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="wizard-step-2-title" ref={step === 2 ? stepHeadingRef : null} tabIndex={-1} className="text-base font-bold text-gray-900 outline-none focus:outline-none dark:text-white">Brief estructurado editable</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Confirma cómo Arky entendió tu idea. Ajusta los campos clave y, si quieres, abre las opciones avanzadas.
              </p>
              <span
                className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${briefSource === 'ai-assisted'
                  ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/60'
                  : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700'}`}
              >
                {briefSource === 'ai-assisted' ? 'Brief asistido por IA' : 'Brief determinístico'}
              </span>
            </div>
            <button
              type="button"
              onClick={onBackToIdea}
              className="min-h-[44px] rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Editar idea
            </button>
          </header>

          {(briefWarnings.length > 0 || briefRejectedAiFields.length > 0) && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" role="status" aria-live="polite">
              <p className="font-semibold">Avisos del brief</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {briefWarnings.slice(0, 4).map(warning => <li key={warning}>{warning}</li>)}
                {briefRejectedAiFields.length > 0 && (
                  <li>Campos IA descartados por seguridad: {briefRejectedAiFields.join(', ')}.</li>
                )}
              </ul>
            </div>
          )}

          <ReadinessCard ready={readiness.ready} message={readiness.message} />

          {contract.originalRequest && (
            <OriginalIdeaPreview originalRequest={contract.originalRequest} />
          )}

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Intención normalizada</span>
            <textarea
              value={contract.normalizedIntent}
              onChange={event => patchContract({ normalizedIntent: event.target.value })}
              rows={3}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </label>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Audiencia
              <select
                value={contract.audience}
                onChange={event => patchContract({ audience: event.target.value as ArtifactAudience })}
                className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                {audienceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Familia esperada
              <select
                value={contract.artifactFamily}
                onChange={event => patchContract({ artifactFamily: event.target.value as ArtifactFamilyPreference })}
                className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                {familyOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Propósito
              <select
                value={contract.purpose}
                onChange={event => patchContract({ purpose: event.target.value as ArtifactPurpose })}
                className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                {purposeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Nivel de detalle
              <select
                value={contract.detailLevel}
                onChange={event => patchContract({ detailLevel: event.target.value as ArtifactDetailLevel })}
                className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                {detailOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(prev => !prev)}
            aria-expanded={showAdvanced}
            className="mt-4 min-h-[40px] text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"
          >
            {showAdvanced ? 'Ocultar opciones avanzadas' : 'Mostrar opciones avanzadas'}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Criterios de aceptación
                <textarea
                  value={listToText(contract.acceptanceCriteria)}
                  onChange={event => patchContract({ acceptanceCriteria: textToList(event.target.value) })}
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
              <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Formatos objetivo
                <textarea
                  value={listToText(contract.exportTargets)}
                  onChange={event => patchContract({ exportTargets: textToList(event.target.value) })}
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
              <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Orientación visual
                <select
                  value={contract.visualPreferences?.orientation ?? 'auto'}
                  onChange={event => patchContract({ visualPreferences: { ...contract.visualPreferences, orientation: event.target.value as 'auto' | 'LR' | 'TD' } })}
                  className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="auto">Automática</option>
                  <option value="LR">Izquierda → derecha</option>
                  <option value="TD">Arriba → abajo</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Densidad
                <select
                  value={contract.visualPreferences?.density ?? 'balanced'}
                  onChange={event => patchContract({ visualPreferences: { ...contract.visualPreferences, density: event.target.value as 'simple' | 'balanced' | 'detailed' } })}
                  className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="simple">Simple</option>
                  <option value="balanced">Balanceada</option>
                  <option value="detailed">Detallada</option>
                </select>
              </label>
            </div>
          )}

          {(briefAcceptedAiFields.length > 0 || briefRejectedAiFields.length > 0) && (
            <BriefTraceabilityDisclosure
              briefAcceptedAiFields={briefAcceptedAiFields}
              briefRejectedAiFields={briefRejectedAiFields}
            />
          )}

          <WizardFooter>
            <FooterSecondary onClick={onBackToIdea}>Editar idea</FooterSecondary>
            <FooterPrimary
              onClick={() => setStep(3)}
              disabled={!readiness.ready}
              rightIcon={<ArrowRightIcon className="h-4 w-4" />}
            >
              Continuar a fuentes
            </FooterPrimary>
          </WizardFooter>
        </section>
      )}

      {step === 3 && (
        <section
          aria-labelledby="wizard-step-3-title"
          className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-950/50"
        >
          <header>
            <h3 id="wizard-step-3-title" ref={step === 3 ? stepHeadingRef : null} tabIndex={-1} className="text-base font-bold text-gray-900 outline-none focus:outline-none dark:text-white">Fuentes que alimentarán la generación</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Marca cada artefacto como obligatorio, opcional o excluido. Sólo se muestran las últimas versiones.
            </p>
          </header>

          <SourceCountSummary counts={sourceCounts} />

          {showSourceFilter && (
            <SourceFilterInput
              query={sourceQuery}
              onChange={setSourceQuery}
              matchedCount={filteredArtifacts.length}
              totalCount={artifacts.length}
            />
          )}

          <div
            className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1"
            role="list"
            aria-label={`Fuentes disponibles: ${filteredArtifacts.length} de ${artifacts.length}`}
          >
            {artifacts.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
                Este proyecto aún no tiene artefactos existentes. La generación usará sólo el contexto global del proyecto.
              </p>
            )}
            {artifacts.length > 0 && filteredArtifacts.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
                No hay fuentes que coincidan con la búsqueda. Ajusta los términos o limpia el filtro para volver a ver todas las fuentes.
              </p>
            )}
            {filteredArtifacts.map(artifact => (
              <div key={artifact.id} role="listitem">
                <SourceSelectionCard
                  artifact={artifact}
                  use={sourceUseFor(contract, artifact.id)}
                  onChange={use => setSourceUse(artifact.id, use)}
                />
              </div>
            ))}
          </div>

          {sourceMappingWarnings.length > 0 && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200" role="status" aria-live="polite">
              <p className="font-semibold">Resolución de versiones de fuentes</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {sourceMappingWarnings.map(mapping => <li key={mapping.requestedId}>{mapping.warning}</li>)}
              </ul>
            </div>
          )}

          <CollapsibleSection
            label="Mostrar contexto textual adicional"
            openLabel="Ocultar contexto textual adicional"
            tone="primary"
            className="mt-4"
            hint="Listas opcionales (separadas por coma o salto de línea) para forzar o excluir conceptos específicos."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Contexto textual a usar
                <textarea
                  value={listToText(contract.requiredContextItems)}
                  onChange={event => patchContract({ requiredContextItems: textToList(event.target.value) }, 'context.sources-selected')}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
              <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">Contexto textual a excluir
                <textarea
                  value={listToText(contract.excludedContextItems)}
                  onChange={event => patchContract({ excludedContextItems: textToList(event.target.value) }, 'context.sources-selected')}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
            </div>
          </CollapsibleSection>

          <WizardFooter>
            <FooterSecondary onClick={() => setStep(2)} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>Volver al brief</FooterSecondary>
            <FooterPrimary
              onClick={() => { onBuildRecommendations(); setStep(4); }}
              disabled={isAnalyzing}
              loading={isAnalyzing}
              rightIcon={!isAnalyzing ? <ArrowRightIcon className="h-4 w-4" /> : undefined}
            >
              {isAnalyzing ? 'Construyendo...' : 'Construir recomendaciones'}
            </FooterPrimary>
          </WizardFooter>
        </section>
      )}

      {step === 4 && (
        <section
          aria-labelledby="wizard-step-4-title"
          className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-950/50"
        >
          <header>
            <h3 id="wizard-step-4-title" ref={step === 4 ? stepHeadingRef : null} tabIndex={-1} className="text-base font-bold text-gray-900 outline-none focus:outline-none dark:text-white">
              {showTop3 ? 'Elige la mejor recomendación' : 'Recomendación principal'}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {showTop3
                ? 'La opción sugerida está marcada. Selecciona otra alternativa si encaja mejor con tu objetivo.'
                : 'Revisa la recomendación principal y continúa si encaja con tu objetivo.'}
            </p>
          </header>

          {candidates.length === 0 && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              Aún no hay recomendaciones. Construye el Top 3 desde el paso de fuentes.
            </div>
          )}

          <div className="mt-4 space-y-3">
            {(showTop3 ? candidates : candidates.slice(0, 1)).map((candidate, index) => (
              <RecommendationCard
                key={candidate.id}
                candidate={candidate}
                isPrimary={index === 0}
                isSelected={selectedCandidateId === candidate.id}
                onSelect={() => onSelectCandidate(candidate)}
              />
            ))}
          </div>

          <WizardFooter>
            <FooterSecondary onClick={() => setStep(3)} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>Volver a fuentes</FooterSecondary>
            <FooterPrimary
              onClick={() => setStep(5)}
              disabled={!selectedCandidate}
              rightIcon={<ArrowRightIcon className="h-4 w-4" />}
            >
              Confirmar selección
            </FooterPrimary>
          </WizardFooter>
        </section>
      )}

      {step === 5 && selectedCandidate && (
        <section
          aria-labelledby="wizard-step-5-title"
          className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5 dark:border-emerald-900/60 dark:bg-emerald-950/20"
        >
          <header className="flex items-start gap-3">
            <span className="mt-0.5 rounded-xl bg-white p-2 text-emerald-600 shadow-sm dark:bg-gray-900 dark:text-emerald-300">
              <CheckCircleIcon className="h-5 w-5" />
            </span>
            <div>
              <h3 id="wizard-step-5-title" ref={step === 5 ? stepHeadingRef : null} tabIndex={-1} className="text-base font-bold text-gray-900 outline-none focus:outline-none dark:text-white">Todo listo para generar</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Revisa el resumen final. Al continuar, Arky generará el artefacto con el contrato estructurado.
              </p>
            </div>
          </header>

          <ConfirmationSummary
            artifactName={selectedCandidate.template.name}
            catalogName={selectedCandidate.matchedCatalogTemplateName}
            audience={audienceLabel(contract.audience)}
            purpose={purposeLabel(contract.purpose)}
            detailLevel={detailLabel(contract.detailLevel)}
            family={familyLabel(contract.artifactFamily)}
            requiredCount={contract.requiredSourceArtifactIds.length}
            optionalCount={contract.optionalSourceArtifactIds.length}
            excludedCount={contract.excludedSourceArtifactIds.length}
            acceptanceCriteria={contract.acceptanceCriteria}
          />

          <CollapsibleSection
            label="Mostrar trazabilidad"
            openLabel="Ocultar trazabilidad"
            tone="subtle"
            className="mt-3"
          >
            <dl className="grid grid-cols-1 gap-2 rounded-xl bg-white/70 p-3 text-xs text-gray-700 dark:bg-gray-900/60 dark:text-gray-300 sm:grid-cols-2">
              <div><dt className="font-semibold">Contrato</dt><dd className="font-mono break-all">{contract.id}</dd></div>
              <div><dt className="font-semibold">Origen del brief</dt><dd>{briefSource === 'ai-assisted' ? 'Asistido por IA' : 'Determinístico'}</dd></div>
              <div><dt className="font-semibold">Idioma</dt><dd>{contract.language}</dd></div>
              <div><dt className="font-semibold">Calidad objetivo</dt><dd>{contract.qualityTarget}/100</dd></div>
            </dl>
          </CollapsibleSection>

          <WizardFooter>
            <FooterSecondary onClick={() => setStep(4)} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>Volver a recomendaciones</FooterSecondary>
            <FooterPrimary
              onClick={onGenerate}
              disabled={isGenerating}
              loading={isGenerating}
              leftIcon={!isGenerating ? <SparklesIcon className="h-4 w-4" /> : undefined}
            >
              {isGenerating ? 'Generando...' : 'Generar con contrato'}
            </FooterPrimary>
          </WizardFooter>
        </section>
      )}
    </div>
  );
};

const ReadinessCard: React.FC<{ ready: boolean; message: string }> = ({ ready, message }) => (
  <div
    role="status"
    aria-live="polite"
    className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
      ready
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
        : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
    }`}
  >
    {ready ? <CheckCircleIcon className="mt-0.5 h-4 w-4" /> : <InformationCircleIcon className="mt-0.5 h-4 w-4" />}
    <div>
      <p className="font-semibold">Criterio para avanzar</p>
      <p className="mt-0.5 leading-snug">{message}</p>
    </div>
  </div>
);

interface BriefTraceabilityProps {
  briefAcceptedAiFields: string[];
  briefRejectedAiFields: string[];
}

const BriefTraceabilityDisclosure: React.FC<BriefTraceabilityProps> = ({ briefAcceptedAiFields, briefRejectedAiFields }) => (
  <CollapsibleSection
    label="Ver trazabilidad del brief"
    openLabel="Ocultar trazabilidad del brief"
    tone="subtle"
    className="mt-4"
  >
    <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
      <div className="flex flex-wrap items-center gap-2">
        {briefAcceptedAiFields.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/60">
            IA aceptó {briefAcceptedAiFields.length} campo(s)
          </span>
        )}
        {briefRejectedAiFields.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/60">
            IA rechazó {briefRejectedAiFields.length} campo(s)
          </span>
        )}
      </div>
      {briefAcceptedAiFields.length > 0 && (
        <p>Campos sugeridos por IA y aceptados tras validación determinística: <span className="font-semibold">{briefAcceptedAiFields.join(', ')}</span>.</p>
      )}
      {briefRejectedAiFields.length > 0 && (
        <p>Campos descartados por seguridad o por fallo de validación: <span className="font-semibold">{briefRejectedAiFields.join(', ')}</span>.</p>
      )}
    </div>
  </CollapsibleSection>
);

interface SourceCountSummaryProps {
  counts: { suggested: number; required: number; optional: number; excluded: number };
}

const OriginalIdeaPreview: React.FC<{ originalRequest: string }> = ({ originalRequest }) => {
  const trimmed = originalRequest.trim();
  if (!trimmed) return null;
  return (
    <CollapsibleSection
      label="Ver idea original"
      openLabel="Ocultar idea original"
      tone="subtle"
      className="mt-3"
    >
      <blockquote className="whitespace-pre-wrap rounded-xl border-l-2 border-primary-300 bg-primary-50/40 px-3 py-2 text-sm italic text-gray-700 dark:border-primary-700 dark:bg-primary-950/20 dark:text-gray-200">
        “{trimmed}”
      </blockquote>
    </CollapsibleSection>
  );
};

interface SourceFilterInputProps {
  query: string;
  onChange: (value: string) => void;
  matchedCount: number;
  totalCount: number;
}

const SourceFilterInput: React.FC<SourceFilterInputProps> = ({ query, onChange, matchedCount, totalCount }) => (
  <div className="mt-3 space-y-1.5">
    <label className="block">
      <span className="sr-only">Filtrar fuentes</span>
      <span className="relative block">
        <MagnifyingGlassIcon
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
        />
        <input
          type="search"
          value={query}
          onChange={event => onChange(event.target.value)}
          placeholder="Filtrar por nombre, tipo, vista o fase..."
          className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-10 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpiar filtro de fuentes"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <XCircleIcon className="h-4 w-4" />
          </button>
        )}
      </span>
    </label>
    <p className="text-[11px] text-gray-500 dark:text-gray-400" aria-live="polite">
      {query.length === 0
        ? `Mostrando ${totalCount} fuente${totalCount === 1 ? '' : 's'}.`
        : `Mostrando ${matchedCount} de ${totalCount} fuente${totalCount === 1 ? '' : 's'}.`}
    </p>
  </div>
);

const SourceCountSummary: React.FC<SourceCountSummaryProps> = ({ counts }) => (
  <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
    <SummaryStat label="Fuentes sugeridas" value={counts.suggested} tone="neutral" />
    <SummaryStat label="Obligatorias" value={counts.required} tone="emerald" />
    <SummaryStat label="Opcionales" value={counts.optional} tone="blue" />
    <SummaryStat label="Excluidas" value={counts.excluded} tone="rose" />
  </dl>
);

const SummaryStat: React.FC<{ label: string; value: number; tone: 'neutral' | 'emerald' | 'blue' | 'rose' }> = ({ label, value, tone }) => {
  const palette = {
    neutral: 'bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-800',
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60',
    blue: 'bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/60',
    rose: 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/60',
  }[tone];
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${palette}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold leading-none">{value}</dd>
    </div>
  );
};

interface ConfirmationSummaryProps {
  artifactName: string;
  catalogName: string;
  audience: string;
  purpose: string;
  detailLevel: string;
  family: string;
  requiredCount: number;
  optionalCount: number;
  excludedCount: number;
  acceptanceCriteria: string[];
}

const ConfirmationSummary: React.FC<ConfirmationSummaryProps> = ({ artifactName, catalogName, audience, purpose, detailLevel, family, requiredCount, optionalCount, excludedCount, acceptanceCriteria }) => (
  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
    <SummaryRow label="Artefacto" value={artifactName} emphasis />
    <SummaryRow label="Catálogo base" value={catalogName} />
    <SummaryRow label="Audiencia" value={audience} />
    <SummaryRow label="Propósito" value={purpose} />
    <SummaryRow label="Nivel de detalle" value={detailLevel} />
    <SummaryRow label="Familia" value={family} />
    <SummaryRow label="Fuentes seleccionadas" value={String(requiredCount + optionalCount)} />
    <SummaryRow label="Excluidas" value={String(excludedCount)} />
    {acceptanceCriteria.length > 0 && (
      <div className="sm:col-span-2 rounded-xl bg-white/80 p-3 text-sm shadow-sm ring-1 ring-emerald-100 dark:bg-gray-900/70 dark:ring-emerald-900/60">
        <p className="font-semibold text-gray-900 dark:text-white">Criterios de aceptación</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          {acceptanceCriteria.map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
    )}
  </div>
);

const SummaryRow: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({ label, value, emphasis = false }) => (
  <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-emerald-100 dark:bg-gray-900/70 dark:ring-emerald-900/60">
    <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
    <dd className={`mt-0.5 ${emphasis ? 'text-base font-bold text-gray-900 dark:text-white' : 'text-sm text-gray-700 dark:text-gray-200'}`}>{value}</dd>
  </div>
);

const WizardFooter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="sticky bottom-0 mt-5 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white/90 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80 sm:flex-row sm:justify-between sm:gap-3 sm:px-5">
    {children}
  </div>
);

interface FooterButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children: React.ReactNode;
}

const FooterPrimary: React.FC<FooterButtonProps> = ({ onClick, disabled, loading, leftIcon, rightIcon, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-busy={loading || undefined}
    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-950"
  >
    {leftIcon}
    <span>{children}</span>
    {rightIcon}
  </button>
);

const FooterSecondary: React.FC<FooterButtonProps> = ({ onClick, disabled, leftIcon, rightIcon, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-950"
  >
    {leftIcon}
    <span>{children}</span>
    {rightIcon}
  </button>
);
