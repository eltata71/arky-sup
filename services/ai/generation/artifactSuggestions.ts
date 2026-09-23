/** The artifact suggestion prompt and inference, separate from report validation. */
import type { Settings } from '../../../types';
import { cleanJsonString } from '../../../utils';
import type { ArtifactSuggestionContext } from '../artifactSuggestionTypes';
import { resolveModelForSettings } from '../catalog';
import { aiGateway } from './aiGateway';

export async function suggestArtifactImprovements(
  context: ArtifactSuggestionContext,
  settings: Settings,
): Promise<unknown> {
  const language = context.language === 'en' ? 'English' : 'Spanish';
  const list = (label: string, items: string[]): string =>
    items.length > 0 ? `${label}:\n${items.map((item) => `- ${item}`).join('\n')}` : `${label}: (sin datos)`;

  const prompt = `You are a senior solutions architect and software architecture reviewer.
Your job is to analyze the CURRENT STATE of an architecture artifact and produce a prioritized,
ACTIONABLE list of recommendations that, if applied, would raise its quality before the user regenerates it.

ARTIFACT
- Name: ${context.artifactName}
- Type: ${context.artifactType}
- Representation: ${context.representation}
- Objective: ${context.objective || '(not specified)'}
- Original user request: ${context.originalPrompt || '(not available)'}
- Generation source: ${context.generationSource || '(unknown)'}
- AI model used: ${context.modelUsed || '(unknown)'}
- Current quality score: ${context.currentScore === null ? '(not available)' : `${context.currentScore}/100`}
- Quality summary: ${context.qualitySummary || '(not available)'}
- Trace status: ${context.traceStatus || '(unknown)'}

${list('Quality issues detected', context.qualityIssues)}
${list('Validation warnings', context.validationWarnings)}
${list('Generation errors recorded', context.traceErrors)}
${list('Decisions taken during generation', context.traceDecisions)}
${list('Generation lifecycle events', context.generationEvents)}
${list('Semantic refinement history', context.refinementHistory)}
${list('Detected business context', context.detectedBusinessInfo)}
${list('Detected technical context', context.detectedTechnicalInfo)}

ARTIFACT CONTENT (verbatim, may be truncated):
"""
${context.content || '(empty)'}
"""

INSTRUCTIONS
1. Produce a SHORT qualitySummary (1-2 sentences) describing the current quality state and the single biggest opportunity.
2. Produce a prioritized list of concrete, specific suggestions — NOT generic advice. Each suggestion must reference what is actually missing or weak in THIS artifact.
3. Each suggestion must include: title, description, gapType, impact, effort, recommendedAction, evidence, expectedQualityGain.
   - gapType must be one of: business, technical, data, integration, security, architecture, ux-ui, documentation, diagram, traceability.
   - impact must be one of: high, medium, low.
   - effort must be one of: low, medium, high.
   - recommendedAction: a concrete next step the USER can take (e.g. load more business context, define actors/systems/integrations, complete entities/fields/rules, clarify scope, add non-functional constraints, add assumptions/risks/decisions, fix ambiguities, generate a prerequisite artifact, or regenerate with a higher-quality strategy).
   - evidence: cite what in the artifact/trace justifies the suggestion.
   - expectedQualityGain: an integer 0-40 estimating quality points gained.
4. Order suggestions by descending impact, then ascending effort.
5. Aim for 3 to 7 suggestions. If the available context is too thin for high-confidence suggestions, set insufficientContext to true and fill missingContextHints with the minimal extra input the user should provide.
6. Be specific and avoid restating the artifact. Write all natural-language text in ${language}.

Return ONLY a JSON object with this shape:
{
  "qualitySummary": "string",
  "insufficientContext": false,
  "missingContextHints": ["string"],
  "suggestions": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "gapType": "business|technical|data|integration|security|architecture|ux-ui|documentation|diagram|traceability",
      "impact": "high|medium|low",
      "effort": "low|medium|high",
      "recommendedAction": "string",
      "evidence": "string",
      "expectedQualityGain": 0
    }
  ]
}`;

  const preferredModel = resolveModelForSettings('quick', settings).id;
  const { text } = await aiGateway.generateContent(
    settings,
    preferredModel,
    prompt,
    {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          qualitySummary: { type: 'string' },
          insufficientContext: { type: 'boolean' },
          missingContextHints: { type: 'array', items: { type: 'string' } },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                gapType: {
                  type: 'string',
                  enum: ['business', 'technical', 'data', 'integration', 'security', 'architecture', 'ux-ui', 'documentation', 'diagram', 'traceability'],
                },
                impact: { type: 'string', enum: ['high', 'medium', 'low'] },
                effort: { type: 'string', enum: ['low', 'medium', 'high'] },
                recommendedAction: { type: 'string' },
                evidence: { type: 'string' },
                expectedQualityGain: { type: 'number' },
              },
              required: ['title', 'description', 'gapType', 'impact', 'effort', 'recommendedAction', 'evidence'],
            },
          },
        },
        required: ['qualitySummary', 'insufficientContext', 'suggestions'],
      },
    },
    { maxRetries: 1, maxCandidates: 4 },
  );
  const cleanJson = cleanJsonString(text || '');
  return JSON.parse(cleanJson || '{}') as unknown;
}
