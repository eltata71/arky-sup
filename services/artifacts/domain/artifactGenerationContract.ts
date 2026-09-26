import type { Project } from '../../architectureProjects';

import type {
  ArtifactAudience,
  ArtifactDetailLevel,
  ArtifactFamilyPreference,
  ArtifactGenerationContract,
  ArtifactPurpose,
  ArtifactVisualPreferences,
} from '../../../types';

// Las declaraciones viven en `types.ts` (F3-07): `ArtifactTemplate` ya las
// transporta en `requestContext`, y `types.ts` no puede importar de un contexto
// de dominio. Aquí queda el comportamiento — normalizar, validar, fusionar.
export type {
  ArtifactAudience,
  ArtifactDetailLevel,
  ArtifactFamilyPreference,
  ArtifactGenerationContract,
  ArtifactPurpose,
  ArtifactVisualPreferences,
};

/**
 * Hard floor for `qualityTarget`. The structured brief never lets an AI
 * proposal (or a merge) drop the bar below this value — see
 * {@link validateArtifactGenerationContract} and
 * {@link mergeArtifactGenerationContracts}.
 */
export const MIN_ARTIFACT_QUALITY_TARGET = 70;

/** Allowed enum values, used to reject malformed AI proposals. */
const AUDIENCE_VALUES: readonly ArtifactAudience[] = ['executive', 'technical', 'operations', 'business', 'mixed'];
const FAMILY_VALUES: readonly ArtifactFamilyPreference[] = ['auto', 'document', 'diagram', 'hybrid', 'table', 'matrix', 'presentation'];
const PURPOSE_VALUES: readonly ArtifactPurpose[] = ['decision', 'explanation', 'design', 'implementation', 'analysis', 'governance', 'comparison', 'validation', 'communication'];
const DETAIL_VALUES: readonly ArtifactDetailLevel[] = ['executive', 'conceptual', 'logical', 'physical', 'technical', 'deep-technical'];

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const unique = (values: string[]): string[] => Array.from(new Set(values.map(value => value.trim()).filter(nonEmpty)));

/** A partial, untrusted contract candidate (typically produced by AI extraction). */
export type ArtifactGenerationContractProposal = Partial<ArtifactGenerationContract>;

const DIACRITICS = /[\u0300-\u036f]/g;

const tokenSet = (value: string): Set<string> => new Set(
  value.normalize('NFD').replace(DIACRITICS, '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3),
);

/** Share of `candidate` tokens also present in `reference`, in [0..1]. */
const tokenCoverage = (candidate: string, reference: string): number => {
  const candidateTokens = tokenSet(candidate);
  if (candidateTokens.size === 0) return 0;
  const referenceTokens = tokenSet(reference);
  let shared = 0;
  for (const token of candidateTokens) {
    if (referenceTokens.has(token)) shared += 1;
  }
  return shared / candidateTokens.size;
};

export const normalizeArtifactGenerationContract = (contract: ArtifactGenerationContract): ArtifactGenerationContract => {
  // Exclusion always wins: a source the user excluded can never resurface as
  // required/optional, even if another layer (AI proposal, legacy edit) added
  // it back. This keeps excluded sources out of the controlled context.
  const excluded = unique(contract.excludedSourceArtifactIds);
  const required = unique(contract.requiredSourceArtifactIds).filter(id => !excluded.includes(id));
  const optional = unique(contract.optionalSourceArtifactIds).filter(id => !required.includes(id) && !excluded.includes(id));
  return {
    ...contract,
    originalRequest: contract.originalRequest.trim(),
    normalizedIntent: contract.normalizedIntent.trim() || contract.originalRequest.trim(),
    requiredSourceArtifactIds: required,
    optionalSourceArtifactIds: optional,
    excludedSourceArtifactIds: excluded,
    requiredContextItems: unique(contract.requiredContextItems),
    excludedContextItems: unique(contract.excludedContextItems),
    acceptanceCriteria: unique(contract.acceptanceCriteria),
    exportTargets: unique(contract.exportTargets),
    qualityTarget: Math.max(0, Math.min(100, Math.round(contract.qualityTarget))),
  };
};

export const validateArtifactGenerationContract = (contract: ArtifactGenerationContract): string[] => {
  const errors: string[] = [];
  if (!contract.id.trim()) errors.push('El contrato requiere un identificador.');
  if (contract.originalRequest.trim().length < 20) errors.push('La solicitud debe tener al menos 20 caracteres.');
  if (!contract.normalizedIntent.trim()) errors.push('La intención normalizada es obligatoria.');
  if (contract.acceptanceCriteria.length === 0) errors.push('Define al menos un criterio mínimo de aceptación.');
  if (contract.qualityTarget < MIN_ARTIFACT_QUALITY_TARGET) errors.push(`El objetivo de calidad debe ser al menos ${MIN_ARTIFACT_QUALITY_TARGET}/100.`);
  return errors;
};

export interface MergeArtifactGenerationContractsInput {
  /** Trusted, always-valid base produced by deterministic extraction. */
  deterministic: ArtifactGenerationContract;
  /** Untrusted improvement proposal — typically the AI brief extraction. */
  aiCandidate?: ArtifactGenerationContractProposal;
  /** Edits the architect already applied in the wizard; these always win. */
  existingUserEdits?: ArtifactGenerationContractProposal;
  /** Project, used to reject AI-invented source ids. */
  project: Project;
}

export interface MergeArtifactGenerationContractsResult {
  contract: ArtifactGenerationContract;
  warnings: string[];
  acceptedAiFields: string[];
  rejectedAiFields: string[];
}

const isOneOf = <T,>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly unknown[]).includes(value);

