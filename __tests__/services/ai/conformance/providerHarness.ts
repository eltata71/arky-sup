/**
 * providerHarness — the test-side contract that makes provider conformance
 * checkable without naming a provider.
 *
 * The conformance suite (`providerConformance.test.ts`) knows only this
 * interface. Every `AIProvider` implementation supplies one harness that says
 * how to build it, how to stand in for its transport, and how to read back
 * what actually reached the wire.
 *
 * That last part is the point. A provider can *declare*
 * `capabilities.structuredOutput = true` and quietly drop the schema on the way
 * out — that is exactly the defect this suite exists to catch — so the
 * assertions are written against `readWire()`, not against the declaration.
 *
 * Adding a provider means adding a harness here and nothing else. If a new
 * provider cannot be expressed through this interface, the abstraction has
 * sprung a leak and that is worth knowing before the provider ships.
 */

import { vi } from 'vitest';
import type { AIProvider } from '../../../../services/ai/core/AIProvider';
import type { Settings } from '../../../../types';

/** What the harness observed leaving the provider on the last call. */
export interface WireRequest {
  /** Concrete model id the provider asked the backend for. */
  model?: string;
  /**
   * The response schema as it was actually serialised for the backend, in
   * whatever dialect that backend speaks. `undefined` means the provider sent
   * no schema — which, when one was supplied, is a conformance failure.
   */
  schema?: unknown;
  /** True when the provider asked the backend for JSON at all. */
  jsonMode: boolean;
  /** The system instruction as it reached the backend, if any. */
  systemInstruction?: string;
  /** Temperature as it reached the backend, if any. */
  temperature?: number;
  /** True when an abort signal was wired through to the backend call. */
  abortWired: boolean;
  /**
   * The tool declarations as they were serialised for the backend, in whatever
   * shape it speaks. `undefined` means none reached the wire — which, when the
   * request carried tools and the provider declares the capability, is a
   * conformance failure of exactly the kind this suite exists to catch: the
   * Gemini adapter declared tool support and never put a `tools` key on its
   * config at all.
   */
  tools?: unknown;
}

export interface ProviderHarness {
  /** Provider id under test — used to name the suite. */
  readonly id: string;
  /** Human label for test output. */
  readonly label: string;

  /** Build the provider with the harness's stubbed transport in place. */
  create(settings?: Settings): AIProvider;

  /** Settings whose `aiConfig` is valid for this provider. */
  settings(): Settings;

  /** Make the next non-streaming call resolve with this text. */
  stubText(text: string, usage?: WireUsage): void;

  /** Make the next streaming call yield these text deltas, then finish. */
  stubStream(chunks: string[]): void;

  /** Make the next call reject with a backend error carrying this status. */
  stubFailure(status: number, message?: string): void;

  /**
   * Make the next call come back as a tool call rather than as text, in this
   * backend's own response shape.
   */
  stubToolCall(name: string, args: Record<string, unknown>): void;

  /**
   * Make the next call come back having stopped for this reason, spelled the
   * way this backend spells "the output token cap was reached".
   */
  stubTruncated(text: string): void;

  /** Read what the last call actually put on the wire. */
  readWire(): WireRequest;

  /** Reset stubs and captured state between tests. */
  reset(): void;

  /** Tear down global stubs (fetch, localStorage) after the suite. */
  teardown(): void;
}

/** Token counts a harness can attach to a stubbed response. */
export interface WireUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Baseline settings shared by every harness; `aiConfig.model` is overridden. */
export function baseSettings(model: string): Settings {
  return {
    theme: 'dark',
    language: 'es',
    globalContext: [],
    aiConfig: {
      model,
      temperature: 0.4,
      tone: 'Profesional y Técnico',
      languageStyle: 'Conciso y directo',
      apiKeySource: 'user',
    },
  };
}

/**
 * A schema every provider must be able to carry end to end. Deliberately
 * exercises nesting, arrays, enums and `required` — the constructs the real
 * artifact schemas use — because a translator that only handles flat objects
 * passes a toy fixture and fails in production.
 */
export const CONFORMANCE_SCHEMA = {
  type: 'object' as const,
  required: ['title', 'items'],
  properties: {
    title: { type: 'string' as const, description: 'Nombre del artefacto' },
    confidence: { type: 'number' as const },
    kind: { type: 'string' as const, enum: ['diagram', 'document'] },
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        required: ['id'],
        properties: {
          id: { type: 'string' as const },
          weight: { type: 'integer' as const },
          active: { type: 'boolean' as const },
        },
      },
    },
  },
};

/** The payload the stubbed backends return for structured calls. */
export const CONFORMANCE_PAYLOAD = {
  title: 'Contexto C4',
  confidence: 0.82,
  kind: 'diagram',
  items: [{ id: 'sys-1', weight: 3, active: true }],
};

/** Restore anything a harness stubbed globally. */
export function restoreGlobals(): void {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage — nothing to clear */
  }
}
