/**
 * Tolerant JSON parser for LLM responses.
 *
 * Why this exists: the Gemini SDK occasionally returns truncated, fence-
 * wrapped, or otherwise malformed JSON — most often when the model hits
 * `maxOutputTokens` mid-array, or when streaming gets cut by an iOS Safari
 * background-tab throttle. The native `JSON.parse` then throws
 * `SyntaxError: Expected ']'` and the caller falls back to a fully
 * synthetic deterministic recommendation, throwing away the partial
 * response that was probably 95% correct.
 *
 * `parseAiJson` performs a small set of *safe* repairs and returns a
 * structured result so callers can: (a) consume the parsed value when it
 * succeeds, (b) record `repairedFrom` in the trace when a repair was
 * needed, (c) fall back deterministically only when truly unrecoverable.
 *
 * Repairs applied (each strictly conservative — never invents content):
 *   1. Strip BOM, markdown fences, line/block comments.
 *   2. Surgical extraction of the outermost `{ ... }` or `[ ... ]` region.
 *   3. Drop trailing commas (`,]`, `,}`).
 *   4. Auto-close unbalanced strings, arrays and objects when the response
 *      was clearly truncated. We walk the JSON respecting string/escape
 *      state, and append the missing close characters in the correct order.
 *      If the truncation falls inside an array element, we drop the partial
 *      element so the parser doesn't trip on a half-written object.
 *   5. If after all of the above `JSON.parse` still fails, return a
 *      structured failure with the original error message attached.
 *
 * The parser is intentionally permissive on the *output side* (it accepts
 * shapes that are semantically valid even if syntactically frayed) and
 * strict on the *input side* (it never executes code, never uses `eval`,
 * never trusts comments as data).
 */

export type AiJsonRepair =
  | 'strip-bom'
  | 'strip-fences'
  | 'strip-comments'
  | 'extract-outermost'
  | 'drop-trailing-comma'
  | 'autoclose-strings'
  | 'autoclose-brackets'
  | 'drop-incomplete-tail';

export interface ParseAiJsonSuccess<T> {
  ok: true;
  data: T;
  /** Empty when the input parsed without any repair. */
  repairedFrom: AiJsonRepair[];
}

export interface ParseAiJsonFailure {
  ok: false;
  error: string;
  /** The cleaned text we attempted to parse, useful for diagnostics. */
  attempted: string;
}

export type ParseAiJsonResult<T> = ParseAiJsonSuccess<T> | ParseAiJsonFailure;

export function isParseAiJsonSuccess<T>(result: ParseAiJsonResult<T>): result is ParseAiJsonSuccess<T> {
  return result.ok === true;
}

export function isParseAiJsonFailure<T>(result: ParseAiJsonResult<T>): result is ParseAiJsonFailure {
  return result.ok === false;
}

const stripBom = (input: string): { text: string; applied: boolean } => {
  if (input.charCodeAt(0) === 0xFEFF) return { text: input.slice(1), applied: true };
  return { text: input, applied: false };
};

