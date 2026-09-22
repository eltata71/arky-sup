/**
 * AIContentPart — the canonical shape of everything a message can carry.
 *
 * `AIRequest` used to describe multimodal payloads with `rawContents?: unknown`,
 * documented as "e.g. Gemini `Content[]` with inline base64 parts". That is a
 * vendor wire format in the provider-agnostic contract: the day a second
 * provider had to serve the same request, the only honest thing the adapter
 * could do was guess at a shape it did not own. The hatch survived because
 * nothing ever set it — a canonical multimodal path did not exist, so the
 * legacy Gemini façade kept its own.
 *
 * These parts are that canonical path. They cover what Arky actually sends and
 * receives — text, an image, a document, a tool call and its result — and
 * nothing else. A richer union would be harder to translate faithfully to
 * every backend, and each provider must be able to map every member or declare
 * that it cannot (see `AIProviderCapabilities`).
 *
 * Binary payloads are base64 without a data-URI prefix, because that is the
 * only encoding all three shipped backends accept.
 */

/** Literal text. */
export interface AITextPart {
  kind: 'text';
  text: string;
}

/** An image the model should look at. */
export interface AIImagePart {
  kind: 'image';
  /** IANA media type, e.g. `image/png`. */
  mimeType: string;
  /** Base64-encoded bytes, without a `data:` prefix. */
  data: string;
}

/** A document (PDF, CSV, …) the model should read. */
export interface AIFilePart {
  kind: 'file';
  mimeType: string;
  data: string;
  /** Display name, when the source had one. */
  name?: string;
}

/** A tool invocation the model asked for. */
export interface AIToolCallPart {
  kind: 'tool-call';
  /** Correlates the call with its result. Minted by the adapter when the
   *  backend does not supply one. */
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The outcome of a tool invocation, handed back to the model. */
export interface AIToolResultPart {
  kind: 'tool-result';
  toolCallId: string;
  name: string;
  /** JSON-serialisable payload. */
  result: unknown;
  /** True when the tool failed; the model is told so rather than shown a
   *  success-shaped payload it would reason over as if it had worked. */
  isError?: boolean;
}

export type AIContentPart =
  | AITextPart
  | AIImagePart
  | AIFilePart
  | AIToolCallPart
  | AIToolResultPart;

/** Content of one message: plain text, or an ordered list of parts. */
export type AIMessageContent = string | readonly AIContentPart[];

/** Convenience constructor for the overwhelmingly common case. */
export const textPart = (text: string): AITextPart => ({ kind: 'text', text });

/** Normalise either content form into a parts array. */
export function toContentParts(content: AIMessageContent): readonly AIContentPart[] {
  return typeof content === 'string' ? [textPart(content)] : content;
}

/**
 * Flatten content down to the text a text-only backend can still serve.
 *
 * Non-text parts are named rather than dropped: a model handed a prompt that
 * silently lost its attachment answers confidently about nothing, which is
 * worse than a model told an image was present and unavailable. The capability
 * negotiation reports the loss too — this is what the prompt looks like after
 * it has been reported.
 */
export function contentToText(content: AIMessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      switch (part.kind) {
        case 'text':
          return part.text;
        case 'image':
          return `[imagen adjunta: ${part.mimeType} — no disponible para este proveedor]`;
        case 'file':
          return `[documento adjunto: ${part.name ?? part.mimeType} — no disponible para este proveedor]`;
        case 'tool-call':
          return `[llamada a herramienta ${part.name}: ${safeJson(part.arguments)}]`;
        case 'tool-result':
          return `[resultado de ${part.name}${part.isError ? ' (error)' : ''}: ${safeJson(part.result)}]`;
        default:
          return '';
      }
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Un turno de conversación, tal y como esta capa lo necesita.
 *
 * Es un **puerto**, y existe por la razón por la que `services/agent` declara
 * `AgentPersonaBriefing` en vez de importar la Oficina: la dependencia tiene
 * que apuntar en un solo sentido. `services/chat` importa `services/ai` —el
 * compactador llama al modelo—, así que si la capa de IA importara el
 * `ChatMessage` del contexto de chat, los dos módulos se importarían
 * mutuamente y ninguno se podría leer solo.
 *
 * Declara sólo lo que esta capa lee: el papel y el texto. `ChatMessage` encaja
 * estructuralmente —sus campos extra son opcionales— así que quien ya tenía un
 * historial lo sigue pasando sin convertir nada, y el día que el contexto de
 * chat añada un campo, esta capa no se entera, que es exactamente lo que un
 * puerto compra.
 */
export interface AIConversationTurn {
  role: 'user' | 'model';
  content: string;
}

/** True when any part needs a capability beyond plain text. */
export function contentNeeds(
  content: AIMessageContent,
): { images: boolean; files: boolean; tools: boolean } {
  const parts = toContentParts(content);
  return {
    images: parts.some((p) => p.kind === 'image'),
    files: parts.some((p) => p.kind === 'file'),
    tools: parts.some((p) => p.kind === 'tool-call' || p.kind === 'tool-result'),
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
