/**
 * The schema translator is the load-bearing piece of model independence: every
 * structured generation in the product passes through it. These tests fix its
 * behaviour in both directions and, above all, fix the *input tolerance* that
 * lets hundreds of definition sites migrate one file at a time.
 */

import { describe, expect, it } from 'vitest';
import {
  defineSchema,
  toGeminiSchema,
  toJsonSchema,
  toResponseFormat,
} from '../../../../services/ai/schema';

/** The neutral form: standard JSON Schema, lowercase type names. */
const NEUTRAL = defineSchema({
  type: 'object',
  required: ['name', 'nodes'],
  properties: {
    name: { type: 'string', description: 'Nombre del diagrama' },
    score: { type: 'number' },
    level: { type: 'string', enum: ['context', 'container'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          weight: { type: 'integer' },
          external: { type: 'boolean' },
        },
      },
    },
  },
});

/** The same schema as the legacy call sites still write it. */
const GEMINI_DIALECT = {
  type: 'OBJECT',
  required: ['name', 'nodes'],
  properties: {
    name: { type: 'STRING', description: 'Nombre del diagrama' },
    score: { type: 'NUMBER' },
    level: { type: 'STRING', enum: ['context', 'container'] },
    nodes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id'],
        properties: {
          id: { type: 'STRING' },
          weight: { type: 'INTEGER' },
          external: { type: 'BOOLEAN' },
        },
      },
    },
  },
};

describe('toGeminiSchema', () => {
  it('renders every type name in Google’s uppercase dialect', () => {
    const out = toGeminiSchema(NEUTRAL) as Record<string, never>;
    expect(JSON.stringify(out)).toEqual(JSON.stringify(GEMINI_DIALECT));
  });

  it('descends into nested objects and array items', () => {
    const out = toGeminiSchema(NEUTRAL) as Record<string, Record<string, Record<string, { type: string }>>>;
    expect(out.properties.nodes.items.type as unknown).toBe('OBJECT');
  });

  it('leaves a schema already in Gemini dialect unchanged', () => {
    expect(toGeminiSchema(GEMINI_DIALECT)).toEqual(GEMINI_DIALECT);
  });

  it('is idempotent, so applying it at the boundary is always safe', () => {
    const once = toGeminiSchema(NEUTRAL);
    expect(toGeminiSchema(once)).toEqual(once);
  });

  it('preserves description, enum and required verbatim', () => {
    const out = toGeminiSchema(NEUTRAL) as {
      required: string[];
      properties: Record<string, { description?: string; enum?: unknown[] }>;
    };
    expect(out.required).toEqual(['name', 'nodes']);
    expect(out.properties.name.description).toBe('Nombre del diagrama');
    expect(out.properties.level.enum).toEqual(['context', 'container']);
  });

  it('passes an unrecognised type through rather than guessing at it', () => {
    const odd = { type: 'geo-point', properties: {} };
    expect(toGeminiSchema(odd)).toMatchObject({ type: 'geo-point' });
  });

  it('returns undefined and null untouched', () => {
    expect(toGeminiSchema(undefined)).toBeUndefined();
    expect(toGeminiSchema(null)).toBeNull();
  });
});

describe('toJsonSchema', () => {
  it('renders every type name in standard lowercase', () => {
    const out = toJsonSchema(GEMINI_DIALECT) as { type: string; properties: Record<string, { type: string }> };
    expect(out.type).toBe('object');
    expect(out.properties.name.type).toBe('string');
    expect(out.properties.score.type).toBe('number');
  });

  it('accepts the neutral dialect unchanged in substance', () => {
    const fromNeutral = toJsonSchema(NEUTRAL);
    const fromGemini = toJsonSchema(GEMINI_DIALECT);
    expect(fromNeutral).toEqual(fromGemini);
  });

  it('closes every object to additional properties, as strict mode demands', () => {
    const out = toJsonSchema(NEUTRAL) as {
      additionalProperties: boolean;
      properties: Record<string, { items?: { additionalProperties?: boolean } }>;
    };
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.nodes.items?.additionalProperties).toBe(false);
  });

  it('lists every declared property as required, as strict mode demands', () => {
    const out = toJsonSchema(NEUTRAL) as { required: string[] };
    expect(out.required).toEqual(['name', 'score', 'level', 'nodes']);
  });

  it('applies the strict obligations at every depth, not only the root', () => {
    const out = toJsonSchema(NEUTRAL) as {
      properties: { nodes: { items: { required: string[] } } };
    };
    expect(out.properties.nodes.items.required).toEqual(['id', 'weight', 'external']);
  });

  it('is idempotent', () => {
    const once = toJsonSchema(NEUTRAL);
    expect(toJsonSchema(once)).toEqual(once);
  });
});

describe('toResponseFormat', () => {
  it('wraps the translated schema in the json_schema envelope', () => {
    const format = toResponseFormat(NEUTRAL) as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: { type: string } };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.type).toBe('object');
  });

  it('accepts a caller-supplied schema name', () => {
    const format = toResponseFormat(NEUTRAL, 'diagram_ir') as {
      json_schema: { name: string };
    };
    expect(format.json_schema.name).toBe('diagram_ir');
  });
});

describe('round trip', () => {
  /**
   * The property that makes the migration safe: whichever dialect a call site
   * is written in today, both backends receive the schema they understand.
   */
  it('lands the same shape at both backends from either input dialect', () => {
    expect(toGeminiSchema(NEUTRAL)).toEqual(toGeminiSchema(GEMINI_DIALECT));
    expect(toJsonSchema(NEUTRAL)).toEqual(toJsonSchema(GEMINI_DIALECT));
  });
});
