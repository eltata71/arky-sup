/**
 * AIRequest — the provider-agnostic input contract.
 *
 * A request describes *what* to generate and *how* (mode/tier/temperature)
 * but never *which provider* — that choice belongs to the factory + router.
 */

import type { AIJsonSchema } from '../schema';
import type {
  AICapabilityLevel,
  AICapabilityName,
  AIRequiredCapability,
} from './AICapabilities';
import type { AIContentPart, AIMessageContent } from './AIContent';
import { contentToText } from './AIContent';
import type { AIModelTier, AIProviderId } from './AIModel';
import type { AIToolDefinition } from './AITool';

export type AIMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AIMessage {
  role: AIMessageRole;
  /**
   * Plain text, or ordered `AIContentPart`s for a multimodal turn.
   *
   * The string form stays first-class because almost every turn in this product
   * is one. What it replaces is `AIRequest.rawContents?: unknown`, documented as
   * "e.g. Gemini `Content[]`" — a vendor wire format sitting in the neutral
   * contract, which every adapter but Google's could only guess at.
   */
  content: AIMessageContent;
}

/**
 * High-level generation mode. Drives the router's model + parameter choice
 * via the `AIPolicy` presets.
 */
export type AIGenerationModeId =
  | 'fast'          // low-latency mechanical hops
  | 'balanced'      // default UX
  | 'high-quality'  // pro tier, more reasoning
  | 'executive'     // concise outputs for executives
  | 'technical'     // detailed outputs for technical audiences
  | 'diagnostic';   // verbose, includes critique + traces

/** Desired output shape. `json` flips structured-output handling on. */
export type AIResponseFormat = 'text' | 'json';

export interface AIRequest {
  /** Logical purpose of the call — recorded in the trace. */
  purpose: string;
  /** Stable id grouping related calls of one user-visible operation. */
  operationId?: string;
  /** Final composed prompt or message array. */
  prompt: string | AIMessage[];
  /** Optional system instruction (when supported by the provider). */
  systemInstruction?: string;
  /**
   * Extra content appended to the final user turn — an image to look at, a
   * document to read, the result of a tool the model just called.
   *
   * This is the canonical replacement for `rawContents?: unknown`. Each adapter
   * maps these parts into its own wire format, and a backend that cannot carry
   * one says so through `capabilities` rather than dropping it in silence.
   */
  attachments?: readonly AIContentPart[];
  /** Generation mode — selects the `AIPolicy` preset. */
  mode?: AIGenerationModeId;
  /** Explicit tier hint; overrides the mode-derived tier. */
  tier?: AIModelTier;
  /** Concrete model id for a single attempt (set by the executor per try). */
  model?: string;
  /** Explicit model override — wins over tier/mode but still records source. */
  modelOverride?: string;
  /** Sampling temperature (0..1). Provider may clamp. */
  temperature?: number;
  /** Nucleus sampling cutoff. */
  topP?: number;
  /** Hard cap on output tokens, when the provider supports it. */
  maxOutputTokens?: number;
  /** Desired output format. */
  responseFormat?: AIResponseFormat;
  /** Provider-neutral JSON schema for structured output. */
  responseSchema?: AIJsonSchema;
  /**
   * Functions the model may call. Each provider translates them at its own
   * boundary — the neutral definition is the one every adapter reads, so none
   * of them has to assert a shape it was handed as `unknown[]`.
   */
  tools?: readonly AIToolDefinition[];
  /**
   * What this request needs from whichever backend serves it, and how badly.
   *
   * A `required` entry is a routing constraint, not a preference: the router
   * excludes candidates that cannot serve it and the call fails when none can.
   * Implicit requirements (a schema implies structured output, tools imply tool
   * calling) are derived by `deriveRequiredCapabilities`; this field is for
   * what a caller knows and the request shape cannot show.
   */
  requiredCapabilities?: readonly AIRequiredCapability[];
  /** Reasoning/thinking token budget, when the provider supports it. */
  thinkingBudget?: number;
  /**
   * Escape hatch of last resort: fields merged verbatim into the provider's own
   * request body, and therefore meaningful only to one backend.
   *
   * Kept because some provider parameters genuinely have no neutral meaning
   * (Google's `safetySettings`, Anthropic's beta headers), and pretending
   * otherwise would push callers to fork the adapter. Two rules hold it in
   * place: it is keyed by provider, so a value written for one backend can
   * never be sent to another — which is what the old flat
   * `Record<string, unknown>` did the moment the provider changed — and no code
   * inside `services/ai` may read it. Only the adapter it names does.
   */
  providerConfig?: Partial<Record<AIProviderId, Record<string, unknown>>>;
  /** Abort signal for client-side cancellation. */
  signal?: AbortSignal;
  /** Soft per-attempt timeout (ms). Provider/executor may apply its own ceiling. */
  timeoutMs?: number;
  /** Stable request id; minted by the executor when absent. */
  requestId?: string;
  /** ContextPack id that influenced prompt composition, for the trace. */
  contextPackId?: string;
  /** Arbitrary metadata carried into the trace. */
  metadata?: Record<string, unknown>;
}