const stripFences = (input: string): { text: string; applied: boolean } => {
  const pattern = /```(?:json|javascript|js|json5)?\s*([\s\S]*?)\s*```/i;
  const match = input.match(pattern);
  if (match && match[1]) {
    return { text: match[1], applied: true };
  }
  // Strip unmatched fences that some models emit when truncated.
  const cleaned = input
    .replace(/```(?:json|javascript|js|json5)?\s*/gi, '')
    .replace(/```\s*$/g, '')
    .replace(/```/g, '');
  return { text: cleaned, applied: cleaned !== input };
};

const stripComments = (input: string): { text: string; applied: boolean } => {
  // Walk the string to skip comments outside string literals only.
  let out = '';
  let applied = false;
  let i = 0;
  let inString: false | '"' | "'" = false;
  let escape = false;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === inString) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      // Line comment — skip to newline.
      while (i < input.length && input[i] !== '\n') i += 1;
      applied = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      // Block comment — skip to closing */.
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      applied = true;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { text: out, applied };
};

const extractOutermost = (input: string): { text: string; applied: boolean } => {
  const trimmed = input.trim();
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  let startIndex = -1;
  let endChar: '}' | ']' | null = null;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endChar = '}';
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endChar = ']';
  }

  if (startIndex === -1 || !endChar) return { text: trimmed, applied: false };

  const lastIndex = trimmed.lastIndexOf(endChar);
  if (lastIndex > startIndex) {
    const sliced = trimmed.slice(startIndex, lastIndex + 1);
    return { text: sliced, applied: sliced !== trimmed };
  }

  // Truncated — keep from startIndex onwards so autoclose can finish the job.
  return { text: trimmed.slice(startIndex), applied: true };
};

const dropTrailingCommas = (input: string): { text: string; applied: boolean } => {
  // Walk respecting strings to avoid touching commas inside string literals.
  let out = '';
  let applied = false;
  let i = 0;
  let inString: false | '"' | "'" = false;
  let escape = false;
  while (i < input.length) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === inString) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === ',') {
      // Look ahead for next non-whitespace character.
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j += 1;
      const nextNonWs = input[j];
      if (nextNonWs === ']' || nextNonWs === '}') {
        applied = true;
        i += 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return { text: out, applied };
};

interface AutocloseResult {
  text: string;
  closedBrackets: boolean;
  closedString: boolean;
  droppedTail: boolean;
}

/** Walks the input once and reports the bracket stack, string state, and the
 *  furthest "safe" index (right after the last comma at top-of-array depth or
 *  the final balanced closing). The output is consumed by both close paths. */
const analyseBalance = (input: string): {
  stack: ('}' | ']')[];
  inString: false | '"';
  lastSafeIndex: number;
} => {
  const stack: ('}' | ']')[] = [];
  let inString: false | '"' = false;
  let escape = false;
  let lastSafeIndex = -1;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === inString) inString = false;
      continue;
    }
    if (ch === '"') {
      inString = '"';
      continue;
    }
    if (ch === '{') { stack.push('}'); continue; }
    if (ch === '[') { stack.push(']'); continue; }
    if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
        if (stack.length === 0) lastSafeIndex = i + 1;
      }
      continue;
    }
    if (ch === ',' && stack.length === 1) {
      lastSafeIndex = i + 1;
    }
  }
  return { stack, inString, lastSafeIndex };
};

/** "Lazy" close: keep all content, just append the missing close characters
 *  in reverse order. Cheapest repair — wins for `[1,2,3` style truncations
 *  where the model just forgot the final `]`. */
const autocloseLazy = (input: string): AutocloseResult => {
  const { stack, inString } = analyseBalance(input);
  let text = input;
  let closedString = false;
  let closedBrackets = false;
  if (inString) {
    text += '"';
    closedString = true;
  }
  text = text.replace(/,(\s*)$/g, '$1');
  while (stack.length > 0) {
    text += stack.pop();
    closedBrackets = true;
  }
  return { text, closedBrackets, closedString, droppedTail: false };
};

/** "Aggressive" close: rewind to the last safe boundary (top-of-array comma
 *  or final balanced closing) and close from there. Wins when the model
 *  truncated mid-element (`{"k":` style) — the half-written tail must go. */
const autocloseAggressive = (input: string): AutocloseResult => {
  const initial = analyseBalance(input);
  let text = input;
  let droppedTail = false;
  let closedString = false;
  let closedBrackets = false;
  let stack = [...initial.stack];
  let inString = initial.inString;
  if ((inString || stack.length > 0) && initial.lastSafeIndex > 0 && initial.lastSafeIndex < input.length) {
    text = input.slice(0, initial.lastSafeIndex);
    droppedTail = true;
    const recomputed = analyseBalance(text);
    stack = [...recomputed.stack];
    inString = recomputed.inString;
  }
  if (inString) {
    text += '"';
    closedString = true;
  }
  text = text.replace(/,(\s*)$/g, '$1');
  while (stack.length > 0) {
    text += stack.pop();
    closedBrackets = true;
  }
  return { text, closedBrackets, closedString, droppedTail };
};

/** Try the lazy close first (preserves more content). If that fails to parse,
 *  fall back to the aggressive close that drops the half-written tail. */
const autoclose = (input: string): AutocloseResult => {
  const lazy = autocloseLazy(input);
  try {
    JSON.parse(lazy.text);
    return lazy;
  } catch {
    return autocloseAggressive(input);
  }
};

export interface ParseAiJsonOptions {
  /** Treat empty/whitespace input as a typed empty value (e.g. `{}` or `[]`). */
  emptyAs?: 'object' | 'array';
}

export function parseAiJson<T = unknown>(raw: string | undefined | null, options: ParseAiJsonOptions = {}): ParseAiJsonResult<T> {
  if (raw === undefined || raw === null) {
    if (options.emptyAs === 'array') return { ok: true, data: [] as unknown as T, repairedFrom: [] };
    if (options.emptyAs === 'object') return { ok: true, data: {} as unknown as T, repairedFrom: [] };
    return { ok: false, error: 'empty-input', attempted: '' };
  }

  const repairs: AiJsonRepair[] = [];
  let text = raw;

  const bom = stripBom(text);
  text = bom.text;
  if (bom.applied) repairs.push('strip-bom');

  const fences = stripFences(text);
  text = fences.text;
  if (fences.applied) repairs.push('strip-fences');

  const comments = stripComments(text);
  text = comments.text;
  if (comments.applied) repairs.push('strip-comments');

  const extracted = extractOutermost(text);
  text = extracted.text;
  if (extracted.applied) repairs.push('extract-outermost');

  if (text.trim().length === 0) {
    if (options.emptyAs === 'array') return { ok: true, data: [] as unknown as T, repairedFrom: repairs };
    if (options.emptyAs === 'object') return { ok: true, data: {} as unknown as T, repairedFrom: repairs };
    return { ok: false, error: 'empty-after-cleanup', attempted: text };
  }

  // Fast path: try parsing before applying repairs that change content.
  try {
    return { ok: true, data: JSON.parse(text) as T, repairedFrom: repairs };
  } catch {
    // Continue with repairs.
  }

  const trailing = dropTrailingCommas(text);
  text = trailing.text;
  if (trailing.applied) repairs.push('drop-trailing-comma');

  try {
    return { ok: true, data: JSON.parse(text) as T, repairedFrom: repairs };
  } catch {
    // Continue.
  }

  const closed = autoclose(text);
  text = closed.text;
  if (closed.closedString) repairs.push('autoclose-strings');
  if (closed.closedBrackets) repairs.push('autoclose-brackets');
  if (closed.droppedTail) repairs.push('drop-incomplete-tail');

  // Re-run trailing-comma cleanup once after autoclose, since dropping a
  // partial element can leave a comma right before the close character.
  const trailingPostClose = dropTrailingCommas(text);
  text = trailingPostClose.text;
  if (trailingPostClose.applied && !repairs.includes('drop-trailing-comma')) {
    repairs.push('drop-trailing-comma');
  }

  try {
    return { ok: true, data: JSON.parse(text) as T, repairedFrom: repairs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      attempted: text,
    };
  }
}
