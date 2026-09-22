/**
 * Resolve an artifact reference from a free-form user instruction.
 *
 * The Arquitecto Agente (in global mode) doesn't have an "active artifact" — when the user says
 * "mejora el diagrama de integración" we need to find the actual artifact in
 * the project. This module returns:
 *
 *  - a single best-match artifact when one is clearly identifiable,
 *  - a candidate list when the reference is ambiguous (lets the UI render a
 *    selection card),
 *  - `null` when nothing matches (the caller decides whether to fall back to
 *    a create flow or surface an error).
 *
 * Always operates over the latest-version snapshot of each artifact group —
 * we never act on historical versions implicitly.
 */

import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';

export interface ArtifactReferenceResolution {
  /** The best-match artifact when the reference is unambiguous. */
  resolved: Artifact | null;
  /** Latest-version artifacts that match the instruction. May be empty. */
  candidates: Artifact[];
  /** When false, the caller should surface a selector card. */
  unambiguous: boolean;
}

const STOP = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con', 'sin',
  'y', 'o', 'u', 'e', 'que', 'como', 'se', 'su', 'sus',
  'es', 'son', 'mas', 'menos',
  'mi', 'tu', 'me', 'te', 'le', 'lo',
  'mejora', 'mejorar', 'modifica', 'modificar', 'regenera', 'regenerar',
  'cambia', 'cambiar', 'actualiza', 'actualizar', 'corrige', 'corregir',
  'incluye', 'incluir', 'agrega', 'agregar', 'añade', 'anade',
  'artefacto', 'artefactos',
]);

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡!?.,;:"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenise = (text: string): string[] =>
  normalise(text)
    .split(' ')
    .filter((tok) => tok.length >= 3 && !STOP.has(tok));

const latestArtifactsByGroup = (project: Project): Artifact[] => {
  const latest = new Map<string, Artifact>();
  for (const a of project.artifacts) {
    const current = latest.get(a.versionGroupId);
    if (!current || a.version > current.version) latest.set(a.versionGroupId, a);
  }
  return Array.from(latest.values());
};

/**
 * Detects "el más reciente / la última versión / el último diagrama"
 * references that should pin to the most recently created artifact.
 */
const wantsLatestReference = (normalised: string): boolean =>
  /\b(mas reciente|ultim[oa] (artefacto|diagrama|documento|versi[oó]n)|el (ultimo|mas reciente))\b/.test(normalised);

/**
 * Score artifacts against the user's tokens. A high score means a confident
 * match. We deliberately match on both `name` and `type` tokens — the user
 * might say "diagrama de contexto" (name) or "C4 N1" (type/keyword).
 */
const scoreArtifact = (artifact: Artifact, tokens: string[]): number => {
  if (tokens.length === 0) return 0;
  const nameTokens = new Set(tokenise(artifact.name));
  const typeTokens = new Set(tokenise(artifact.type.replace(/-/g, ' ')));
  const viewTokens = new Set(tokenise(artifact.architecturalView));

  let nameHits = 0;
  let typeHits = 0;
  let viewHits = 0;
  for (const tok of tokens) {
    if (nameTokens.has(tok)) nameHits += 1;
    else if (typeTokens.has(tok)) typeHits += 1;
    else if (viewTokens.has(tok)) viewHits += 1;
  }

  // Name dominates; type and view are corroborating signals.
  const nameScore = nameTokens.size > 0 ? nameHits / Math.max(1, nameTokens.size) : 0;
  const typeScore = typeTokens.size > 0 ? typeHits / Math.max(1, typeTokens.size) : 0;
  const viewScore = viewTokens.size > 0 ? viewHits / Math.max(1, viewTokens.size) : 0;

  return nameScore * 0.7 + typeScore * 0.2 + viewScore * 0.1;
};

const sortByActivityDescending = (artifacts: Artifact[]): Artifact[] =>
  artifacts
    .slice()
    .sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));

/**
 * Resolve a reference. The threshold for "unambiguous" is intentionally
 * generous: when only one artifact passes the base threshold it wins outright;
 * when more than one is close (within a small delta) we hand back the list so
 * the user can pick.
 */
export function resolveArtifactReference(project: Project, instruction: string): ArtifactReferenceResolution {
  const latest = latestArtifactsByGroup(project);
  if (latest.length === 0) {
    return { resolved: null, candidates: [], unambiguous: false };
  }

  const normalised = normalise(instruction);
  if (wantsLatestReference(normalised)) {
    const recent = sortByActivityDescending(latest)[0];
    return { resolved: recent, candidates: [recent], unambiguous: true };
  }

  const tokens = tokenise(instruction);
  if (tokens.length === 0) {
    return { resolved: null, candidates: [], unambiguous: false };
  }

  const scored = latest
    .map((artifact) => ({ artifact, score: scoreArtifact(artifact, tokens) }))
    .filter((entry) => entry.score >= 0.25)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { resolved: null, candidates: [], unambiguous: false };
  }

  if (scored.length === 1) {
    return { resolved: scored[0].artifact, candidates: [scored[0].artifact], unambiguous: true };
  }

  // When the top match dominates the runner-up by a meaningful margin we
  // treat it as unambiguous; otherwise return both for the selector card.
  const top = scored[0];
  const runnerUp = scored[1];
  if (top.score - runnerUp.score >= 0.18) {
    return { resolved: top.artifact, candidates: [top.artifact], unambiguous: true };
  }

  return {
    resolved: null,
    candidates: scored.slice(0, 5).map((entry) => entry.artifact),
    unambiguous: false,
  };
}
