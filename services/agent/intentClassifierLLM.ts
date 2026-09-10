/**
 * Optional LLM-backed intent reclassifier.
 *
 * Used as a fallback ONLY when the heuristic classifier (`intentClassifier`)
 * returns a low-confidence prediction. The goal isn't to replace the heuristic
 * — that's still the default fast path — but to recover graceful behavior on
 * ambiguous utterances ("aplica eso", "que se vea mejor", "como te dije").
 *
 * Design:
 *  - Single in-memory cache (deterministic key from artifactId + normalised
 *    input) so repeated retries don't re-bill the LLM.
 *  - Strict JSON schema; falls back to the heuristic verdict on parse failure.
 *  - Never throws — the caller treats failure as "use the heuristic verdict".
 *  - Bounded latency: 6s timeout, single attempt. We're enriching a sync
 *    classifier; we can't block the UI.
 */

import { aiGateway } from '../ai';
import { resolveEffectiveModel } from '../../lib/ai/modelCatalog';
import type { Settings } from '../../types';
import type { AgentContext, AgentIntent, AgentIntentType, AgentImpactLevel, AgentExecutionTarget } from './agentTypes';
import { logAgentEvent } from './agentLogger';

const VALID_TYPES: readonly AgentIntentType[] = [
  'artifact.regenerate',
  'artifact.improve',
  'artifact.patch',
  'artifact.createVersion',
  'artifact.applySuggestion',
  'artifact.explainOnly',
  'unknown',
];

const CACHE = new Map<string, AgentIntent>();
const MAX_CACHE_ENTRIES = 80;

const cacheKey = (artifactId: string | null, input: string): string =>
  `${artifactId ?? 'none'}::${input.toLowerCase().replace(/\s+/g, ' ').slice(0, 240)}`;

const setCache = (key: string, intent: AgentIntent) => {
  if (CACHE.size >= MAX_CACHE_ENTRIES) {
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  CACHE.set(key, intent);
};

const PROMPT = (userInput: string, artifactName: string, viewMode: string | null) => `
You classify a user's message inside a chat with an architecture assistant.
Return STRICT JSON matching the provided schema.

Possible intent types:
- artifact.regenerate    → user wants to regenerate the artifact from scratch with new info
- artifact.improve       → general improvement of the artifact
- artifact.patch         → small targeted change (rename a node, fix a label, tweak a description)
- artifact.createVersion → snapshot a new version without changing content
- artifact.applySuggestion → apply already-loaded suggestions / recommendations
- artifact.explainOnly   → user just wants an explanation, no modification
- unknown                → no actionable intent / pure conversation

Set "impact": "low" (cheap, reversible), "medium" (rewrite scope, new version expected) or "high" (regeneration).
Set "suggestedTarget": "new_version" (default, safer) or "current" only if user EXPLICITLY says so.

Context:
- Active artifact: ${artifactName}
- View mode: ${viewMode ?? 'unknown'}

User message:
"""
${userInput}
"""
`;

const SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'Intent type from the allowed set.' },
    confidence: { type: 'number', description: 'Confidence between 0 and 1.' },
    impact: { type: 'string', description: 'low | medium | high' },
    suggestedTarget: { type: 'string', description: 'new_version | current' },
    extractedRequirements: {
      type: 'array',
      items: { type: 'string' },
      description: 'Bullet list of explicit requirements found in the message (max 5).',
    },
    rationale: { type: 'string', description: 'Short rationale (one sentence).' },
  },
  required: ['type', 'confidence', 'impact', 'suggestedTarget'],
} as const;

interface LLMRawIntent {
  type: string;
  confidence: number;
  impact: string;
  suggestedTarget: string;
  extractedRequirements?: unknown;
  rationale?: string;
}

