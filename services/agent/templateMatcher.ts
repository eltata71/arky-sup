/**
 * Heuristic catalog template matcher for the agent's `artifact.create` flow.
 *
 * Why a heuristic and not an LLM call: the matcher runs synchronously inside
 * the intent classifier, which is on the hot path for every user turn. A
 * fuzzy keyword/scope match against the static `ARTIFACT_TEMPLATES` catalog
 * is good enough — the matcher only needs to identify the BEST template (or
 * `null` when nothing is close), and the executor falls back to a synthesised
 * custom template when no catalog entry wins.
 *
 * The matcher reuses the catalog as the single source of truth; we never
 * hardcode artifact names elsewhere in the agent layer.
 */

import { ARTIFACT_TEMPLATES } from '../../constants';
import type { ArtifactTemplate } from '../../types';

export interface TemplateMatchResult {
  template: ArtifactTemplate;
  /** Confidence 0..1. Below ~0.4 the caller should fall back to a custom template. */
  confidence: number;
  /** Free-form rationale that explains why the template was picked. */
  rationale: string;
}

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con', 'sin',
  'y', 'o', 'u', 'e', 'que', 'como', 'se', 'su', 'sus',
  'es', 'son', 'estoy', 'esta', 'este', 'estos', 'estas',
  'mi', 'tu', 'me', 'te', 'le', 'lo',
  'crea', 'crear', 'crearme', 'genera', 'generar', 'haz', 'hacer',
  'construye', 'construir', 'dame', 'darme', 'necesito', 'quiero',
  'arma', 'armar', 'prepara', 'preparar', 'diseña', 'disenar',
  'nuevo', 'nueva', 'nuevos', 'nuevas',
  'artefacto', 'artefactos', 'documento', 'documentos', 'diagrama', 'diagramas',
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
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));

/**
 * Map a natural-language artifact-type hint to a catalog `ArtifactType`
 * substring. We don't try to be exhaustive — only the buckets we can disambig-
 * uate reliably from a single keyword. When no rule fires, the matcher falls
 * back to the keyword-overlap score below.
 */
const TYPE_HINTS: Array<{ keywords: RegExp; matchType: (t: string) => boolean }> = [
  // C4 levels — order matters (more specific first).
  { keywords: /\bc4[-\s]?n?1\b|\bcontexto\b(?!\s+del)/, matchType: (t) => t === 'mermaid-c4-context' },
  { keywords: /\bc4[-\s]?n?2\b|\bcontenedor(es)?\b/, matchType: (t) => t === 'mermaid-c4-container' },
  { keywords: /\bc4[-\s]?n?3\b|\bcomponente(s)?\b/, matchType: (t) => t === 'mermaid-c4-component' },
  // ER / data
  { keywords: /\b(er|modelo (entidad|de datos)|entidad relacion)\b/, matchType: (t) => t === 'mermaid-er' },
  // Sequence / interaction
  { keywords: /\bsecuencia\b|\binteraccion(es)?\b/, matchType: (t) => t === 'mermaid-sequence' },
  // Process / BPMN
  { keywords: /\bbpmn\b|\bproceso de negocio\b/, matchType: (t) => t === 'hybrid-text-diagram' },
  // Generic diagram
  { keywords: /\bflujo|\bflow\b|\bgrafo\b/, matchType: (t) => t.startsWith('mermaid') || t === 'react-flow-graph' },
  // Document
  { keywords: /\bdocumento\b|\bresumen\b|\bdocs?\b|\bvision\b|\bprincipios\b/, matchType: (t) => t === 'markdown' },
];

/**
 * Score a template against the user's tokens. The score combines:
 *  - keyword overlap with `name` (heaviest weight),
 *  - keyword overlap with `objective` (medium weight),
 *  - type-hint match (boost when a strong type keyword fires).
 */
