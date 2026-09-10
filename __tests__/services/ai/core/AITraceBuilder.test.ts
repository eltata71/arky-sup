import { describe, expect, it } from 'vitest';
import { AITraceBuilder, newRequestId } from '../../../../services/ai/tracing/AITraceBuilder';
import type { AIModelDescriptor } from '../../../../services/ai/core/AIModel';

const route: AIModelDescriptor = {
  id: 'gemini-2.5-flash',
  tier: 'default',
  source: 'global',
  fallbackChain: ['gemini-2.5-pro'],
};

const builder = () =>
  new AITraceBuilder({
    requestId: 'req-1',
    operationId: 'op-1',
    purpose: 'unit-test',
    provider: 'gemini',
    route,
    mode: 'balanced',
    timeoutMs: 90_000,
    structuredOutput: false,
    streaming: false,
    contextPackId: 'ctx-42',
  });

describe('AITraceBuilder', () => {
  it('newRequestId mints unique, prefixed ids', () => {
    const a = newRequestId('artifact gen');
    const b = newRequestId('artifact gen');
    expect(a).not.toBe(b);
    expect(a.startsWith('ai-artifact-gen-')).toBe(true);
  });

  it('seals a successful trace with all observability fields', () => {
    const trace = builder().success({ durationMs: 12, totalTokens: 99 });
    expect(trace.requestId).toBe('req-1');
    expect(trace.operationId).toBe('op-1');
    expect(trace.purpose).toBe('unit-test');
    expect(trace.provider).toBe('gemini');
    expect(trace.modelRequested).toBe('gemini-2.5-flash');
    expect(trace.modelEffective).toBe('gemini-2.5-flash');
    expect(trace.modelSource).toBe('global');
    expect(trace.fallbackModelUsed).toBe(false);
    expect(trace.tier).toBe('default');
    expect(trace.mode).toBe('balanced');
    expect(trace.retryCount).toBe(0);
    expect(trace.timeoutMs).toBe(90_000);
    expect(trace.status).toBe('success');
    expect(trace.contextPackId).toBe('ctx-42');
    expect(trace.usage?.totalTokens).toBe(99);
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records retries and model fallback', () => {
    const b = builder();
    b.recordRetry();
    b.recordRetry();
    b.recordModelFallback('gemini-2.5-pro');
    const trace = b.success();
    expect(trace.retryCount).toBe(2);
    expect(trace.fallbackModelUsed).toBe(true);
    expect(trace.fallbackModel).toBe('gemini-2.5-pro');
    expect(trace.modelEffective).toBe('gemini-2.5-pro');
  });

  it('seals an error trace with the error category', () => {
    const trace = builder().error('overloaded');
    expect(trace.status).toBe('error');
    expect(trace.errorCategory).toBe('overloaded');
  });

  it('marks a local fallback as a recovered (fallback) trace', () => {
    const b = builder();
    b.recordLocalFallback();
    const trace = b.error('timeout');
    expect(trace.localFallbackUsed).toBe(true);
    expect(trace.status).toBe('fallback');
  });
});
