/**
 * AISchema — the neutral schema dialect and its per-provider adapters.
 *
 * The application describes the shape it wants back exactly once, in standard
 * JSON Schema (`AIJsonSchema`, lowercase type names). Each provider adapter
 * translates that into whatever its backend speaks:
 *
 *   - `toGeminiSchema`  → Google's `responseSchema` (uppercase `Type` names)
 *   - `toJsonSchema`    → OpenAI-style `json_schema` (strict, lowercase)
 *
 * ## Why the adapters accept both dialects
 *
 * The migration away from Google's `Type` enum touches hundreds of schema
 * definition sites. Translating them in one commit would be a single
 * unreviewable change; translating them file by file means that, for a while,
 * both dialects are in flight at once.
 *
 * So normalisation is **case-insensitive on input and canonical on output**.
 * A schema written either way arrives at either backend correctly, which is
 * what lets the definition sites migrate one at a time behind a green suite.
 * This tolerance is deliberate and load-bearing, not defensive clutter — but
 * it is an input tolerance only: everything these functions *emit* is in one
 * dialect, so a backend never sees a mixture.
 */

/** Canonical, provider-neutral JSON Schema type names. */
export type AISchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean';

/**
 * Minimal, provider-neutral JSON Schema descriptor.
 *
 * Deliberately a subset: it covers what generation prompts actually constrain
 * (shape, nesting, enums, required-ness) and nothing more. A richer dialect
 * would be harder to translate faithfully to every backend, and the extra
 * expressiveness would be silently dropped by whichever provider understood
 * the least — the exact failure this module exists to remove.
 */
export interface AIJsonSchema {
  type: AISchemaType;
  description?: string;
  properties?: Record<string, AIJsonSchema>;
  items?: AIJsonSchema;
  required?: string[];
  enum?: unknown[];
  nullable?: boolean;
}

/** Identity helper that documents intent at schema definition sites. */
export function defineSchema(schema: AIJsonSchema): AIJsonSchema {
  return schema;
}

/** A schema as it may arrive: neutral, Gemini-dialect, or partially migrated. */
type LooseSchema = Record<string, unknown>;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
]);

function isRecord(value: unknown): value is LooseSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a node's type in canonical lowercase, accepting either dialect.
 *
 * Returns `undefined` for a node with no recognisable type so the caller can
 * pass it through untouched rather than inventing one — a schema fragment we
 * do not understand is safer forwarded than rewritten.
 */
function canonicalType(node: LooseSchema): AISchemaType | undefined {
  const raw = node.type;
  if (typeof raw !== 'string') return undefined;
  const lower = raw.toLowerCase();
  return VALID_TYPES.has(lower) ? (lower as AISchemaType) : undefined;
}

/** Recursively rewrite a schema tree, applying `renderType` at every node. */
function mapSchema(
  node: unknown,
  renderType: (type: AISchemaType) => string,
): unknown {
  if (Array.isArray(node)) return node.map((entry) => mapSchema(entry, renderType));
  if (!isRecord(node)) return node;

  const out: LooseSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') {
      const type = canonicalType(node);
      // Unrecognised type: forward verbatim rather than guess.
      out.type = type ? renderType(type) : value;
      continue;
    }
    if (key === 'properties' && isRecord(value)) {
      const props: LooseSchema = {};
      for (const [prop, child] of Object.entries(value)) {
        props[prop] = mapSchema(child, renderType);
      }
      out.properties = props;
      continue;
    }
    if (key === 'items') {
      out.items = mapSchema(value, renderType);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Translate a schema into Google's dialect: same tree, uppercase type names.
 *
 * Accepts a schema already in Gemini dialect and returns it unchanged in
 * substance, so this is safe to apply unconditionally at the SDK boundary.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (schema === undefined || schema === null) return schema;
  return mapSchema(schema, (type) => type.toUpperCase());
}

/**
 * Translate a schema into standard JSON Schema for OpenAI-style backends.
 *
 * Beyond lowercasing, strict mode imposes two rules that Gemini does not:
 * every object must carry `additionalProperties: false`, and every declared
 * property must appear in `required`. Backends reject a strict schema that
 * omits either, so the adapter supplies them rather than leaving each of the
 * definition sites to remember a rule that only one provider has.
 */
export function toJsonSchema(schema: unknown): unknown {
  if (schema === undefined || schema === null) return schema;
  return tightenForStrict(mapSchema(schema, (type) => type));
}

/** Apply the strict-mode obligations to every object node in the tree. */
function tightenForStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tightenForStrict);
  if (!isRecord(node)) return node;

  const out: LooseSchema = { ...node };

  if (isRecord(out.properties)) {
    const props: LooseSchema = {};
    for (const [key, child] of Object.entries(out.properties)) {
      props[key] = tightenForStrict(child);
    }
    out.properties = props;
  }
  if (out.items !== undefined) out.items = tightenForStrict(out.items);

  if (canonicalType(out) === 'object' && isRecord(out.properties)) {
    out.additionalProperties = false;
    // Strict mode has no notion of an optional property: every key must be
    // listed. Optionality is expressed by the model returning null, which the
    // domain's own validators already tolerate.
    out.required = Object.keys(out.properties);
  }
  return out;
}

/**
 * Wrap a neutral schema in the `response_format` envelope OpenAI-style
 * backends expect. Kept here, beside the translation, so a provider never has
 * to know the envelope's shape by heart.
 */
export function toResponseFormat(
  schema: unknown,
  name = 'arky_response',
): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema: toJsonSchema(schema),
    },
  };
}
