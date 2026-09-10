/**
 * The strangler seam: a legacy Gemini-shaped façade call, translated into a
 * canonical request and routed like any other.
 *
 * `geminiService.generateContentWithFallback` takes Google's `contents` union
 * and Google's `config` record, because every one of its several hundred call
 * sites was written against the SDK. Everything downstream of it is
 * provider-neutral. Something has to translate, and this is that something.
 *
 * It lives in `services/ai` rather than in the monolith for two reasons. It is
 * AI-layer work — turning a wire shape into `AIRequest` is exactly what an
 * adapter layer does — and it is *temporary*: when the last façade call site
 * declares a canonical request, this file is deleted, and a deletion is much
 * easier to see coming when the code sits in one file with this docblock at the
 * top than when it is 70 lines in the middle of a 5 000-line class.
 *
 * What it does **not** do is pretend the translation is lossless. It is not:
 * `contentsToPrompt` flattens a multi-turn Gemini `Content[]` into text, so a
 * chat history reaches a non-Gemini backend as one prompt rather than as turns.
 * That is why the Gemini path still calls the SDK directly with the original
 * `contents`, and why migrating it is a call-site-by-call-site job rather than
 * a switch to flip here.
 */

import type { Settings } from '../../../types';
import { negotiateAndReport } from '../capabilities';
import { geminiErrorClassifier } from '../errors/AIErrorClassifier';
import { reflectsProviderHealth } from '../errors/retryDecisions';
import type { AIRequest } from '../core/AIRequest';
import { collapsePrompt } from '../core/AIRequest';
import { assertPromptAllowed } from '../core/requestGuards';
import type { AIJsonSchema } from '../schema';
import type { AIToolDefinition } from '../core/AITool';
import {
  recordProviderFailure,
  recordProviderSuccess,
  routeRequest,
  type RoutedRequest,
} from '../routing';

export type { RoutedRequest };

/** The Gemini-shaped `config` the façade's call sites still write. */
export type LegacyGenerationConfig = Record<string, unknown>;

interface LegacyCallOptions {
  timeoutMs?: number;
  maxCandidates?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/**
 * Flatten the `contents` union the façade accepts (string, Gemini `Content[]`,
 * `{ text }` items) into a plain prompt string.
 */
export function contentsToPrompt(contents: unknown): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    const lines: string[] = [];
    for (const item of contents) {
      if (typeof item === 'string') {
        lines.push(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const record = item as { text?: unknown; parts?: unknown };
      if (typeof record.text === 'string') {
        lines.push(record.text);
        continue;
      }
      if (Array.isArray(record.parts)) {
        for (const part of record.parts) {
          if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            lines.push((part as { text: string }).text);
          }
        }
      }
    }
    return lines.join('\n');
  }
  return String(contents);
}

/**
 * Build the canonical `AIRequest` for a legacy façade call.
 *
 * This replaced an OpenRouter-specific builder that copied seven fields of the
 * Gemini config and silently omitted the rest — `responseSchema`, `tools`,
 * `thinkingConfig`, `topP`. The omission was invisible: the call still
 * succeeded and simply carried a weaker request than the caller had written.
 * The rule now is that nothing is dropped without being reported, and anything
 * the target backend cannot honour is surfaced by `negotiateAndReport` rather
 * than disappearing here.
 */
export function buildCanonicalRequest(
  preferredModel: string,
  contents: unknown,
  config: LegacyGenerationConfig,
  options: LegacyCallOptions,
  purpose: string,
): AIRequest {
  const responseMimeType =
    typeof config.responseMimeType === 'string' ? config.responseMimeType : undefined;
  const thinking = config.thinkingConfig as { thinkingBudget?: number } | undefined;
  // Tools arrive canonical: the two assistant call sites declare
  // `MODIFY_ARTIFACT_TOOL` and the Gemini translation happens at the SDK
  // boundary, so nothing has to be recovered from a vendor shape here.
  const tools = Array.isArray(config.tools) ? (config.tools as AIToolDefinition[]) : [];

  return {
    purpose,
    prompt: contentsToPrompt(contents),
    modelOverride: preferredModel,
    temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
    topP: typeof config.topP === 'number' ? config.topP : undefined,
    maxOutputTokens:
      typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined,
    systemInstruction:
      typeof config.systemInstruction === 'string' ? config.systemInstruction : undefined,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    responseFormat:
      responseMimeType === 'application/json' || config.responseSchema ? 'json' : 'text',
    responseSchema: config.responseSchema as AIJsonSchema | undefined,
    thinkingBudget:
      typeof thinking?.thinkingBudget === 'number' ? thinking.thinkingBudget : undefined,
    tools: tools.length > 0 ? tools : undefined,
  };
}

/**
 * Choose the backend for a legacy call, by routing rather than by lookup.
 *
 * The façade used to read `resolveProviderId(settings)` and branch on "is it
 * Gemini". That answers *who is configured*, which is not the same question as
 * *who can serve this request*: a request that needs tool calling, a schema the
 * backend must enforce, or an image the adapter must carry has requirements the
 * configured id knows nothing about. When the configured backend cannot serve a
 * **required** capability the router returns a different one, rather than
 * running the request with the guarantee removed.
 *
 * `negotiateAndReport` still runs and still only reports: the gaps left here
 * are the `preferred`/`optional` ones the plan accepted, and recording them is
 * what makes a worse answer after a provider switch explainable.
 *
 * It is also the legacy façade's guardrail seam. The monolith has no single
 * entry point — three of its methods reach a model through their own chain —
 * but all three route through here first, and routing happens before any of
 * them opens a connection. Guarding at the one function they share costs the
 * monolith nothing, which matters: its byte ceiling has no headroom by design.
 */
export function routeLegacyRequest(
  settings: Settings,
  request: AIRequest,
  opts: { streaming?: boolean } = {},
): RoutedRequest {
  const routed = routeRequest({ settings, request, streaming: opts.streaming });
  assertPromptAllowed(
    request.purpose,
    collapsePrompt(request.prompt, request.systemInstruction),
    routed.plan.primary.provider,
  );
  negotiateAndReport(routed.provider, request, { streaming: opts.streaming });
  return routed;
}

/**
 * Run a direct Gemini SDK attempt, recording what it says about Gemini's health.
 *
 * Only transport-level failures count. A caller-side failure — an abort, a
 * prompt this app refused to send — says nothing about Google's availability,
 * and counting it would open a circuit against a healthy backend because of a
 * bug in this repository.
 */
export async function withGeminiHealth<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    const value = await attempt();
    recordProviderSuccess('gemini');
    return value;
  } catch (error) {
    if (reflectsProviderHealth(geminiErrorClassifier.classify(error))) {
      recordProviderFailure('gemini');
    }
    throw error;
  }
}
