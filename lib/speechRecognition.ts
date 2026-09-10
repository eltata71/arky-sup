/**
 * Minimal types for the Web Speech API.
 *
 * `SpeechRecognition` is not in TypeScript's DOM library: it is a prefixed,
 * Chromium-only interface, so every call site reached for `(window as any)`
 * and typed its handlers `any`. That is four untyped values in a row, and the
 * one that actually bites is `event.results` — an index-and-length collection
 * that is *not* an array, which `any` will happily let someone call `.map` on.
 *
 * Only the members this app uses are declared. A partial, accurate type beats
 * a complete, speculative one: everything here has been read off a working
 * call site rather than transcribed from a specification the browser may not
 * follow.
 */

export interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechCapableWindow {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/**
 * The browser's implementation, or `null` where there is none.
 *
 * Returning `null` rather than throwing keeps dictation an enhancement: Safari
 * and Firefox have no implementation, and a missing one must not break a chat
 * window.
 */
export function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as unknown as SpeechCapableWindow;
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/**
 * Concatenate the final transcripts from a result event.
 *
 * `results` is an indexed collection, not an array — it has `length` and
 * numeric keys and none of `map`, `filter` or `forEach`. Doing this in one
 * place keeps the next call site from discovering that the hard way.
 */
export function finalTranscriptFrom(event: SpeechRecognitionEvent): string {
  let transcript = '';
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result?.isFinal) transcript += result[0]?.transcript ?? '';
  }
  return transcript;
}