const sanitizeStringList = (value: unknown): string[] =>
  Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === 'string')) : [];

/**
 * Safe, pure, fully testable merge of a deterministic contract with an
 * untrusted AI proposal and (optionally) edits the architect already applied.
 *
 * Invariants enforced here:
 *  - the original request is never replaced;
 *  - the normalized intent can only be improved if it still covers the
 *    original intent (token overlap guard);
 *  - acceptance criteria are merged, never silently dropped;
 *  - user-defined required/optional/excluded sources prevail;
 *  - excluded sources can never reappear as required/optional;
 *  - the AI cannot invent source artifacts that do not exist in the project;
 *  - the quality target can rise but never drop below the deterministic value;
 *  - the language is preserved from the deterministic contract.
 */
export const mergeArtifactGenerationContracts = (
  input: MergeArtifactGenerationContractsInput,
): MergeArtifactGenerationContractsResult => {
  const { deterministic, aiCandidate, existingUserEdits, project } = input;
  const warnings: string[] = [];
  const acceptedAiFields: string[] = [];
  const rejectedAiFields: string[] = [];
  const ai: ArtifactGenerationContractProposal = aiCandidate ?? {};
  const edits: ArtifactGenerationContractProposal = existingUserEdits ?? {};

  const projectArtifactIds = new Set((project.artifacts ?? []).map(artifact => artifact.id));
  const accept = (field: string) => { if (!acceptedAiFields.includes(field)) acceptedAiFields.push(field); };
  const reject = (field: string, reason: string) => {
    if (!rejectedAiFields.includes(field)) rejectedAiFields.push(field);
    warnings.push(`Campo IA "${field}" rechazado: ${reason}`);
  };

  // normalizedIntent — AI may sharpen it, but only if it still covers the
  // original request; otherwise the AI is reinterpreting, not improving.
  let normalizedIntent = deterministic.normalizedIntent;
  if (typeof ai.normalizedIntent === 'string' && ai.normalizedIntent.trim().length > 0) {
    const candidate = ai.normalizedIntent.trim();
    if (tokenCoverage(deterministic.originalRequest, candidate) >= 0.4) {
      if (candidate !== deterministic.normalizedIntent) accept('normalizedIntent');
      normalizedIntent = candidate;
    } else {
      reject('normalizedIntent', 'no conserva la intención original.');
    }
  }

  const mergeEnum = <T,>(field: keyof ArtifactGenerationContract, allowed: readonly T[], base: T): T => {
    let value = base;
    if (field in ai && ai[field] !== undefined) {
      if (isOneOf(ai[field], allowed)) {
        value = ai[field] as T;
        if (value !== base) accept(String(field));
      } else {
        reject(String(field), 'valor fuera del dominio permitido.');
      }
    }
    if (field in edits && edits[field] !== undefined && isOneOf(edits[field], allowed)) value = edits[field] as T;
    return value;
  };

  const audience = mergeEnum('audience', AUDIENCE_VALUES, deterministic.audience);
  const artifactFamily = mergeEnum('artifactFamily', FAMILY_VALUES, deterministic.artifactFamily);
  const purpose = mergeEnum('purpose', PURPOSE_VALUES, deterministic.purpose);
  const detailLevel = mergeEnum('detailLevel', DETAIL_VALUES, deterministic.detailLevel);

  // acceptanceCriteria — union of deterministic + AI + user edits. The AI can
  // enrich the list but never erase a deterministic criterion.
  const aiCriteria = sanitizeStringList(ai.acceptanceCriteria);
  if (aiCriteria.some(item => !deterministic.acceptanceCriteria.includes(item))) accept('acceptanceCriteria');
  const acceptanceCriteria = unique([
    ...deterministic.acceptanceCriteria,
    ...aiCriteria,
    ...sanitizeStringList(edits.acceptanceCriteria),
  ]);

  // exportTargets — union, AI may add formats consistent with the family.
  const aiExportTargets = sanitizeStringList(ai.exportTargets);
  if (aiExportTargets.some(item => !deterministic.exportTargets.includes(item))) accept('exportTargets');
  const exportTargets = unique([
    ...deterministic.exportTargets,
    ...aiExportTargets,
    ...sanitizeStringList(edits.exportTargets),
  ]);

  // Context items — AI may add textual context, user edits prevail.
  const aiRequiredContext = sanitizeStringList(ai.requiredContextItems);
  if (aiRequiredContext.some(item => !deterministic.requiredContextItems.includes(item))) accept('requiredContextItems');
  const requiredContextItems = unique([
    ...deterministic.requiredContextItems,
    ...aiRequiredContext,
    ...sanitizeStringList(edits.requiredContextItems),
  ]);
  const excludedContextItems = unique([
    ...deterministic.excludedContextItems,
    ...sanitizeStringList(ai.excludedContextItems),
    ...sanitizeStringList(edits.excludedContextItems),
  ]);

  // Sources — user-defined selection prevails. The AI may only *suggest*
  // required/optional ids that genuinely exist in the project, and can never
  // touch the exclusion set (handled by normalize: exclusion wins).
  const userExcluded = sanitizeStringList(edits.excludedSourceArtifactIds ?? deterministic.excludedSourceArtifactIds);
  const aiSuggestedSources = [
    ...sanitizeStringList(ai.requiredSourceArtifactIds),
    ...sanitizeStringList(ai.optionalSourceArtifactIds),
  ];
  const invalidAiSources = aiSuggestedSources.filter(id => !projectArtifactIds.has(id));
  if (invalidAiSources.length > 0) {
    reject('sourceArtifactIds', `la IA propuso fuentes inexistentes (${invalidAiSources.join(', ')}).`);
  }
  const requiredSourceArtifactIds = unique([
    ...sanitizeStringList(edits.requiredSourceArtifactIds ?? deterministic.requiredSourceArtifactIds),
    ...sanitizeStringList(ai.requiredSourceArtifactIds).filter(id => projectArtifactIds.has(id) && !userExcluded.includes(id)),
  ]);
  const optionalSourceArtifactIds = unique([
    ...sanitizeStringList(edits.optionalSourceArtifactIds ?? deterministic.optionalSourceArtifactIds),
    ...sanitizeStringList(ai.optionalSourceArtifactIds).filter(id => projectArtifactIds.has(id) && !userExcluded.includes(id)),
  ]);

  // qualityTarget — never drops below the deterministic floor.
  let qualityTarget = deterministic.qualityTarget;
  if (typeof ai.qualityTarget === 'number' && Number.isFinite(ai.qualityTarget)) {
    if (ai.qualityTarget >= deterministic.qualityTarget) {
      if (ai.qualityTarget > deterministic.qualityTarget) accept('qualityTarget');
      qualityTarget = ai.qualityTarget;
    } else {
      reject('qualityTarget', `no puede bajar de ${deterministic.qualityTarget}.`);
    }
  }
  if (typeof edits.qualityTarget === 'number' && Number.isFinite(edits.qualityTarget)) {
    qualityTarget = Math.max(deterministic.qualityTarget, edits.qualityTarget);
  }

  // visualPreferences — shallow merge, deterministic as base.
  let visualPreferences = deterministic.visualPreferences;
  if (ai.visualPreferences && typeof ai.visualPreferences === 'object') {
    visualPreferences = { ...visualPreferences, ...ai.visualPreferences };
    accept('visualPreferences');
  }
  if (edits.visualPreferences && typeof edits.visualPreferences === 'object') {
    visualPreferences = { ...visualPreferences, ...edits.visualPreferences };
  }

  const contract = normalizeArtifactGenerationContract({
    ...deterministic,
    normalizedIntent,
    audience,
    artifactFamily,
    purpose,
    detailLevel,
    requiredSourceArtifactIds,
    optionalSourceArtifactIds,
    excludedSourceArtifactIds: userExcluded,
    requiredContextItems,
    excludedContextItems,
    acceptanceCriteria,
    exportTargets,
    visualPreferences,
    qualityTarget,
    updatedAt: new Date().toISOString(),
  });

  return { contract, warnings, acceptedAiFields, rejectedAiFields };
};
