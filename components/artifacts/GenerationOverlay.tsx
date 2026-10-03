import type { ArtifactGenerationStage } from '../../lib/artifacts';
import { GENERATION_PHASE_COPY } from '../../lib/artifacts/generationPhaseCopy';
import { SparklesIcon } from '../Icons';

interface GenerationOverlayProps {
  pendingOpenArtifactId: string | null;
  generatingMessage: string;
  generationStage: ArtifactGenerationStage | null;
  generationElapsedSec: number;
  onDismiss: () => void;
}

export function GenerationOverlay({ pendingOpenArtifactId, generatingMessage, generationStage, generationElapsedSec, onDismiss }: GenerationOverlayProps) {
  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-md flex flex-col items-center justify-center z-[200] animate-fade-in" role="dialog" aria-modal="true" aria-label="Procesando">
      <div className="bg-white dark:bg-gray-900 px-8 py-7 rounded-2xl shadow-pop flex flex-col items-center max-w-sm w-full mx-6 border border-gray-100 dark:border-gray-800 animate-slide-up">
        <div className="relative mb-5 ai-orbit rounded-full p-1">
          <div className="relative h-14 w-14 rounded-full bg-ai-gradient flex items-center justify-center shadow-glow-ai">
            <SparklesIcon className="h-7 w-7 text-white" />
          </div>
        </div>
        <p className="text-2xs uppercase tracking-widest-2 text-ai-600 dark:text-ai-300 font-semibold mb-1">
          {pendingOpenArtifactId ? 'Lienzo' : 'AI Architect'}
        </p>
        <p className="text-lg font-bold text-gray-900 dark:text-white mb-1.5 text-center">
          {pendingOpenArtifactId ? 'Abriendo lienzo' : 'Generando artefacto'}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-4 leading-relaxed">
          {pendingOpenArtifactId ? 'Preparando la vista del artefacto recién generado…' : generatingMessage}
        </p>
        {!pendingOpenArtifactId && generationStage && (
          <p className="mb-4 text-center text-sm text-ai-700 dark:text-ai-300" data-generation-phase={generationStage}>
            <span aria-hidden className="mr-1.5">{GENERATION_PHASE_COPY[generationStage].icon}</span>
            <strong>{GENERATION_PHASE_COPY[generationStage].label}</strong>
            <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
              {GENERATION_PHASE_COPY[generationStage].description}
            </span>
          </p>
        )}
        <div className="w-full h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div className="h-full w-full progress-indeterminate" />
        </div>
        {!pendingOpenArtifactId && (
          <div className="mt-4 w-full text-center">
            <span className="font-mono text-2xs text-gray-500">{generationElapsedSec}s transcurridos</span>
            {generationElapsedSec >= 20 && (
              <button
                type="button"
                onClick={onDismiss}
                className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-white dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                Recuperar acceso al workspace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
