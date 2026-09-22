import type { Settings } from '../../types';
import type { ArtifactGenerationPhaseEvent, ArtifactGenerationPhaseListener } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import { buildDeterministicArtifactBrief } from './artifactBriefService';
import {
  mergeArtifactGenerationContracts,
  validateArtifactGenerationContract,
  type ArtifactGenerationContract,
  type ArtifactGenerationContractProposal,
} from './artifactGenerationContract';
import { getArtifactGenerationFeatureFlags } from './artifactGenerationFlags';

/** Input handed to a brief AI proposer (typically Gemini-backed). */
export interface BriefAiProposerInput {
  project: Project;
  request: string;
  deterministicContract: ArtifactGenerationContract;
  settings: Settings;
  timeoutMs?: number;
}

export interface BriefAiProposerOutput {
  proposal: ArtifactGenerationContractProposal;
  rawResponse?: string;
}

/**
 * A pluggable function that proposes contract improvements. The default
 * implementation lazily delegates to `geminiService` so this module stays
 * unit-testable without loading the AI stack; tests inject a fake proposer.
 */
export type BriefAiProposer = (input: BriefAiProposerInput) => Promise<BriefAiProposerOutput>;

export interface ExtractArtifactBriefWithAIInput {
  project: Project;
  request: string;
  /** Pre-built deterministic contract. Built on demand when omitted. */
  deterministicContract?: ArtifactGenerationContract;
  settings: Settings;
  onPhase?: ArtifactGenerationPhaseListener;
  /** Injectable proposer (defaults to the Gemini-backed one). */
  proposer?: BriefAiProposer;
  /** Overrides the `VITE_AI_BRIEF_EXTRACTION_ENABLED` feature flag. */
  aiEnabled?: boolean;
  /** Hard ceiling for the AI hop; degrades to deterministic on timeout. */
  timeoutMs?: number;
}

export interface ExtractArtifactBriefWithAIResult {
  contract: ArtifactGenerationContract;
  source: 'deterministic' | 'ai-assisted';
  warnings: string[];
  acceptedAiFields: string[];
  rejectedAiFields: string[];
  rawAiResponse?: string;
}

const DEFAULT_AI_TIMEOUT_MS = 40000;

/**
 * Proponente cargado en diferido — mantiene la pila de IA fuera del camino de
 * pruebas y del chunk inicial.
 *
 * Entra por `artifactGenerationService`, la fachada, y no por el motor. Antes
 * importaba `services/geminiService` directamente: un `import()` dinámico se
 * salta `no-restricted-imports`, así que la regla que dice que nadie fuera de
 * `services/ai` toca el motor se cumplía en todas partes menos aquí, y en
 * silencio.
 */
const defaultGeminiBriefProposer: BriefAiProposer = async (input) => {
  const { artifactGenerationService } = await import('../ai');
  return artifactGenerationService.proposeArtifactBriefContract(
    input.project,
    input.request,
    input.deterministicContract,
    input.settings,
    { timeoutMs: input.timeoutMs },
  );
};

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`La extracción IA del brief excedió ${ms}ms.`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });

/**
 * Extracts a structured artifact brief.
 *
 *  1. Always builds a deterministic contract first (trusted base).
 *  2. When AI extraction is disabled, returns the deterministic contract.
 *  3. When enabled, asks the proposer to improve it, then merges/validates the
 *     proposal — the AI complements the deterministic contract, it never
 *     replaces it blindly.
 *  4. On any failure (timeout, malformed output, invalid merge) it degrades to
 *     the deterministic contract and records a non-blocking warning.
 *
 * This function never throws and never blocks the request flow.
 */
