/**
 * Pure, reusable helpers for exploring artifacts in the Project Hub:
 *  - resolving the "last activity" date of an artifact,
 *  - selecting the most recently generated/modified artifact,
 *  - sorting artifacts and catalog templates by a shared, extensible set
 *    of criteria.
 *
 * Keeping this logic out of the components avoids duplication between the
 * "Mis artefactos" and "Catálogo" surfaces and keeps JSX declarative.
 */

import type { ArtifactTemplate } from '../types';
import type { Artifact } from '../lib/artifacts';
import { KANBAN_COLUMNS } from '../constants';
import { sortTemplatesByRoadmap } from '../lib/artifacts/artifactGovernance';
import { toValidDate, type DateLike } from './datetime';

// --- Phase labels ---------------------------------------------------------

/**
 * Maps a raw phase string (Kanban column id) to the short, human label used
 * across the exploration surfaces. Centralized so every card/table/chip stays
 * consistent.
 */
export function getPhaseLabel(phase: string): string {
  if (!phase) return 'General';
  if (phase.includes('SDD')) return 'SDD';
  if (phase.includes('Fase 1')) return 'Estrategia';
  if (phase.includes('Fase 2')) return 'Lógica';
  if (phase.includes('Fase 3')) return 'Física';
  if (phase.includes('Fase 4')) return 'Implementación';
  return 'General';
}

/** Stable ordering rank for a phase, based on the canonical roadmap. */
function getPhaseRank(phase: string): number {
  const index = KANBAN_COLUMNS.indexOf(phase);
  return index === -1 ? KANBAN_COLUMNS.length : index;
}

// --- Last activity --------------------------------------------------------

/**
 * Date fields that may carry "last activity" information on an artifact.
 * `createdAt` is the only field guaranteed by the current model; the rest are
 * read defensively so the helper keeps working if the model gains explicit
 * `updatedAt`/`lastModified`/`generatedAt` fields later.
 */
function collectArtifactDateCandidates(artifact: Artifact): DateLike[] {
  const loose = artifact as Artifact & Record<string, unknown>;
  return [
    loose.updatedAt as DateLike,
    loose.lastModified as DateLike,
    loose.generatedAt as DateLike,
    artifact.generationTrace?.completedAt,
    artifact.generationTrace?.startedAt,
    artifact.createdAt,
  ];
}

/**
 * Resolves the most recent "activity" date for an artifact across every
 * available date field. Returns `null` when no usable date is present.
 */
export function getArtifactActivityDate(artifact: Artifact): Date | null {
  let latest: Date | null = null;
  for (const candidate of collectArtifactDateCandidates(artifact)) {
    const parsed = toValidDate(candidate);
    if (parsed && (!latest || parsed.getTime() > latest.getTime())) {
      latest = parsed;
    }
  }
  return latest;
}

/** Numeric timestamp for the artifact's last activity (0 when unknown). */
export function getArtifactActivityTimestamp(artifact: Artifact): number {
  return getArtifactActivityDate(artifact)?.getTime() ?? 0;
}

/**
 * Selects the most recently generated or modified artifact from a list.
 * The caller is expected to pass the latest-version artifacts. Returns `null`
 * for an empty list.
 */
export function getLatestArtifact(artifacts: Artifact[]): Artifact | null {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;

  return artifacts.reduce<Artifact | null>((latest, current) => {
    if (!latest) return current;
    return getArtifactActivityTimestamp(current) >= getArtifactActivityTimestamp(latest)
      ? current
      : latest;
  }, null);
}

// --- Sorting --------------------------------------------------------------

/** Identifier for an artifact sort criterion. Extend the union to add more. */
export type ArtifactSortKey =
  | 'ai-recommended'
  | 'recent-desc'
  | 'recent-asc'
  | 'phase'
  | 'type'
  | 'name-asc'
  | 'name-desc'
  | 'version-desc';

export interface ArtifactSortOption {
  key: ArtifactSortKey;
  label: string;
  /** Whether the criterion produces a meaningful order for catalog templates. */
  appliesToTemplates: boolean;
}

/** Default sort for "Mis artefactos": newest activity first. */
export const DEFAULT_ARTIFACT_SORT: ArtifactSortKey = 'recent-desc';

/** Default sort for the catalog: AI-recommended generation sequence per phase. */
export const DEFAULT_TEMPLATE_SORT: ArtifactSortKey = 'ai-recommended';

/**
 * Catalog of available sort criteria. New criteria only need an entry here
 * plus a `case` in {@link sortArtifacts} / {@link sortTemplates}.
 */
export const ARTIFACT_SORT_OPTIONS: ArtifactSortOption[] = [
  { key: 'ai-recommended', label: 'Secuencia recomendada por IA', appliesToTemplates: true },
  { key: 'recent-desc', label: 'Más reciente primero', appliesToTemplates: false },
  { key: 'recent-asc', label: 'Más antiguo primero', appliesToTemplates: false },
  { key: 'phase', label: 'Fase', appliesToTemplates: true },
  { key: 'type', label: 'Tipo de artefacto', appliesToTemplates: true },
  { key: 'name-asc', label: 'Nombre (A-Z)', appliesToTemplates: true },
  { key: 'name-desc', label: 'Nombre (Z-A)', appliesToTemplates: true },
  { key: 'version-desc', label: 'Versión', appliesToTemplates: false },
];