const scoreTemplate = (template: ArtifactTemplate, tokens: string[], normalisedInstruction: string): { score: number; nameHits: string[]; typeBoost: boolean } => {
  if (tokens.length === 0) return { score: 0, nameHits: [], typeBoost: false };

  const nameTokens = new Set(tokenise(template.name));
  const objectiveTokens = new Set(tokenise(template.objective));

  let nameOverlap = 0;
  const nameHits: string[] = [];
  let objectiveOverlap = 0;
  for (const tok of tokens) {
    if (nameTokens.has(tok)) {
      nameOverlap += 1;
      nameHits.push(tok);
    } else if (objectiveTokens.has(tok)) {
      objectiveOverlap += 1;
    }
  }

  // Normalise overlap by the count of tokens we actually had to match against;
  // otherwise long objectives drown out shorter ones.
  const nameScore = nameTokens.size > 0 ? nameOverlap / Math.max(1, nameTokens.size) : 0;
  const objectiveScore = objectiveTokens.size > 0 ? objectiveOverlap / Math.max(1, objectiveTokens.size) : 0;

  const typeHint = TYPE_HINTS.find((rule) => rule.keywords.test(normalisedInstruction));
  const typeBoost = !!(typeHint && typeHint.matchType(template.type));

  // Final score: weighted blend (name dominates) + type-hint bonus.
  const blended = nameScore * 0.75 + objectiveScore * 0.25;
  const final = Math.min(0.99, blended + (typeBoost ? 0.25 : 0));
  return { score: final, nameHits, typeBoost };
};

/**
 * Match a user instruction against the catalog. Returns the best template or
 * `null` when nothing scores above the minimum threshold.
 */
export function matchTemplateFromInstruction(instruction: string): TemplateMatchResult | null {
  const trimmed = instruction.trim();
  if (!trimmed) return null;

  const normalised = normalise(trimmed);
  const tokens = tokenise(trimmed);
  if (tokens.length === 0) return null;

  let best: { template: ArtifactTemplate; score: number; nameHits: string[]; typeBoost: boolean } | null = null;
  for (const template of ARTIFACT_TEMPLATES) {
    const result = scoreTemplate(template, tokens, normalised);
    if (!best || result.score > best.score) {
      best = { template, score: result.score, nameHits: result.nameHits, typeBoost: result.typeBoost };
    }
  }

  if (!best || best.score < 0.32) return null;

  const reasons: string[] = [];
  if (best.nameHits.length > 0) reasons.push(`coincide con "${best.nameHits.join(', ')}" en el nombre`);
  if (best.typeBoost) reasons.push('y la pista de tipo encaja con la plantilla');
  const rationale = reasons.length > 0
    ? `Se eligió "${best.template.name}" porque ${reasons.join(' ')}.`
    : `Se eligió "${best.template.name}" por mayor afinidad con la solicitud.`;

  return {
    template: best.template,
    confidence: best.score,
    rationale,
  };
}

/**
 * Build a custom (off-catalog) `ArtifactTemplate` from a free-form user
 * request. Used as a fallback when `matchTemplateFromInstruction` returns
 * null. Always produces a renderable template — type defaults to `markdown`
 * unless the instruction contains a diagram keyword.
 */
export function buildCustomTemplate(instruction: string): ArtifactTemplate {
  const trimmed = instruction.trim();
  const normalised = normalise(trimmed);
  const isDiagramRequest = /\b(diagram|flujo|flow|grafo|secuencia|c4|bpmn|er|arquitectura visual)\b/.test(normalised);

  return {
    name: trimmed.length <= 64 ? capitalise(trimmed) : `Artefacto a solicitud — ${capitalise(trimmed.slice(0, 60))}…`,
    type: isDiagramRequest ? 'mermaid-c4-context' : 'markdown',
    phase: 'General',
    architecturalView: 'Vista de Gestión y Soporte',
    objective: trimmed,
    keyConcepts: [],
    representation: isDiagramRequest ? 'diagram' : 'document',
    requestContext: {
      userRequest: trimmed,
      audience: 'mixed',
      rationale: 'Artefacto generado por el Arquitecto Agente a partir de una solicitud natural; no hubo coincidencia fuerte con el catálogo.',
      constructionPlan: [
        'Interpretar la intención del usuario y producir contenido renderizable.',
        'Mantener consistencia con el contexto del proyecto si está disponible.',
      ],
    },
  };
}

const capitalise = (text: string): string =>
  text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
