/**
 * Contract registry — resolves the {@link ArtifactContract} that governs a
 * given artifact type.
 *
 * Resolution order:
 *  1. Explicit `appliesTo` match.
 *  2. Glob `pattern` match (e.g. `mermaid-*`).
 *  3. Type-shape fallback: diagram-ish types get the diagram fallback,
 *     everything else gets the document fallback.
 *
 * Resolution is deterministic and never throws, guaranteeing the compiler can
 * always proceed even for artifact types added in the future.
 */

import type { ArtifactType } from '../../types';
import type { ArtifactContract } from './ArtifactContract';
import { matchesPattern } from './ArtifactContract';
import {
  ARTIFACT_CONTRACTS,
  FALLBACK_DIAGRAM_CONTRACT,
  FALLBACK_DOCUMENT_CONTRACT,
} from './profiles';

const EXPLICIT_INDEX = new Map<ArtifactType, ArtifactContract>();
for (const contract of ARTIFACT_CONTRACTS) {
  for (const type of contract.appliesTo) EXPLICIT_INDEX.set(type, contract);
}

const PATTERN_CONTRACTS = ARTIFACT_CONTRACTS.filter((c) => Boolean(c.pattern));

const looksLikeDiagram = (artifactType: string): boolean =>
  artifactType.startsWith('mermaid') || artifactType === 'react-flow-graph';

/** Resolve the contract for an artifact type. Always returns a contract. */
export const resolveContract = (artifactType: ArtifactType): ArtifactContract => {
  const explicit = EXPLICIT_INDEX.get(artifactType);
  if (explicit) return explicit;

  for (const contract of PATTERN_CONTRACTS) {
    if (contract.pattern && matchesPattern(contract.pattern, artifactType)) {
      return contract;
    }
  }

  return looksLikeDiagram(artifactType) ? FALLBACK_DIAGRAM_CONTRACT : FALLBACK_DOCUMENT_CONTRACT;
};

/** Resolve a contract by its stable id. Returns `undefined` when unknown. */
export const getContractById = (contractId: string): ArtifactContract | undefined => {
  if (contractId === FALLBACK_DOCUMENT_CONTRACT.id) return FALLBACK_DOCUMENT_CONTRACT;
  if (contractId === FALLBACK_DIAGRAM_CONTRACT.id) return FALLBACK_DIAGRAM_CONTRACT;
  return ARTIFACT_CONTRACTS.find((c) => c.id === contractId);
};

/** List every registered contract (excludes the two fallbacks). */
export const listContracts = (): readonly ArtifactContract[] => ARTIFACT_CONTRACTS;
