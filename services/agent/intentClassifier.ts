/**
 * Heuristic intent classifier for the Arquitecto Agente.
 *
 * Why heuristic and not LLM-based: latency. A user message is already going to
 * hit Gemini for the chat reply; adding a second roundtrip just to decide if
 * the reply should be actionable doubles the perceived response time. A small
 * keyword + context table covers >90% of the explicit-action utterances we
 * care about, and we fall back to `unknown` (= conversational only) for the
 * rest. The user can still trigger an action manually from the existing
 * "Mejorar con IA" toolbar — nothing degrades.
 */

import type { AgentContext, AgentIntent, AgentIntentType, AgentImpactLevel, BatchMatcher, MemoryScope } from './agentTypes';
import { matchTemplateFromInstruction } from './templateMatcher';

interface PatternRule {
  type: AgentIntentType;
  /** Patterns are matched case-insensitively against the normalised user input. */
  patterns: RegExp[];
  /** Base confidence when any pattern matches. Adjusted downstream. */
  baseConfidence: number;
  impact: AgentImpactLevel;
}

/**
 * Memory-save patterns. We intentionally do NOT split per scope here — a
 * single rule fires for any "save to memory" instruction, and then we
 * resolve the concrete scope (`global` / `project` / `artifact`) downstream.
 * This keeps the rule table compact and lets us add a single fallback when
 * the user didn't specify a scope explicitly.
 */
const MEMORY_PATTERNS: RegExp[] = [
  /\b(guard(a|alo|en|emos|a esto)|salv(a|alo)|registr(a|alo)|captur(a|alo)|recuerd(a|alo)|memoriz(a|alo)|anot(a|alo))\b/,
  /\b(a[ñn]ad(e|elo)|agreg(a|alo)) (esto|esta (idea|nota|informaci[oó]n|conclusi[oó]n|conversaci[oó]n)) (a|al|en|como) (la )?(memoria|contexto)\b/,
  /\b(en|a) (la )?memoria (global|del proyecto|del artefacto|de este artefacto|de este proyecto)\b/,
  /\b(en|al|como) (contexto|memoria|directriz)\b/,
  /\bextra(e|elo) los? (conceptos? )?(importantes?|clave) y (gu[aá]rd|salv|registr)/,
];

/**
 * Patterns that signal "create a new artifact" (vs. modifying an existing
 * one). The verbs are deliberately permissive — the planner still runs the
 * template matcher afterwards, so we can be generous with triggers and let
 * the matcher decide whether the request maps to a concrete catalog entry.
 *
 * Kept separate from the main `RULES` table because creation is the only
 * intent that does NOT require an active artifact: it fires from the global
 * copilot view where `ctx.artifact === null`.
 */
const CREATE_PATTERNS: RegExp[] = [
  /\b(crea|cr[eé]ame|cre[ae]r|crea(r)?nos)\s+(un|una|el|la|nuevo|nueva|otro|otra)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen|grafo|esquema|plantilla|brief)\b/,
  /\b(gener(a|ar|emos|en))\s+(un|una|el|la|nuevo|nueva|otro|otra)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen|grafo|esquema)\b/,
  /\b(constru(ye|ir|imos))\s+(un|una|el|la|nuevo|nueva)?\s*(diagrama|documento|artefacto|vista|modelo)\b/,
  /\b(arma(me)?|prepara(me)?|haz(me)?|dise[ñn]a(me)?|elabora(me)?)\s+(un|una|el|la|nuevo|nueva)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen|grafo)\b/,
  /\bnecesito\s+(un|una|el|la|otro|otra)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen)\b/,
  /\bquiero\s+(un|una|el|la|otro|otra)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen)\b/,
  /\bagrega(r|me)?\s+(un|una|el|la|nuevo|nueva|otro|otra)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen)\b/,
  /\b(añade|anade)\s+(un|una|el|la|nuevo|nueva|otro|otra)?\s*(diagrama|documento|artefacto|vista|modelo|mapa|resumen)\b/,
];

