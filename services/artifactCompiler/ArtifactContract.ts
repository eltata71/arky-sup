/**
 * Formal artifact contracts.
 *
 * A contract is the declarative specification a family of artifacts must meet
 * to be considered world-class: which sections it needs, how complete it must
 * be, whether it is exportable, and which thresholds gate its score.
 *
 * Contracts are pure data — the validators, repairers and scorer interpret
 * them. Diagram contracts intentionally delegate quality scoring to the
 * existing deterministic diagram pipeline (`delegatesToDiagramGate`).
 */

import type { ArtifactType } from '../../types';
import type { CompilerIssueSeverity } from './ArtifactCompilerTypes';

export type ArtifactRepresentation = 'document' | 'diagram' | 'hybrid';

export type SectionRequirement = 'required' | 'recommended';

/**
 * A section the contract expects. Detection is keyword-based against headings
 * and emphasised body text, mirroring the existing document quality service so
 * the two layers agree.
 */
export interface ContractSection {
  id: string;
  /** Human-facing label (Spanish-first). */
  label: string;
  /** Normalised keywords used to detect the section. Bilingual (es/en). */
  keywords: string[];
  requirement: SectionRequirement;
  /** Severity raised when a `required` section is missing. Default: 'high'. */
  severity?: CompilerIssueSeverity;
  /** Optional scaffolding used by safe repair when the section is missing. */
  repairTemplate?: { heading: string; body: string };
}

export interface ContractRules {
  /** The document must contain at least one heading. */
  requireHeadings: boolean;
  /** A top-level H1 title is expected. */
  requireTitle: boolean;
  /** Unresolved TBD/TODO/FIXME markers count against the artifact. */
  forbidPlaceholders: boolean;
  /** The artifact is expected to carry at least one Markdown table. */
  expectsTables: boolean;
  /** The artifact is expected to use Gherkin (Given/When/Then). */
  expectsGherkin: boolean;
  /** The artifact is expected to carry a traceability matrix table. */
  expectsTraceabilityTable: boolean;
  /**
   * Whether safe repair may scaffold missing sections with controlled
   * "_Pendiente_" placeholders. Off for diagrams and audience-sensitive docs.
   */
  allowSectionScaffolding: boolean;
}

export interface ContractThresholds {
  /** Minimum unified score recommended for this family. */
  recommended: number;
  /** Minimum unified score required before export is allowed. */
  exportFloor: number;
}

export interface ArtifactContract {
  id: string;
  label: string;
  /** Explicit artifact types this contract governs. */
  appliesTo: ArtifactType[];
  /** Optional glob pattern (`mermaid-*`) used when no explicit type matches. */
  pattern?: string;
  representation: ArtifactRepresentation;
  defaultAudience: 'executive' | 'technical' | 'operations' | 'mixed';
  /** Ordered list of expected sections. */
  sections: ContractSection[];
  /** Minimum word count for "contenido mínimo suficiente". */
  minWordCount: number;
  rules: ContractRules;
  thresholds: ContractThresholds;
  /**
   * When true, diagram quality is owned by the existing diagram quality gate;
   * the compiler does not re-validate or repair diagram structure.
   */
  delegatesToDiagramGate: boolean;
  /** Static recommendations surfaced for this family regardless of findings. */
  automaticRecommendations: { id: string; title: string; detail: string }[];
}

/** Normalise text for keyword detection (lowercase, strip diacritics). */
export const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Does an artifact type match a contract glob pattern (`prefix-*`)? */
export const matchesPattern = (pattern: string, artifactType: string): boolean => {
  if (pattern.endsWith('*')) {
    return artifactType.startsWith(pattern.slice(0, -1));
  }
  return pattern === artifactType;
};

const SEVERITY_RANK: Record<CompilerIssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Sort issues most-severe first; used across the compiler. */
export const compareSeverity = (a: CompilerIssueSeverity, b: CompilerIssueSeverity): number =>
  SEVERITY_RANK[a] - SEVERITY_RANK[b];
