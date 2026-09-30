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
import { disciplineForTemplate } from '../../lib/artifacts/documentDisciplines';
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

const TEMPLATE_CONTRACTS = new Map<string, ArtifactContract>();

/**
 * A catalogue document's own contract, built from its discipline (plan de
 * calidad de artefactos, 7.4a): the generic document contract's rules and
 * thresholds, with the discipline's sections and content rules in place of
 * the generic objective/context/scope. Sections carry no scaffolding: a
 * missing decision or recovery objective is reported, never filled with a
 * placeholder that looks like one.
 */
const templateContract = (templateName: string | undefined, artifactType: ArtifactType): ArtifactContract | undefined => {
  const discipline = disciplineForTemplate(templateName);
  if (!discipline) return undefined;
  const cached = TEMPLATE_CONTRACTS.get(discipline.templateName);
  if (cached) return cached;
  const base = EXPLICIT_INDEX.get(artifactType) ?? FALLBACK_DOCUMENT_CONTRACT;
  const contract: ArtifactContract = {
    ...base,
    id: `contract.template.${discipline.templateName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    label: discipline.label,
    appliesTo: [artifactType],
    sections: discipline.sections.map((section) => ({
      id: section.id,
      label: section.label,
      keywords: [...section.keywords],
      requirement: section.requirement,
      severity: section.requirement === 'required' ? 'high' : 'low',
    })),
    contentRules: discipline.rules,
    automaticRecommendations: [],
  };
  TEMPLATE_CONTRACTS.set(discipline.templateName, contract);
  return contract;
};

/**
 * Resolve the contract for an artifact. A catalogue document with a declared
 * discipline gets its own contract, by template name; everything else
 * resolves by type. Always returns a contract.
 */
export const resolveContract = (artifactType: ArtifactType, templateName?: string): ArtifactContract => {
  const byTemplate = templateContract(templateName, artifactType);
  if (byTemplate) return byTemplate;
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
