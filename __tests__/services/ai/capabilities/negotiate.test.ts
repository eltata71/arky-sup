/**
 * Degradation is allowed; silent degradation is the defect. These tests pin
 * down that a provider asked for something it cannot do still runs the request
 * and leaves a record — the missing half of the original design, where the
 * call succeeded and the weaker guarantee was invisible above.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRequiredCapabilities,
  negotiateCapabilities,
  negotiateAndReport,
  reportCapabilityGaps,
} from '../../../../services/ai/capabilities';
import { AIError } from '../../../../services/ai/core/AIError';
import { observabilityService } from '../../../../services/observability';
import type { AIProviderCapabilities } from '../../../../services/ai/core/AICapabilities';
import type { AIProvider } from '../../../../services/ai/core/AIProvider';
import type { AIRequest } from '../../../../services/ai/core/AIRequest';
import type { AIToolDefinition } from '../../../../services/ai/core/AITool';

type Caps = Partial<AIProviderCapabilities>;

const providerWith = (caps: Caps): AIProvider =>
  ({
    id: 'openrouter',
    name: 'Test provider',
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: true,
      images: false,
      files: false,
      audio: false,
      ...caps,
    },
  }) as unknown as AIProvider;

const TOOL: AIToolDefinition = {
  name: 'modifyArtifact',
  description: 'edita el artefacto',
  parameters: { type: 'object', properties: { target: { type: 'string' } } },
};

const req = (over: Partial<AIRequest> = {}): AIRequest => ({
  purpose: 'test',
  prompt: 'hola',
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('negotiateCapabilities', () => {
  it('finds no gap when the provider can serve the request', () => {
    const gaps = negotiateCapabilities(
      providerWith({}),
      req({ responseSchema: { type: 'object' } }),
    );
    expect(gaps).toEqual([]);
  });

  it('reports a structured-output gap when a schema was asked for', () => {
    const gaps = negotiateCapabilities(
      providerWith({ structuredOutput: false }),
      req({ responseSchema: { type: 'object' } }),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].capability).toBe('structured-output');
    expect(gaps[0].effect.length).toBeGreaterThan(0);
  });

  it('stays quiet when no schema was asked for, even if unsupported', () => {
    const gaps = negotiateCapabilities(providerWith({ structuredOutput: false }), req());
    expect(gaps).toEqual([]);
  });

  it('reports a tools gap from the declared record, not from an optional cast', () => {
    const withTools = req({ tools: [TOOL] });
    expect(negotiateCapabilities(providerWith({ tools: false }), withTools)).toHaveLength(1);
    expect(negotiateCapabilities(providerWith({ tools: true }), withTools)).toEqual([]);
  });

  it('treats tool support as a required capability, never a preference', () => {
    const [gap] = negotiateCapabilities(providerWith({ tools: false }), req({ tools: [TOOL] }));
    expect(gap.level).toBe('required');
  });

  it('leaves a schema at `preferred` by default and raises it when the policy says required', () => {
    const request = req({ responseSchema: { type: 'object' } });
    const provider = providerWith({ structuredOutput: false });
    expect(negotiateCapabilities(provider, request)[0].level).toBe('preferred');
    expect(
      negotiateCapabilities(provider, request, { structuredOutputRequired: true })[0].level,
    ).toBe('required');
  });

  it('reports a streaming gap only when streaming was requested', () => {
    const provider = providerWith({ streaming: false });
    expect(negotiateCapabilities(provider, req(), { streaming: true })).toHaveLength(1);
    expect(negotiateCapabilities(provider, req())).toEqual([]);
  });

  it('reports every gap a request opens, not just the first', () => {
    const gaps = negotiateCapabilities(
      providerWith({ structuredOutput: false, streaming: false, tools: false }),
      req({ responseSchema: { type: 'object' }, tools: [TOOL] }),
      { streaming: true },
    );
    expect(gaps.map((g) => g.capability).sort()).toEqual([
      'streaming',
      'structured-output',
      'tools',
    ]);
  });
});

describe('reportCapabilityGaps', () => {
  it('records one observability warning per gap', () => {
    const spy = vi.spyOn(observabilityService, 'recordWarning').mockReturnValue({} as never);

    reportCapabilityGaps(
      [
        { capability: 'structured-output', provider: 'openrouter', level: 'preferred', effect: 'sin esquema' },
        { capability: 'tools', provider: 'openrouter', level: 'required', effect: 'sin funciones' },
      ],
      { purpose: 'artifact-generation', requestId: 'req-1', model: 'openrouter/auto' },
    );

    expect(spy).toHaveBeenCalledTimes(2);
    const [first] = spy.mock.calls[0];
    expect(first.metadata).toMatchObject({
      capability: 'structured-output',
      provider: 'openrouter',
      model: 'openrouter/auto',
    });
  });

  it('says nothing when there is nothing to say', () => {
    const spy = vi.spyOn(observabilityService, 'recordWarning').mockReturnValue({} as never);
    reportCapabilityGaps([], { purpose: 'x' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('never blocks the request — it reports and returns the gaps', () => {
    vi.spyOn(observabilityService, 'recordWarning').mockReturnValue({} as never);
    const gaps = negotiateAndReport(
      providerWith({ structuredOutput: false }),
      req({ responseSchema: { type: 'object' } }),
    );
    expect(gaps).toHaveLength(1);
  });
});
