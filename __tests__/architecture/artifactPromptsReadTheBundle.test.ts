/**
 * Every prompt that works on an artifact reads the one context bundle and
 * fences the artifact's body (plan de calidad de artefactos, 7.3a).
 *
 * Seven composers used to answer «what context does the model get» each its
 * own way, and the answer depended on the button: the refinement read eight
 * unordered notes, the critique none, the suggestions judged the artifact
 * against nothing — and five of the eight paths sent the artifact's body
 * unfenced. The bench measures the outcome; this scan keeps the cause from
 * returning in a new module the bench does not cover yet.
 *
 * It reads the code, not the comments: a file that mentions the bundle only in
 * a docblock does not pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** The modules that compose a prompt about an artifact. A new one joins the list. */
const ARTIFACT_PROMPT_MODULES = [
  'services/ai/generation/artifactQualityRefinement.ts',
  'services/ai/generation/artifactReview.ts',
  'services/ai/generation/artifactSuggestions.ts',
  'services/ai/generation/presentationDeck.ts',
  'services/ai/generation/documents/documentConversions.ts',
  'services/ai/generation/documents/sddDocuments.ts',
  'services/ai/generation/artifacts/artifactGenerationEngine.ts',
  'services/artifacts/application/diagramModification.ts',
  'services/agent/agentContextComposer.ts',
] as const;

/** What reading the bundle looks like in code: one of its doors. */
const READS_THE_BUNDLE = /\b(buildBasePrompt(Util)?|assembleArtifactContext|renderArtifactContextBundle|renderDiagramContextBundle)\s*\(|context\.contextBlock/;

/** An artifact body interpolated straight into a template literal. */
const RAW_ARTIFACT_BODY = /\$\{\s*(artifact|request|activeArtifact)\.content\s*\}/;

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('artifact prompts read the one context bundle', () => {
  it.each(ARTIFACT_PROMPT_MODULES)('%s composes its context from the bundle', (file) => {
    const code = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
    expect(code).toMatch(READS_THE_BUNDLE);
  });
});

/**
 * `diagramModification` composes the edit's context but writes artifact
 * bodies too — the patched Mermaid it saves — which is content, not a prompt:
 * its prompt is written by the diagram edit vertical.
 */
const PROMPT_BODY_MODULES = ARTIFACT_PROMPT_MODULES.filter((file) => file !== 'services/artifacts/application/diagramModification.ts');

describe('artifact prompts fence the artifact they send', () => {
  it.each(PROMPT_BODY_MODULES)('%s never sends an artifact body unfenced', (file) => {
    const code = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
    expect(code).not.toMatch(RAW_ARTIFACT_BODY);
  });
});
