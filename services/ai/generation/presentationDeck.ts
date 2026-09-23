/**
 * Presentation decks as JSON (F5-01, corte 12).
 *
 * Presentation artifacts get their own generation path: a `PresentationDeck`
 * instead of the long markdown document the document path would produce.
 * The prompt, the response schema and the parser are the `presentation`
 * module's; the structural gate is `quality`'s. What lives here is the call —
 * through the transport's text path, proxy first — and the one corrective
 * retry when the first deck parses but is unusable.
 *
 * Same prompts, temperatures, budgets and retry rule as in the engine, moved
 * as they were.
 */
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Project } from '../../architectureProjects';
import {
  buildPresentationPromptInstructions,
  parsePresentationDeck,
  PRESENTATION_RESPONSE_SCHEMA,
  PRESENTATION_SCHEMA_VERSION,
} from '../../presentation';
import { assessPresentationDeck } from '../../quality';
import { resolveModelForSettings } from '../catalog';
import { buildArtifactsContext, buildBasePrompt } from '../prompts/projectPrompts';
import { legacyTransport } from './legacyTransport';

const DECK_TIMEOUT_MS = 90000;

export async function generatePresentationDeck(
  project: Project,
  template: ArtifactTemplate,
  settings: Settings,
  architectureGraphPromptBlock?: string,
): Promise<string> {
  const modelName = resolveModelForSettings('default', settings).id;
  const userTemp = settings.aiConfig?.temperature ?? 0.7;
  const basePrompt = buildBasePrompt(project, settings);
  // Presentations summarise the architecture: feeding real excerpts of the
  // sibling artifacts keeps slide content consistent with the documents and
  // diagrams it presents instead of re-inventing them.
  const artifactsContext = buildArtifactsContext(project, { includeExcerpts: true });
  const contextBlock = architectureGraphPromptBlock && architectureGraphPromptBlock.trim().length > 0
    ? architectureGraphPromptBlock
    : artifactsContext;
  const instructions = buildPresentationPromptInstructions(template, {
    contextBlock,
    language: settings.language,
  });
  const fullPrompt = `${basePrompt}\n\n${instructions}\n\nTASK: Create the deck for "${template.name}" matching the contract above. Return JSON only.`;
  const modelConfig: Record<string, unknown> = {
    temperature: Math.min(userTemp, 0.7),
    topP: 0.9,
    responseMimeType: 'application/json',
    responseSchema: PRESENTATION_RESPONSE_SCHEMA,
  };
  const raw = await legacyTransport.generateTextWithFallback(settings, modelName, fullPrompt, modelConfig, {
    timeoutMs: DECK_TIMEOUT_MS,
    maxRetries: 2,
  });
  let parsed = parsePresentationDeck(raw, { artifactType: template.type, artifactName: template.name });
  // Deck quality gate: structural assessment + ONE corrective retry. Catches
  // decks that parse but are unusable (empty content slides, one-slide decks)
  // before they reach the viewer and the exporters.
  const firstDeckAssessment = assessPresentationDeck(JSON.stringify(parsed.deck));
  if (!firstDeckAssessment.ok) {
    console.warn(
      `[presentationDeck] Deck failed quality gate (${firstDeckAssessment.issues.map((i) => i.code).join(', ')}); corrective retry.`,
    );
    const correctivePrompt = `${fullPrompt}

PREVIOUS ATTEMPT WAS REJECTED (${firstDeckAssessment.issues.map((i) => i.message).join(' · ')}).
Regenerate the COMPLETE deck ensuring:
 - At least 5 slides, each with a title.
 - Every non-title slide has at least one substantive contentBlock (text, bullets, table, kpi or diagram).
 - JSON only, matching the contract exactly.`;
    try {
      const retryRaw = await legacyTransport.generateTextWithFallback(settings, modelName, correctivePrompt, modelConfig, {
        timeoutMs: DECK_TIMEOUT_MS,
        maxRetries: 1,
      });
      const retryParsed = parsePresentationDeck(retryRaw, { artifactType: template.type, artifactName: template.name });
      const retryAssessment = assessPresentationDeck(JSON.stringify(retryParsed.deck));
      if (retryAssessment.ok || retryAssessment.score > firstDeckAssessment.score) {
        parsed = retryParsed;
      }
    } catch (retryErr) {
      console.warn('[presentationDeck] Corrective retry failed; keeping first attempt.', retryErr);
    }
  }
  // Always re-stringify the parsed deck so the persisted content matches the
  // canonical schema even if the model drifted slightly.
  const deck = parsed.deck;
  deck.metadata = {
    ...(deck.metadata ?? {}),
    templateId: template.type,
    generatedAt: new Date().toISOString(),
    projectId: project.id,
    preferredExports: template.preferredExports ?? ['pptx', 'pdf'],
  };
  deck.version = deck.version || PRESENTATION_SCHEMA_VERSION;
  return JSON.stringify(deck, null, 2);
}