const RULES: PatternRule[] = [
  // ── Guardar en memoria ───────────────────────────────────────────────────
  // Lower base confidence than batch/regenerate because the trigger
  // vocabulary overlaps with general conversation ("recuerda que…"); the
  // user-facing card lets the user confirm or cancel before anything
  // persists, so a false positive is safe.
  {
    type: 'memory.save.project',
    patterns: MEMORY_PATTERNS,
    baseConfidence: 0.78,
    impact: 'low',
  },
  // ── Batch (multi-artefacto) ──────────────────────────────────────────────
  {
    type: 'artifacts.batch',
    patterns: [
      /\b(en|sobre|para) (todos|todas) los? (artefactos|diagramas|documentos|vistas)\b/,
      /\b(en|para) (los|las) (diagramas|artefactos) c4\b/,
      /\b(en|para) todos? los? artefactos\b/,
      /\bpropag(a|ar) (esto|este cambio|la convenci[oó]n|el cambio)\b/,
    ],
    baseConfidence: 0.82,
    impact: 'high',
  },
  // ── Regeneración total ───────────────────────────────────────────────────
  {
    type: 'artifact.regenerate',
    patterns: [
      /\bregener(a|ar|alo|emos)\b/,
      /\bvuelve a (generar|crear|construir|hacer)\b/,
      /\bgener(a|ar) (de nuevo|otra vez|otra version)\b/,
      /\brehacer (este|el) (artefacto|diagrama|documento)\b/,
      /\brecrear (este|el) (artefacto|diagrama|documento)\b/,
    ],
    baseConfidence: 0.85,
    impact: 'high',
  },
  // ── Aplicar sugerencias / recomendaciones ────────────────────────────────
  {
    type: 'artifact.applySuggestion',
    patterns: [
      /\baplica (estas|las|esas|todas las|tus) (sugerencias|recomendaciones|mejoras)\b/,
      /\bimplementa (estas|las|esas|todas las|tus) (sugerencias|recomendaciones|mejoras)\b/,
      /\bconvierte (esta|esa|tu) (recomendaci[oó]n|sugerencia) en (una )?nueva versi[oó]n\b/,
      /\busa (estas|las) (sugerencias|recomendaciones)\b/,
    ],
    baseConfidence: 0.88,
    impact: 'medium',
  },
  // ── Mejora general con IA ────────────────────────────────────────────────
  {
    type: 'artifact.improve',
    patterns: [
      /\bmejora (este|el|este?) (artefacto|diagrama|documento)\b/,
      /\bmej[oó]ralo\b/,
      /\boptimiza (este|el) (artefacto|diagrama|documento)\b/,
      /\bperfecciona (este|el) (artefacto|diagrama|documento)\b/,
      /\bmejora con base en (tus|las) (recomendaciones|sugerencias|recomendaciones que (me )?diste)\b/,
      /\bmejora (este artefacto )?con (base en )?(lo que|esto) (acabamos de|hemos) (conversar|hablar|discutir)\b/,
    ],
    baseConfidence: 0.78,
    impact: 'medium',
  },
  // ── Cambio puntual (patch) ───────────────────────────────────────────────
  {
    type: 'artifact.patch',
    patterns: [
      /\bcambia (el|la) (nombre|etiqueta|titulo|t[ií]tulo|descripci[oó]n) (del|de la|de) (nodo|relaci[oó]n|elemento|componente)\b/,
      /\brenombr(a|alo|ar) (el|la|este|esta) (nodo|relaci[oó]n|componente)\b/,
      /\bcorrige (el|la|este|esta) (nodo|relaci[oó]n|etiqueta|descripci[oó]n|texto)\b/,
      /\bmodifica (el|la|este|esta) (nodo|relaci[oó]n|etiqueta|descripci[oó]n|texto|artefacto)\b/,
      /\bactualiza (el|la|este|esta) (documento|texto|descripci[oó]n|explicaci[oó]n)\b/,
      /\bagrega (un|una|el|la) (nodo|relaci[oó]n|componente|secci[oó]n)\b/,
      /\bquita (el|la|este|esta) (nodo|relaci[oó]n|componente|secci[oó]n)\b/,
      /\belimina (el|la|este|esta) (nodo|relaci[oó]n|componente|secci[oó]n)\b/,
      /\baplica (este|esta|el|la) (cambio|mejora|ajuste|correcci[oó]n)\b/,
    ],
    baseConfidence: 0.8,
    impact: 'medium',
  },
  // ── Crear nueva versión explícita ────────────────────────────────────────
  {
    type: 'artifact.createVersion',
    patterns: [
      /\bcrea (una )?nueva versi[oó]n\b/,
      /\bgener(a|ar) (una )?nueva versi[oó]n\b/,
      /\bversiona (esto|este artefacto)\b/,
    ],
    baseConfidence: 0.9,
    impact: 'low',
  },
  // ── Sólo explicación ─────────────────────────────────────────────────────
  {
    type: 'artifact.explainOnly',
    patterns: [
      /^\s*(explica|expl[ií]came|qu[eé] (es|hace|representa)|c[oó]mo funciona|p[oó]r qu[eé])\b/,
      /\bdetalla (este|el) (artefacto|diagrama|documento)\b/,
    ],
    baseConfidence: 0.7,
    impact: 'low',
  },
];