export const extractArtifactBriefWithAI = async (
  input: ExtractArtifactBriefWithAIInput,
): Promise<ExtractArtifactBriefWithAIResult> => {
  const { project, request, settings, onPhase } = input;
  const emit = (event: Omit<ArtifactGenerationPhaseEvent, 'at'>): void => {
    try {
      onPhase?.({ ...event, at: new Date().toISOString() });
    } catch {
      /* a misbehaving listener must never break extraction */
    }
  };

  const deterministic = input.deterministicContract
    ?? buildDeterministicArtifactBrief(project, request, { language: settings.language === 'en' ? 'en' : 'es' });

  const aiEnabled = input.aiEnabled ?? getArtifactGenerationFeatureFlags().aiBriefExtraction;

  if (!aiEnabled) {
    emit({
      stage: 'recommendation',
      status: 'success',
      message: 'brief.extracted.deterministic',
      detail: 'Extracción IA deshabilitada; se usó el contrato determinístico.',
      meta: { contractId: deterministic.id, source: 'deterministic', aiBriefExtraction: false },
    });
    return { contract: deterministic, source: 'deterministic', warnings: [], acceptedAiFields: [], rejectedAiFields: [] };
  }

  emit({
    stage: 'recommendation',
    status: 'in-progress',
    message: 'brief.extracted.ai-started',
    detail: 'Solicitando a la IA una propuesta de mejora del contrato determinístico.',
    meta: { contractId: deterministic.id, aiBriefExtraction: true },
  });

  const proposer = input.proposer ?? defaultGeminiBriefProposer;
  const timeoutMs = input.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;

  try {
    const { proposal, rawResponse } = await withTimeout(
      proposer({ project, request, deterministicContract: deterministic, settings, timeoutMs }),
      timeoutMs,
    );

    const merge = mergeArtifactGenerationContracts({ deterministic, aiCandidate: proposal, project });
    const validationErrors = validateArtifactGenerationContract(merge.contract);

    if (validationErrors.length > 0) {
      emit({
        stage: 'recommendation',
        status: 'warning',
        message: 'brief.extracted.ai-invalid',
        detail: `La propuesta IA produjo un contrato inválido; se conserva el determinístico. ${validationErrors.join(' ')}`,
        meta: { contractId: deterministic.id, source: 'deterministic' },
      });
      return {
        contract: deterministic,
        source: 'deterministic',
        warnings: ['La propuesta IA fue inválida; se usó el contrato determinístico.', ...validationErrors],
        acceptedAiFields: [],
        rejectedAiFields: merge.rejectedAiFields,
        rawAiResponse: rawResponse,
      };
    }

    const aiContributed = merge.acceptedAiFields.length > 0;
    emit({
      stage: 'recommendation',
      status: 'success',
      message: 'brief.extracted.ai-success',
      detail: aiContributed
        ? `La IA mejoró ${merge.acceptedAiFields.length} campo(s): ${merge.acceptedAiFields.join(', ')}.`
        : 'La IA no aportó mejoras válidas; el contrato determinístico se mantiene.',
      meta: {
        contractId: merge.contract.id,
        acceptedAiFields: merge.acceptedAiFields.length,
        rejectedAiFields: merge.rejectedAiFields.length,
      },
    });
    emit({
      stage: 'recommendation',
      status: 'success',
      message: 'brief.contract.merged',
      detail: 'Contrato IA fusionado de forma segura con el contrato determinístico.',
      meta: { contractId: merge.contract.id, source: aiContributed ? 'ai-assisted' : 'deterministic' },
    });

    return {
      contract: merge.contract,
      source: aiContributed ? 'ai-assisted' : 'deterministic',
      warnings: merge.warnings,
      acceptedAiFields: merge.acceptedAiFields,
      rejectedAiFields: merge.rejectedAiFields,
      rawAiResponse: rawResponse,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({
      stage: 'recommendation',
      status: 'warning',
      message: 'brief.extracted.ai-failed-non-blocking',
      detail: `La extracción IA falló sin bloquear el flujo: ${message}`,
      meta: { contractId: deterministic.id, source: 'deterministic' },
    });
    return {
      contract: deterministic,
      source: 'deterministic',
      warnings: [`La extracción IA falló y se usó el contrato determinístico: ${message}`],
      acceptedAiFields: [],
      rejectedAiFields: [],
    };
  }
};
