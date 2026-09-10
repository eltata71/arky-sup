import { describe, expect, it } from 'vitest';
import {
  defineSchema,
  parseStructured,
} from '../../../services/ai/structuredOutput';

describe('structuredOutput.parseStructured', () => {
  it('parses clean JSON without repairs', () => {
    const result = parseStructured<{ a: number }>('{"a":1}');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ a: 1 });
    expect(result.repaired).toBe(false);
  });

  it('repairs fenced and truncated model JSON (malformed response)', () => {
    const result = parseStructured<{ items: number[] }>('```json\n{"items":[1,2,3');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ items: [1, 2, 3] });
    expect(result.repaired).toBe(true);
  });

  it('reports a failure for irrecoverable input without throwing', () => {
    const result = parseStructured('not json at all <<<');
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it('honours the emptyAs option for empty input', () => {
    const result = parseStructured<unknown[]>('', { emptyAs: 'array' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('defineSchema is an identity helper', () => {
    const schema = defineSchema({ type: 'object', properties: { x: { type: 'string' } } });
    expect(schema.type).toBe('object');
  });
});
