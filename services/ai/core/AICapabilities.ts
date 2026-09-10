/**
 * The capability vocabulary — what a request may need and what a backend offers.
 *
 * Three defects this module exists to close, all of them variations on the same
 * mistake: treating a capability as something you can be vague about.
 *
 *  1. **A capability nobody implements.** `AIProviderFactory` published
 *     `embeddings` in its capability union while `AIProvider` had no embedding
 *     method, so `supportsCapability` fell through to `default: return false`
 *     and `createForCapability({ capability: 'embeddings' })` could only ever
 *     throw. A declared capability that cannot be satisfied is not a roadmap
 *     entry, it is a lie the type system helps tell. It is gone; add it back
 *     the day an adapter can answer it.
 *
 *  2. **A capability read by cast.** Tool support was probed with
 *     `(provider as AIProvider & { supportsTools?: boolean }).supportsTools`
 *     and defaulted to *supported* when absent — so a backend that could not
 *     call functions silently reported that it could. Tools are a member of
 *     the record below, and a provider that does not declare the record does
 *     not compile.
 *
 *  3. **A requirement with no strength.** Negotiation reported every gap the
 *     same way and never blocked, so `structuredOutput: 'required'` in a policy
 *     and a provider that cannot enforce a schema produced a request that ran
 *     anyway with the guarantee quietly removed. `AICapabilityLevel` is the
 *     missing half: `required` reroutes before the call and fails when no route
 *     satisfies it, `preferred` biases ranking, `optional` only reports.
 */

/** A capability a request may need from the backend serving it. */
export type AICapabilityName =
  | 'streaming'
  | 'structured-output'
  | 'tools'
  | 'images'
  | 'files'
  | 'audio';

/** Every capability name, for exhaustive iteration in tests and UIs. */
export const AI_CAPABILITY_NAMES: readonly AICapabilityName[] = [
  'streaming',
  'structured-output',
  'tools',
  'images',
  'files',
  'audio',
];

/**
 * What a backend can do, declared once.
 *
 * This replaces the four loose `supportsX` booleans on `AIProvider`. One record
 * is what makes the set enumerable: `readCapabilities` no longer restates the
 * fields, and adding a capability is a compile error in every adapter rather
 * than a silent `false` in one `switch`.
 */
export interface AIProviderCapabilities {
  /** Tokens can be delivered incrementally. */
  streaming: boolean;
  /** A JSON response schema can be enforced by the backend. */
  structuredOutput: boolean;
  /** Function/tool definitions can be offered and calls returned. */
  tools: boolean;
  /** Images can be sent as input. */
  images: boolean;
  /** Documents (PDF, CSV, …) can be sent as input. */
  files: boolean;
  /** Audio can be sent or produced. */
  audio: boolean;
}

/** A backend that can do nothing beyond text — the honest unknown. */
export const NO_CAPABILITIES: AIProviderCapabilities = Object.freeze({
  streaming: false,
  structuredOutput: false,
  tools: false,
  images: false,
  files: false,
  audio: false,
});

/** How strictly a request needs a capability. */
export type AICapabilityLevel =
  /** Without it the result would not be what the caller asked for. Reroute,
   *  and fail when no route can serve it. */
  | 'required'
  /** Better with it. Ranks candidates; never blocks. */
  | 'preferred'
  /** Nice to have. Reported when missing, nothing more. */
  | 'optional';

/** One capability this request needs, and how badly. */
export interface AIRequiredCapability {
  capability: AICapabilityName;
  level: AICapabilityLevel;
  /** Why the caller needs it — travels into the trace and the failure message. */
  reason?: string;
}

/** Read one capability out of the record by its canonical name. */
export function providerSupports(
  capabilities: AIProviderCapabilities,
  capability: AICapabilityName,
): boolean {
  switch (capability) {
    case 'streaming':
      return capabilities.streaming;
    case 'structured-output':
      return capabilities.structuredOutput;
    case 'tools':
      return capabilities.tools;
    case 'images':
      return capabilities.images;
    case 'files':
      return capabilities.files;
    case 'audio':
      return capabilities.audio;
    default:
      return false;
  }
}

/** The capabilities in `needed` that `capabilities` cannot serve. */
export function unmetCapabilities(
  capabilities: AIProviderCapabilities,
  needed: readonly AIRequiredCapability[],
  level?: AICapabilityLevel,
): readonly AIRequiredCapability[] {
  return needed.filter(
    (need) =>
      (level === undefined || need.level === level) &&
      !providerSupports(capabilities, need.capability),
  );
}

/** Human-readable Spanish name for a capability, for user-facing messages. */
export const CAPABILITY_LABELS: Readonly<Record<AICapabilityName, string>> = {
  streaming: 'respuesta en streaming',
  'structured-output': 'salida estructurada por esquema',
  tools: 'llamada a herramientas',
  images: 'entrada de imágenes',
  files: 'entrada de documentos',
  audio: 'audio',
};
