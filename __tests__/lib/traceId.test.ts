/**
 * Specs for the shared trace id.
 *
 * Two properties matter and they pull apart: a request must always end up
 * traceable, and a client-supplied header must never be echoed or logged
 * unless it is a shape we chose. `resolveTraceId` is where both meet, and it
 * is called on the serverless side with an attacker-controlled value.
 */

import { describe, expect, it } from 'vitest';
import { MAX_TRACE_ID_LENGTH, isTraceId, newTraceId, resolveTraceId, TRACE_ID_HEADER } from '../../lib/traceId';

describe('newTraceId', () => {
  it('produces a valid id that names its purpose', () => {
    const id = newTraceId('artifact-generation');
    expect(isTraceId(id)).toBe(true);
    expect(id).toContain('artifact-generation');
  });

  it('normalises an awkward purpose instead of producing an invalid id', () => {
    for (const purpose of ['Generación de Artefactos', '  ', '///', 'A'.repeat(80)]) {
      expect(isTraceId(newTraceId(purpose))).toBe(true);
    }
  });

  it('never exceeds the header budget', () => {
    expect(newTraceId('a'.repeat(200)).length).toBeLessThanOrEqual(MAX_TRACE_ID_LENGTH);
  });

  it('does not collide across rapid successive calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newTraceId('op')));
    expect(ids.size).toBe(500);
  });
});

describe('isTraceId rejects what must not reach a log', () => {
  it('rejects a value carrying a newline, which would forge log entries', () => {
    expect(isTraceId('abcdefgh\nlevel=error fake')).toBe(false);
    expect(isTraceId('abcdefgh\r\nfake')).toBe(false);
  });

  it('rejects whitespace, quotes and separators', () => {
    for (const value of ['abc defgh', 'abcdefg"h', "abcdefg'h", 'abcdefg;h', 'abcdef|gh', 'abcdefg,h']) {
      expect(isTraceId(value)).toBe(false);
    }
  });

  it('rejects an over-long value before any pattern work', () => {
    expect(isTraceId('a'.repeat(MAX_TRACE_ID_LENGTH + 1))).toBe(false);
  });

  it('rejects a value that is too short to be meaningful', () => {
    expect(isTraceId('abc')).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isTraceId(value)).toBe(false);
    }
  });

  it('accepts the ids this system mints', () => {
    for (const purpose of ['ai-proxy', 'lesson', 'artifact-generation']) {
      expect(isTraceId(newTraceId(purpose))).toBe(true);
    }
  });
});

describe('resolveTraceId', () => {
  it('adopts a valid caller id, which is the whole point of correlation', () => {
    const fromClient = newTraceId('ai-proxy');
    expect(resolveTraceId(fromClient, 'aiproxy')).toBe(fromClient);
  });

  it('mints a fresh id rather than propagating a hostile one', () => {
    const hostile = 'abcdefgh\nlevel=error injected';
    const resolved = resolveTraceId(hostile, 'aiproxy');
    expect(resolved).not.toBe(hostile);
    expect(resolved).not.toContain('\n');
    expect(isTraceId(resolved)).toBe(true);
  });

  it('always yields a traceable id, however absent the header', () => {
    for (const value of [undefined, null, '', 'x']) {
      expect(isTraceId(resolveTraceId(value, 'aiproxy'))).toBe(true);
    }
  });
});

describe('the header name is shared by both sides', () => {
  it('is lowercase, so a Node header lookup finds it', () => {
    expect(TRACE_ID_HEADER).toBe(TRACE_ID_HEADER.toLowerCase());
  });
});
