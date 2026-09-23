/**
 * Review, improvement and test cases for an artifact that already exists
 * (F5-01, corte 11).
 *
 * The three prompts left the engine as they were — same wording, same
 * temperatures, same retry budget — and reach a model through `aiGateway`.
 * They share one trait that made them a clean cut: each reads a stored
 * artifact plus its project's base prompt, and none needs the generation
 * pipeline, the Office personas or the knowledge graph.
 *
 * The suggestion shape is declared here as a port rather than imported from
 * `services/review`: `ArtifactReviewSuggestion` is structurally identical, so
 * callers pass it unchanged, and this layer gains no dependency on the review
 * context for one interface.
 */
import type { Settings } from '../../../types';
import { cleanJsonString } from '../../../utils';
import type { Project } from '../../architectureProjects';
import type { Artifact } from '../../../lib/artifacts';
import { resolveModelForSettings } from '../catalog';
import { buildBasePrompt } from '../prompts/projectPrompts';
import { aiGateway } from './aiGateway';

export type ArtifactImprovementCategory =
  | 'Security'
  | 'Performance'
  | 'Scalability'
  | 'Best Practices'
  | 'Clarity';

/** One improvement proposed for an artifact — the review context's suggestion, by shape. */
export interface ArtifactImprovementProposal {
  id: string;
  title: string;
  description: string;
  category: ArtifactImprovementCategory;
}

const IMPROVEMENT_CATEGORIES: readonly ArtifactImprovementCategory[] = [
  'Security',
  'Performance',
  'Scalability',
  'Best Practices',
  'Clarity',
];

/**
 * Keep only the entries that arrived with the declared shape. The engine
 * returned `JSON.parse` as-is, so a model that dropped a field or invented a
 * category put an entry the review panel could not render into its list.
 */
export const toImprovementProposals = (value: unknown): ArtifactImprovementProposal[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ArtifactImprovementProposal => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.id === 'string'
      && typeof candidate.title === 'string'
      && typeof candidate.description === 'string'
      && IMPROVEMENT_CATEGORIES.includes(candidate.category as ArtifactImprovementCategory);
  });
};

export async function reviewArtifact(
  artifact: Artifact,
  project: Project,
  settings: Settings,
): Promise<ArtifactImprovementProposal[]> {
  const basePrompt = buildBasePrompt(project, settings);

  const prompt = `
${basePrompt}

TASK: Review this specific artifact and suggest tangible improvements based on industry best practices, security, scalability, and clarity.
Artifact Name: ${artifact.name}
Type: ${artifact.type}
Content:
${artifact.content}

Return a JSON Array of improvements: [{ "id": "uuid", "title": "short title", "description": "detailed explanation", "category": "Security" | "Performance" | "Scalability" | "Best Practices" | "Clarity" }]
`;
  const modelName = resolveModelForSettings('default', settings).id;

  try {
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string', enum: [...IMPROVEMENT_CATEGORIES] },
          },
          required: ['id', 'title', 'description', 'category'],
        },
      },
    });
    const cleanJson = cleanJsonString(text || '');
    return toImprovementProposals(JSON.parse(cleanJson || '[]'));
  } catch (e) {
    console.error('Artifact Review Error:', e);
    return [];
  }
}

export async function applyArtifactImprovements(
  artifact: Artifact,
  selectedImprovements: ArtifactImprovementProposal[],
  project: Project,
  settings: Settings,
): Promise<string> {
  const basePrompt = buildBasePrompt(project, settings);

  const prompt = `
${basePrompt}

TASK: Rewrite the following artifact content to incorporate SPECIFIC improvements.
Original Content:
${artifact.content}

Selected Improvements to Apply:
${selectedImprovements.map((imp) => `- [${imp.category}] ${imp.title}: ${imp.description}`).join('\n')}

INSTRUCTIONS:
1. Maintain the original format (Markdown, Mermaid, JSON, etc.).
2. Apply ONLY the selected improvements.
3. Return ONLY the full, updated content code. No explanations.
`;
  // A quota or rate limit on the preferred model rotates to the next one in
  // the fallback chain instead of surfacing a hard error.
  const preferredModel = resolveModelForSettings('default', settings).id;
  const result = await aiGateway.generateContent(
    settings,
    preferredModel,
    prompt,
    { temperature: 0.3 },
    { maxRetries: 1, maxCandidates: 4 },
  );
  return result.text || artifact.content;
}

export async function generateTestCases(
  artifact: Artifact,
  project: Project,
  settings: Settings,
): Promise<string> {
  const basePrompt = buildBasePrompt(project, settings);
  const language = settings.language === 'es' ? 'Spanish' : 'English';

  const prompt = `
${basePrompt}

TASK: Generate a comprehensive set of AUTOMATED TEST CASES for the following architectural artifact.
Artifact Name: ${artifact.name}
Type: ${artifact.type}
Objective: ${artifact.objective}
Content:
${artifact.content}

INSTRUCTIONS:
1. Provide a mix of Unit, Integration, and E2E test cases where applicable.
2. Use a structured format (e.g., Gherkin/Cucumber for behavior, or a technical test plan).
3. Include:
   - Test Case ID and Title
   - Pre-conditions
   - Test Steps
   - Expected Result
   - Automated Snippet (e.g., Jest, Playwright, or Gherkin)
4. Focus on the architectural constraints and objectives defined in the artifact.
5. Respond ONLY with the Markdown content.
6. Language: ${language}.
`;
  const modelName = resolveModelForSettings('default', settings).id;

  const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
    temperature: 0.7,
  });
  return text || 'Error generating test cases.';
}
