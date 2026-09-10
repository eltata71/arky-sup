/**
 * The canonical content contract, and what it replaced.
 *
 * `AIRequest` used to describe multimodal payloads as `rawContents?: unknown`,
 * documented as "e.g. Gemini `Content[]` with inline base64 parts" — a vendor
 * wire format sitting in the provider-agnostic contract. Nothing ever set it,
 * which is the tell: a canonical multimodal path did not exist, so the legacy
 * Gemini façade kept its own and every other adapter had nothing to map.
 */

import { describe, expect, it } from 'vitest';
import {
  contentNeeds,
  contentToText,
  textPart,
  toContentParts,
  type AIContentPart,
} from '../../../../services/ai/core/AIContent';
import {
  collapsePrompt,
  deriveRequiredCapabilities,
  type AIRequest,
} from '../../../../services/ai/core/AIRequest';
import { toolCallPart, toolResultPart } from '../../../../services/ai/core/AITool';

const IMAGE: AIContentPart = { kind: 'image', mimeType: 'image/png', data: 'AAA' };
const FILE: AIContentPart = { kind: 'file', mimeType: 'application/pdf', data: 'BBB', name: 'adr.pdf' };

describe('content parts', () => {
  it('treats a plain string as a single text part', () => {
    expect(toContentParts('hola')).toEqual([textPart('hola')]);
  });

  /**
   * The rule that matters: a part a backend cannot carry is *named*, not
   * dropped. A model handed a prompt that silently lost its attachment answers
   * confidently about nothing, which is worse than one told the image was
   * present and unavailable.
   */
  it('names a part it cannot render instead of dropping it', () => {
    const text = contentToText([textPart('Analiza esto'), IMAGE, FILE]);
    expect(text).toContain('Analiza esto');
    expect(text).toContain('imagen adjunta');
    expect(text).toContain('adr.pdf');
  });

  it('renders a tool call and its result legibly', () => {
    const text = contentToText([
      toolCallPart({ toolCallId: 'c1', name: 'modifyArtifact', arguments: { target: 'current' } }),
      toolResultPart({ toolCallId: 'c1', name: 'modifyArtifact', result: { ok: true } }),
    ]);
    expect(text).toContain('modifyArtifact');
    expect(text).toContain('current');
  });

  it('marks a failed tool result as an error rather than as a value', () => {
    const text = contentToText([
      toolResultPart({ toolCallId: 'c1', name: 'x', result: 'boom', isError: true }),
    ]);
    expect(text).toContain('error');
  });

  it('reports which capabilities a message needs', () => {
    expect(contentNeeds([textPart('a'), IMAGE])).toEqual({
      images: true,
      files: false,
      tools: false,
    });
  });

  it('collapses a multi-part conversation into a prompt without losing a turn', () => {
    const prompt = collapsePrompt(
      [
        { role: 'user', content: 'Primera' },
        { role: 'assistant', content: [textPart('Segunda'), IMAGE] },
      ],
      'Sé breve.',
    );
    expect(prompt).toContain('Sé breve.');
    expect(prompt).toContain('Primera');
    expect(prompt).toContain('Segunda');
    expect(prompt).toContain('imagen adjunta');
  });
});

describe('deriveRequiredCapabilities', () => {
  const req = (over: Partial<AIRequest> = {}): AIRequest => ({
    purpose: 't',
    prompt: 'p',
    ...over,
  });

  it('needs nothing for a plain text request', () => {
    expect(deriveRequiredCapabilities(req())).toEqual([]);
  });

  /**
   * Derived, not trusted. A request carrying a schema needs structured output
   * whether or not anyone wrote that down — leaving it to callers is how the
   * requirement came to be checked in one place and ignored in the one that
   * could act on it.
   */
  it('derives structured output from a schema the caller never declared', () => {
    const [need] = deriveRequiredCapabilities(req({ responseSchema: { type: 'object' } }));
    expect(need.capability).toBe('structured-output');
    expect(need.level).toBe('preferred');
  });

  it('raises the schema to `required` when the policy demands it', () => {
    const [need] = deriveRequiredCapabilities(req({ responseSchema: { type: 'object' } }), {
      structuredOutputRequired: true,
    });
    expect(need.level).toBe('required');
  });

  it('treats tools and attachments as required, because there is no weaker version', () => {
    const needs = deriveRequiredCapabilities(
      req({
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
        attachments: [IMAGE, FILE],
      }),
    );
    expect(needs.filter((n) => n.level === 'required').map((n) => n.capability).sort()).toEqual([
      'files',
      'images',
      'tools',
    ]);
  });

  it('lets the stronger level win when the same capability is asked for twice', () => {
    const needs = deriveRequiredCapabilities(
      req({
        responseSchema: { type: 'object' },
        requiredCapabilities: [{ capability: 'structured-output', level: 'required' }],
      }),
    );
    expect(needs).toHaveLength(1);
    expect(needs[0].level).toBe('required');
  });

  it('carries the caller’s reason through, so a refusal can explain itself', () => {
    const [need] = deriveRequiredCapabilities(
      req({
        requiredCapabilities: [
          { capability: 'images', level: 'required', reason: 'El usuario adjuntó un plano.' },
        ],
      }),
    );
    expect(need.reason).toContain('plano');
  });
});