/** Locale-aware, case-insensitive comparison of two display names. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

/**
 * Returns a new array of artifacts ordered by the given criterion. Ties always
 * fall back to name (A-Z) so the order is deterministic.
 */
export function sortArtifacts(artifacts: Artifact[], key: ArtifactSortKey): Artifact[] {
  const list = [...artifacts];

  switch (key) {
    case 'recent-asc':
      return list.sort(
        (a, b) =>
          getArtifactActivityTimestamp(a) - getArtifactActivityTimestamp(b) ||
          compareNames(a.name, b.name),
      );
    case 'phase':
      return list.sort(
        (a, b) => getPhaseRank(a.phase) - getPhaseRank(b.phase) || compareNames(a.name, b.name),
      );
    case 'type':
      return list.sort(
        (a, b) => compareNames(a.type, b.type) || compareNames(a.name, b.name),
      );
    case 'name-asc':
      return list.sort((a, b) => compareNames(a.name, b.name));
    case 'name-desc':
      return list.sort((a, b) => compareNames(b.name, a.name));
    case 'version-desc':
      return list.sort((a, b) => b.version - a.version || compareNames(a.name, b.name));
    case 'recent-desc':
    default:
      return list.sort(
        (a, b) =>
          getArtifactActivityTimestamp(b) - getArtifactActivityTimestamp(a) ||
          compareNames(a.name, b.name),
      );
  }
}

/**
 * Returns a new array of catalog templates ordered by the given criterion.
 * Criteria that have no meaning for templates (recent/version) leave the
 * incoming order untouched, so the caller's roadmap ordering is preserved.
 */
export function sortTemplates(
  templates: ArtifactTemplate[],
  key: ArtifactSortKey,
): ArtifactTemplate[] {
  const list = [...templates];

  switch (key) {
    case 'ai-recommended':
      // Roadmap order = phase → architectural priority → name. This is the
      // dependency-aware sequence published by the governance service so the
      // catalog encourages generating artifacts in a consistent order.
      return sortTemplatesByRoadmap(list);
    case 'phase':
      return list.sort(
        (a, b) => getPhaseRank(a.phase) - getPhaseRank(b.phase) || compareNames(a.name, b.name),
      );
    case 'type':
      return list.sort(
        (a, b) => compareNames(a.type, b.type) || compareNames(a.name, b.name),
      );
    case 'name-asc':
      return list.sort((a, b) => compareNames(a.name, b.name));
    case 'name-desc':
      return list.sort((a, b) => compareNames(b.name, a.name));
    case 'recent-desc':
    case 'recent-asc':
    case 'version-desc':
    default:
      return list;
  }
}

// --- Generation origin ----------------------------------------------------

/**
 * High-level provenance of an artifact. Derived from the optional
 * {@link ArtifactGenerationTrace.source} when present; legacy artifacts
 * without a trace report `'unknown'`.
 */
export type ArtifactOriginKind = 'catalog' | 'on-demand' | 'regeneration' | 'unknown';

export interface ArtifactOriginInfo {
  kind: ArtifactOriginKind;
  /** Short label suitable for a chip/badge in the artifact list. */
  label: string;
  /** Sentence-length description for tooltips and detail surfaces. */
  description: string;
}

/**
 * Resolves how an artifact was created so the exploration surface can show a
 * lightweight provenance badge. The data lives in `generationTrace.source`;
 * artifacts persisted before tracing existed simply return `'unknown'`.
 */
export function getArtifactOrigin(artifact: Artifact): ArtifactOriginInfo {
  const rawSource = artifact.generationTrace?.source;
  const requestContext = artifact.generationTrace?.request;

  // Legacy artifacts created before generationTrace existed sometimes still
  // carry a requestContext on the matching artifact-shaped record; treat that
  // as the on-demand signal so the badge stays consistent.
  const kind: ArtifactOriginKind = rawSource && rawSource !== 'unknown'
    ? rawSource
    : requestContext
      ? 'on-demand'
      : 'unknown';

  switch (kind) {
    case 'catalog':
      return {
        kind,
        label: 'Catálogo',
        description: 'Generado desde una plantilla del catálogo arquitectónico.',
      };
    case 'on-demand':
      return {
        kind,
        label: 'A solicitud',
        description: 'Generado a partir de una solicitud personalizada del arquitecto.',
      };
    case 'regeneration':
      return {
        kind,
        label: 'Regenerado',
        description: 'Reescritura o nueva versión de un artefacto previo.',
      };
    case 'unknown':
    default:
      return {
        kind: 'unknown',
        label: 'Sin trazabilidad',
        description: 'No hay registro del modo de generación (artefacto histórico o importado).',
      };
  }
}
