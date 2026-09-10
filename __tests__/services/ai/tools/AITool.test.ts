/**
 * A tool is declared once and translated per provider. These tests fix the
 * translation for all three shipped backends, and the fact that the assistant's
 * one tool has exactly one definition.
 *
 * They used to also cover `fromGeminiTools`, an adapter that read tool
 * definitions back *out* of Google's wire shape because the monolith assembled
 * `functionDeclarations` inline. Both call sites now declare
 * `MODIFY_ARTIFACT_TOOL`, so the arrow points one way and the recovery adapter
 * is gone rather than untested.
 */

import { describe, expect, it } from 'vitest';
import {
  MODIFY_ARTIFACT_TOOL,
  MODIFY_ARTIFACT_TOOL_NAME,
  toAnthropicTools,
  toGeminiTools,
  toOpenAITools,
  type AIToolDefinition,
} from '../../../../services/ai/tools';

const MODIFY: AIToolDefinition = {
  name: 'modifyArtifact',
  description: 'Aplica un cambio al artefacto activo.',
  parameters: {
    type: 'object',
    required: ['content'],
    properties: {
      content: { type: 'string', description: 'Contenido nuevo completo' },
      reason: { type: 'string' },
    },
  },
};

describe('toGeminiTools', () => {
  it('nests declarations the way Google expects', () => {
    const out = toGeminiTools([MODIFY]) as Array<{ functionDeclarations: unknown[] }>;
    expect(out).toHaveLength(1);
    expect(out[0].functionDeclarations).toHaveLength(1);
  });

  it('translates the parameter schema into Google’s dialect', () => {
    const out = toGeminiTools([MODIFY]) as Array<{
      functionDeclarations: Array<{ name: string; parameters: { type: string } }>;
    }>;
    const decl = out[0].functionDeclarations[0];
    expect(decl.name).toBe('modifyArtifact');
    expect(decl.parameters.type).toBe('OBJECT');
  });
});

describe('toOpenAITools', () => {
  it('emits the flat `type: function` shape', () => {
    const out = toOpenAITools([MODIFY]) as Array<{
      type: string;
      function: { name: string; parameters: { type: string } };
    }>;
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('function');
    expect(out[0].function.name).toBe('modifyArtifact');
    expect(out[0].function.parameters.type).toBe('object');
  });

  it('applies strict-mode obligations to the parameter schema', () => {
    const out = toOpenAITools([MODIFY]) as Array<{
      function: { parameters: { additionalProperties: boolean; required: string[] } };
    }>;
    expect(out[0].function.parameters.additionalProperties).toBe(false);
    expect(out[0].function.parameters.required).toEqual(['content', 'reason']);
  });
});

describe('toAnthropicTools', () => {
  it('emits Claude’s `input_schema` shape directly', () => {
    const out = toAnthropicTools([MODIFY]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('modifyArtifact');
    expect(out[0].description).toBe('Aplica un cambio al artefacto activo.');
    expect((out[0].input_schema as { type: string }).type).toBe('object');
  });
});

describe('MODIFY_ARTIFACT_TOOL', () => {
  /**
   * The buffered and streamed assistants each declared this tool inline, with
   * *different* descriptions: the streamed copy said only "The complete new
   * content for the artifact", while the buffered one required the model to ask
   * the user first. A tool description is the instruction the model follows, so
   * the two paths were briefing it differently for the same request.
   */
  it('is one definition, usable by every backend', () => {
    expect(MODIFY_ARTIFACT_TOOL.name).toBe(MODIFY_ARTIFACT_TOOL_NAME);
    expect(MODIFY_ARTIFACT_TOOL.description).toMatch(/MUST ask the user FIRST/);
    expect(MODIFY_ARTIFACT_TOOL.parameters.required).toEqual(['newContent', 'target']);

    const gemini = toGeminiTools([MODIFY_ARTIFACT_TOOL]) as Array<{
      functionDeclarations: Array<{ name: string }>;
    }>;
    expect(gemini[0].functionDeclarations[0].name).toBe(MODIFY_ARTIFACT_TOOL_NAME);
    expect(toOpenAITools([MODIFY_ARTIFACT_TOOL])).toHaveLength(1);
    expect(toAnthropicTools([MODIFY_ARTIFACT_TOOL])).toHaveLength(1);
  });

  it('constrains `target` to the two branches the assistant implements', () => {
    expect(MODIFY_ARTIFACT_TOOL.parameters.properties?.target.enum).toEqual([
      'current',
      'new_version',
    ]);
  });
});
