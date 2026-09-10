import { describe, it, expect } from 'vitest';
import { parseSSE, openRouterDelta } from '../../../../services/ai/providers/openrouter/sse';

function streamFrom(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) {
    for (const l of lines) c.enqueue(enc.encode(l + '\n'));
    c.close();
  }});
}

describe('parseSSE', () => {
  it('extrae los data de cada evento y omite keep-alives', async () => {
    const s = streamFrom(['data: {"a":1}', '', 'data: {"b":2}', 'data: [DONE]', '']);
    const out: string[] = [];
    for await (const d of parseSSE(s)) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('openRouterDelta', () => {
  it('extrae delta.content', () => {
    expect(openRouterDelta({ choices: [{ delta: { content: 'Hola' } }] })).toBe('Hola');
  });
  it('devuelve string vacío si no hay delta.content', () => {
    expect(openRouterDelta({ choices: [{ delta: {} }] })).toBe('');
  });
});