/** Collapse a prompt (string or messages) into a single string. */
export function collapsePrompt(prompt: AIRequest['prompt'], systemInstruction?: string): string {
  const sys = systemInstruction ? `${systemInstruction}\n\n` : '';
  if (typeof prompt === 'string') return `${sys}${prompt}`;
  const turns = prompt
    .map((m) => `${m.role.toUpperCase()}:\n${contentToText(m.content)}`)
    .join('\n\n');
  return `${sys}${turns}`;
}

/**
 * What this request needs from a backend, derived from its own shape plus what
 * the caller declared.
 *
 * Derivation rather than trust: a request carrying a `responseSchema` needs
 * structured output whether or not anyone wrote that down, and a request
 * carrying tools needs tool calling. Leaving it to callers is how the
 * requirement came to be checked in one place (`negotiate`) and ignored in the
 * one that could act on it (routing).
 *
 * Strength comes from the policy: `structuredOutput: 'required'` — diagnostic
 * mode, and anything a caller marks that way — makes the schema a routing
 * constraint. Otherwise a schema is `preferred`: the backends that cannot
 * enforce one still produce JSON that `parseStructured` validates afterwards,
 * so the guarantee weakens without the answer becoming useless.
 */
export function deriveRequiredCapabilities(
  request: Pick<
    AIRequest,
    'responseSchema' | 'responseFormat' | 'tools' | 'attachments' | 'requiredCapabilities'
  >,
  options: { streaming?: boolean; structuredOutputRequired?: boolean } = {},
): readonly AIRequiredCapability[] {
  const needs = new Map<AICapabilityName, AIRequiredCapability>();
  const add = (need: AIRequiredCapability): void => {
    const existing = needs.get(need.capability);
    // A stronger level always wins: two callers asking for the same capability
    // must not let the weaker of the two decide whether it is negotiable.
    if (!existing || LEVEL_RANK[need.level] > LEVEL_RANK[existing.level]) {
      needs.set(need.capability, need);
    }
  };

  const wantsSchema =
    (request.responseSchema !== undefined && request.responseSchema !== null) ||
    request.responseFormat === 'json';
  if (wantsSchema) {
    add({
      capability: 'structured-output',
      level: options.structuredOutputRequired ? 'required' : 'preferred',
      reason: 'La respuesta se consume como JSON con un esquema declarado.',
    });
  }

  if (request.tools && request.tools.length > 0) {
    add({
      capability: 'tools',
      level: 'required',
      reason: 'La operación depende de que el modelo pueda invocar una función.',
    });
  }

  for (const part of request.attachments ?? []) {
    if (part.kind === 'image') {
      add({
        capability: 'images',
        level: 'required',
        reason: 'La petición adjunta una imagen que el modelo debe leer.',
      });
    }
    if (part.kind === 'file') {
      add({
        capability: 'files',
        level: 'required',
        reason: 'La petición adjunta un documento que el modelo debe leer.',
      });
    }
  }

  if (options.streaming) {
    add({
      capability: 'streaming',
      level: 'required',
      reason: 'La superficie que hizo la llamada pinta la respuesta token a token.',
    });
  }

  for (const declared of request.requiredCapabilities ?? []) add(declared);

  return Array.from(needs.values());
}

const LEVEL_RANK: Readonly<Record<AICapabilityLevel, number>> = {
  optional: 0,
  preferred: 1,
  required: 2,
};
