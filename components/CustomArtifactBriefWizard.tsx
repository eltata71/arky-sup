import React from 'react';
import type { Project } from '../context/AppContext';
import type { ArtifactGenerationContract, ArtifactAudience, ArtifactDetailLevel, ArtifactFamilyPreference, ArtifactPurpose } from '../services/artifacts/domain/artifactGenerationContract';
import type { ArtifactRecommendationCandidate } from '../services/artifacts';
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, SparklesIcon } from './Icons';
import { useBriefWizard } from '../hooks/useBriefWizard';
import {
  CollapsibleSection,
  RecommendationCard,
  SourceSelectionCard,
  WizardStepProgress,
} from './artifacts/wizard';
import {
  WIZARD_STEPS, audienceOptions, familyOptions, purposeOptions, detailOptions,
  audienceLabel, purposeLabel, detailLabel, familyLabel, listToText, textToList, sourceUseFor,
} from './artifacts/briefWizard/briefWizardModel';
import {
  BriefTraceabilityDisclosure, ConfirmationSummary, FooterPrimary, FooterSecondary,
  OriginalIdeaPreview, ReadinessCard, SourceCountSummary, SourceFilterInput, WizardFooter,
} from './artifacts/briefWizard/BriefWizardParts';

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
  const {
    step, setStep, showAdvanced, setShowAdvanced, sourceQuery, setSourceQuery, stepHeadingRef,
    artifacts, filteredArtifacts, showSourceFilter, selectedCandidate,
    sourceMappingWarnings, readiness, sourceCounts, completedSteps, navigableSteps,
    patchContract, setSourceUse, handleNavigate,
  } = useBriefWizard({ project, contract, candidates, selectedCandidateId, onContractChange, onBackToIdea });

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