/** Cleans, lowercases and trims accents/diacritics-safe punctuation. */
const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[¿¡!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Returns the highest-confidence rule that matches, or `null` if nothing
 * matches. We intentionally don't sum confidences across rules — a message
 * that matches both "mejora" and "regenera" should bias toward "regenerate"
 * since it's the more specific, high-impact action.
 */
const matchTopRule = (normalised: string): { rule: PatternRule; matchedPatterns: number } | null => {
  let best: { rule: PatternRule; matchedPatterns: number } | null = null;
  for (const rule of RULES) {
    const matched = rule.patterns.filter((pattern) => pattern.test(normalised)).length;
    if (matched === 0) continue;
    const score = rule.baseConfidence + matched * 0.02; // small reinforcement bonus
    const bestScore = best ? best.rule.baseConfidence + best.matchedPatterns * 0.02 : -1;
    if (score > bestScore) {
      best = { rule, matchedPatterns: matched };
    }
  }
  return best;
};

/**
 * Classify the user's latest turn. Pure function — safe to call from render.
 */
export function classifyAgentIntent(userInput: string, ctx: AgentContext): AgentIntent {
  const trimmed = userInput.trim();
  const normalised = normalise(trimmed);

  const fallback: AgentIntent = {
    type: 'unknown',
    confidence: 0,
    userInstruction: trimmed,
    artifactId: ctx.artifact?.id ?? null,
    artifactVersionGroupId: ctx.artifact?.versionGroupId ?? null,
    artifactViewContext: ctx.viewMode,
    extractedRequirements: [],
    requiresConfirmation: true,
    impact: 'low',
    suggestedTarget: 'new_version',
  };

  if (!trimmed) return fallback;

  // Memory-save intents take priority and don't require an active artifact
  // — the global/project scopes work from anywhere. We resolve them first so
  // a user can capture context even on the project landing page.
  if (MEMORY_PATTERNS.some((re) => re.test(normalised))) {
    return classifyMemorySave(trimmed, normalised, ctx, fallback);
  }

  // Creation intents are scoped to "anywhere a copilot can be summoned" —
  // they explicitly DO NOT require an active artifact, since the global
  // copilot fires from the project hub without one in scope.
  if (CREATE_PATTERNS.some((re) => re.test(normalised))) {
    return classifyArtifactCreate(trimmed, normalised, ctx, fallback);
  }

  if (!ctx.artifact) {
    // No artifact in scope → we can only converse. Don't fabricate actions.
    return fallback;
  }

  const top = matchTopRule(normalised);
  if (!top) return fallback;

  // If the user explicitly said "no version" → bias to current.
  const explicitCurrent = /\b(en|sobre) (el|este) (mismo|actual)\b|\bsin (crear )?nueva versi[oó]n\b/.test(normalised);
  const suggestedTarget: AgentIntent['suggestedTarget'] = explicitCurrent ? 'current' : 'new_version';

  // Confidence boost when the message also references the artifact ("este diagrama"…).
  let confidence = top.rule.baseConfidence + top.matchedPatterns * 0.02;
  if (/\b(este|esta|actual|de aqui|ahora)\b/.test(normalised)) confidence += 0.04;
  // Penalize when the message is very long (likely conversation, not command).
  if (trimmed.length > 240) confidence -= 0.05;
  confidence = Math.max(0, Math.min(0.99, confidence));

  // Heuristic requirements extraction: every sentence after the trigger word
  // that looks like a constraint becomes a bullet for the action plan.
  const extractedRequirements = extractRequirements(trimmed);

  // Build batch scope when the matched rule is the multi-artifact one.
  let batchScope: AgentIntent['batchScope'];
  if (top.rule.type === 'artifacts.batch') {
    // Patch verbs are tight & specific; everything else is treated as a
    // general "improve" — keeps the AI room to interpret broad instructions
    // like "aplica esta convención" without being forced into a literal
    // rewrite.
    const isPatchInstruction = /\b(cambia|renombr|corrig|reemplaza)/.test(normalised);
    batchScope = {
      subAction: isPatchInstruction ? 'artifact.patch' : 'artifact.improve',
      matcher: inferBatchMatcher(normalised),
    };
  }

  // Special case: if user said "apply suggestions" but we know there are none
  // loaded yet, downgrade so the card asks "first analyze, then apply".
  if (top.rule.type === 'artifact.applySuggestion' && !ctx.hasPendingSuggestions) {
    confidence = Math.min(confidence, 0.55);
  }

  return {
    type: top.rule.type,
    confidence,
    userInstruction: trimmed,
    artifactId: ctx.artifact.id,
    artifactVersionGroupId: ctx.artifact.versionGroupId,
    artifactViewContext: ctx.viewMode,
    extractedRequirements,
    requiresConfirmation:
      top.rule.impact === 'high' ||
      top.rule.impact === 'medium' ||
      confidence < 0.75 ||
      suggestedTarget === 'current',
    impact: top.rule.impact,
    suggestedTarget,
    batchScope,
  };
}

/**
 * Resolve a batch matcher from the normalised user instruction.
 *
 * Cheap keyword routing — falls back to `{ kind: 'all' }` so the planner can
 * resolve the concrete artifact list. We deliberately do not try to be
 * clever here: ambiguous batch instructions should hit the confirmation card
 * anyway.
 */
function inferBatchMatcher(normalised: string): BatchMatcher {
  if (/\bc4\b/.test(normalised)) return { kind: 'type', type: 'mermaid-c4-' };
  if (/\bdiagram[ao]s?\b/.test(normalised)) return { kind: 'type', type: 'mermaid' };
  if (/\bdocumentos?\b/.test(normalised)) return { kind: 'type', type: 'markdown' };
  const viewMatch = normalised.match(/\bvista (de )?([a-zá-úñ ]{3,40})/);
  if (viewMatch) return { kind: 'view', view: viewMatch[2].trim() };
  return { kind: 'all' };
}

/**
 * Resolve the target memory scope from the user's instruction.
 *
 * Priority:
 *  1. Explicit keyword ("global" / "del proyecto" / "del artefacto").
 *  2. If the user is currently looking at an artifact AND said "esto/aqui"
 *     without specifying a scope, prefer `artifact`.
 *  3. Default fallback is `project` — the most common case and the existing
 *     home for ad-hoc context notes.
 *
 * If the user asks for `artifact` scope but no artifact is active, we fall
 * back to `project` so the action still produces a meaningful result instead
 * of silently failing. The card surfaces the actual scope so the user can
 * still flip it manually.
 */
function resolveMemoryScope(normalised: string, ctx: AgentContext): MemoryScope {
  if (/\b(memoria|contexto|directriz) global\b|\bglobal(mente)?\b/.test(normalised)) return 'global';
  if (/\b(memoria|contexto) (del|de este) (artefacto|diagrama|documento)\b|\b(del|de este) artefacto\b/.test(normalised)) {
    return ctx.artifact ? 'artifact' : 'project';
  }
  if (/\b(memoria|contexto) (del|de este) proyecto\b|\b(del|de este) proyecto\b/.test(normalised)) return 'project';
  // No explicit scope. When the user is anchored on an artifact and references
  // it implicitly, prefer artifact; otherwise project.
  if (ctx.artifact && /\b(este|aqu[ií]|aca|ahora)\b/.test(normalised)) return 'artifact';
  return 'project';
}

/**
 * Build an `artifact.create` intent. Always requires confirmation — the user
 * must see WHICH template the matcher resolved before we generate anything.
 *
 * We deliberately classify creation as a high-impact action even when the
 * confidence is high: a new artifact lands in the project hub and the user
 * should always confirm the template choice before tokens are burned.
 */
function classifyArtifactCreate(trimmed: string, normalised: string, ctx: AgentContext, fallback: AgentIntent): AgentIntent {
  const match = matchTemplateFromInstruction(trimmed);
  const explicitArtifactKeyword = /\b(diagrama|documento|vista|modelo|mapa|resumen|grafo|esquema|brief)\b/.test(normalised);
  // Confidence climbs with: explicit artifact keyword + catalog match.
  let confidence = 0.7;
  if (explicitArtifactKeyword) confidence += 0.06;
  if (match) confidence += Math.min(0.18, match.confidence * 0.25);
  if (trimmed.length > 220) confidence -= 0.04;
  confidence = Math.max(0.4, Math.min(0.95, confidence));

  return {
    ...fallback,
    type: 'artifact.create',
    confidence,
    userInstruction: trimmed,
    artifactId: ctx.artifact?.id ?? null,
    artifactVersionGroupId: ctx.artifact?.versionGroupId ?? null,
    artifactViewContext: ctx.viewMode,
    extractedRequirements: extractRequirements(trimmed),
    requiresConfirmation: true,
    impact: 'high',
    suggestedTarget: 'new_version',
    createHint: {
      templateName: match?.template.name ?? null,
      artifactType: match?.template.type,
      objective: trimmed,
      matchConfidence: match?.confidence,
    },
  };
}

function classifyMemorySave(trimmed: string, normalised: string, ctx: AgentContext, fallback: AgentIntent): AgentIntent {
  const scope = resolveMemoryScope(normalised, ctx);
  const type: AgentIntentType =
    scope === 'global'
      ? 'memory.save.global'
      : scope === 'project'
        ? 'memory.save.project'
        : 'memory.save.artifact';

  // Confidence: high when the trigger keyword is paired with an explicit
  // scope; medium otherwise. Always require confirmation (the user sees the
  // extracted bullets before persistence).
  const explicitScope = /\b(global|proyecto|artefacto|memoria|contexto|directriz)\b/.test(normalised);
  const confidence = Math.min(0.95, 0.75 + (explicitScope ? 0.1 : 0) + (trimmed.length < 120 ? 0.05 : 0));

  return {
    ...fallback,
    type,
    confidence,
    userInstruction: trimmed,
    artifactId: ctx.artifact?.id ?? null,
    artifactVersionGroupId: ctx.artifact?.versionGroupId ?? null,
    artifactViewContext: ctx.viewMode,
    extractedRequirements: [],
    requiresConfirmation: true,
    impact: 'low',
    suggestedTarget: 'new_version',
    memoryScope: scope,
  };
}

/** Splits the message into rough sentences and keeps the ones that read like requirements. */
function extractRequirements(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6 && s.length < 220);
  const REQUIREMENT_HINTS = [
    'debe',
    'necesita',
    'usando',
    'incorpora',
    'incluye',
    'incluyendo',
    'sin ',
    'con ',
    'asegura',
    'considera',
    'mant[eé]n',
    'manteniendo',
    'cambiando',
    'a partir de',
  ];
  const re = new RegExp(`\\b(${REQUIREMENT_HINTS.join('|')})\\b`, 'i');
  const filtered = sentences.filter((s) => re.test(s));
  return filtered.length > 0 ? filtered.slice(0, 5) : sentences.slice(0, 3);
}