const sanitise = (raw: LLMRawIntent, heuristic: AgentIntent): AgentIntent | null => {
  const type = (VALID_TYPES.includes(raw.type as AgentIntentType) ? raw.type : 'unknown') as AgentIntentType;
  const confidence = Math.max(0, Math.min(0.99, Number(raw.confidence) || 0));
  const impactRaw = String(raw.impact ?? '').toLowerCase();
  const impact: AgentImpactLevel = impactRaw === 'high' ? 'high' : impactRaw === 'low' ? 'low' : 'medium';
  const target: AgentExecutionTarget = raw.suggestedTarget === 'current' ? 'current' : 'new_version';
  const requirements = Array.isArray(raw.extractedRequirements)
    ? raw.extractedRequirements
        .filter((r): r is string => typeof r === 'string' && r.length > 4)
        .slice(0, 5)
    : [];
  if (type === 'unknown') return null;
  return {
    type,
    confidence,
    userInstruction: heuristic.userInstruction,
    artifactId: heuristic.artifactId,
    artifactVersionGroupId: heuristic.artifactVersionGroupId,
    artifactViewContext: heuristic.artifactViewContext,
    extractedRequirements: requirements.length > 0 ? requirements : heuristic.extractedRequirements,
    requiresConfirmation: impact !== 'low' || confidence < 0.75 || target === 'current',
    impact,
    suggestedTarget: target,
  };
};

/** Latency budget for the LLM upgrade. Keep low — UI is already showing the heuristic verdict. */
const LLM_TIMEOUT_MS = 6000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('llm-classifier-timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/**
 * Try to upgrade a low-confidence heuristic intent using Gemini's structured
 * output. Returns the heuristic verdict unchanged if the LLM call fails,
 * times out, or produces an invalid payload.
 *
 * Cached by `(artifactId + normalised input)` for the lifetime of the tab.
 */
export async function refineIntentWithLLM(params: {
  userInput: string;
  context: AgentContext;
  heuristicIntent: AgentIntent;
  settings: Settings;
}): Promise<AgentIntent> {
  const { userInput, context, heuristicIntent, settings } = params;
  const artifact = context.artifact;
  if (!artifact) return heuristicIntent;

  const key = cacheKey(artifact.id, userInput);
  const cached = CACHE.get(key);
  if (cached) return cached;

  try {
    const modelId = resolveEffectiveModel('default', settings).id;
    // Goes through the provider-agnostic seam so the user's selected provider
    // (Gemini or OpenRouter) is honoured. `maxRetries: 0` / `maxCandidates: 1`
    // keep the Gemini path a single call, exactly like the previous direct
    // SDK invocation — this is a latency-bounded enrichment, not a core path.
    const response = await withTimeout(
      aiGateway.generateContent(
        settings,
        modelId,
        PROMPT(userInput, artifact.name, context.viewMode),
        {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.1,
        },
        { timeoutMs: LLM_TIMEOUT_MS, maxRetries: 0, maxCandidates: 1 },
      ),
      LLM_TIMEOUT_MS,
    );

    const text = response.text?.trim();
    if (!text) return heuristicIntent;

    let parsed: LLMRawIntent;
    try {
      parsed = JSON.parse(text) as LLMRawIntent;
    } catch {
      return heuristicIntent;
    }

    const refined = sanitise(parsed, heuristicIntent);
    if (!refined) {
      logAgentEvent({
        traceId: 'classifier',
        phase: 'intent',
        level: 'info',
        message: 'LLM classifier returned unknown — keeping heuristic verdict.',
        meta: { heuristicType: heuristicIntent.type, heuristicConfidence: heuristicIntent.confidence },
      });
      return heuristicIntent;
    }

    // Only upgrade if the LLM is MORE confident than the heuristic, OR if the
    // heuristic was unknown. Otherwise the heuristic stays — it's cheaper and
    // already validated by tests.
    const shouldUpgrade =
      heuristicIntent.type === 'unknown' ||
      refined.confidence > heuristicIntent.confidence + 0.05;
    if (!shouldUpgrade) {
      setCache(key, heuristicIntent);
      return heuristicIntent;
    }

    setCache(key, refined);
    logAgentEvent({
      traceId: 'classifier',
      phase: 'intent',
      level: 'info',
      message: 'Intención reclasificada por LLM.',
      meta: {
        heuristic: { type: heuristicIntent.type, confidence: heuristicIntent.confidence },
        refined: { type: refined.type, confidence: refined.confidence, impact: refined.impact },
      },
    });
    return refined;
  } catch (err) {
    logAgentEvent({
      traceId: 'classifier',
      phase: 'intent',
      level: 'warn',
      message: 'LLM classifier failed — keeping heuristic verdict.',
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return heuristicIntent;
  }
}

/** Threshold below which we attempt LLM reclassification. */
export const LLM_REFINEMENT_THRESHOLD = 0.55;

/** Test-only helper to reset the in-memory cache between specs. */
export function __resetIntentClassifierCache() {
  CACHE.clear();
}
