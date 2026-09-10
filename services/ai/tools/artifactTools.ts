/**
 * The tools the assistant may offer the model.
 *
 * There is exactly one today, and it was declared **twice** — once in
 * `processAssistantChat` and once in `processAssistantChatStream`, in Google's
 * `functionDeclarations` shape, with a comment above the second copy promising
 * the two methods stayed "in lock-step so the model never sees a different
 * identity depending on whether the UI used streaming". They did not: the
 * streamed copy described `newContent` as "The complete new content for the
 * artifact" and `target` as "'current' or 'new_version'", while the buffered
 * copy spelled out that the model must ask the user first and that the content
 * has to be valid for the artifact's type. A tool description *is* the
 * instruction the model follows when deciding how to call it, so the streamed
 * assistant was working from a weaker brief than the buffered one for the same
 * request.
 *
 * One declaration, in the neutral dialect, is the fix for both problems at once.
 */

import { defineSchema } from '../schema';
import type { AIToolDefinition } from '../core/AITool';

/** Name the model echoes back; the assistant branches on it. */
export const MODIFY_ARTIFACT_TOOL_NAME = 'modifyArtifact';

export const MODIFY_ARTIFACT_TOOL: AIToolDefinition = {
  name: MODIFY_ARTIFACT_TOOL_NAME,
  description:
    "Modifies the active artifact based on the user's instructions. MUST ask the user FIRST whether to apply the changes to the current artifact or to create a new version.",
  parameters: defineSchema({
    type: 'object',
    description:
      "Modifies the active artifact based on the user's instructions. MUST ask the user FIRST if they want to apply changes to the current artifact or create a new version.",
    properties: {
      newContent: {
        type: 'string',
        description:
          "The complete new content for the artifact, incorporating the requested changes. Must be valid for the artifact's type (e.g. Markdown, Mermaid, JSON).",
      },
      target: {
        type: 'string',
        description:
          "Whether to apply the changes to the 'current' artifact or create a 'new_version'.",
        enum: ['current', 'new_version'],
      },
    },
    required: ['newContent', 'target'],
  }),
};
