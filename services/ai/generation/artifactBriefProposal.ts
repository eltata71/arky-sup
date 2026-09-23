/**
 * The model's proposal for a structured artifact brief (F5-01, corte 12).
 *
 * The deterministic extractor in `services/artifacts` produces a trusted
 * baseline contract; this asks a model to sharpen it, and never trusts the
 * answer beyond its shape: every field is kept only if it arrived with the
 * right type, and any failure degrades to an empty proposal so the caller
 * keeps the baseline. Validation and the merge rules stay in
 * `services/artifacts/artifactGenerationContract`, which owns them.
 *
 * The contract type is read from `types.ts`, where it lives since F3-07, so
 * this layer does not import the artifacts context that imports it back.
 */
import type { ArtifactGenerationContract, Settings } from '../../../types';
import { cleanJsonString } from '../../../utils';
import type { Project } from '../../architectureProjects';
import { resolveModelForSettings } from '../catalog';
import { buildBasePrompt } from '../prompts/projectPrompts';
import { aiGateway } from './aiGateway';

/** A partial, untrusted contract candidate. */
export type ArtifactBriefProposal = Partial<ArtifactGenerationContract>;

export interface ArtifactBriefProposalResult {
  proposal: ArtifactBriefProposal;
  rawResponse: string;
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

/** Keep only the fields that arrived with the declared primitive type. */
export const toArtifactBriefProposal = (parsed: Record<string, unknown>): ArtifactBriefProposal => {
  const proposal: ArtifactBriefProposal = {};
  if (typeof parsed.normalizedIntent === 'string') proposal.normalizedIntent = parsed.normalizedIntent;
  if (typeof parsed.audience === 'string') proposal.audience = parsed.audience as ArtifactGenerationContract['audience'];
  if (typeof parsed.artifactFamily === 'string') proposal.artifactFamily = parsed.artifactFamily as ArtifactGenerationContract['artifactFamily'];
  if (typeof parsed.purpose === 'string') proposal.purpose = parsed.purpose as ArtifactGenerationContract['purpose'];
  if (typeof parsed.detailLevel === 'string') proposal.detailLevel = parsed.detailLevel as ArtifactGenerationContract['detailLevel'];
  const acceptanceCriteria = strings(parsed.acceptanceCriteria);
  if (acceptanceCriteria) proposal.acceptanceCriteria = acceptanceCriteria;
  const exportTargets = strings(parsed.exportTargets);
  if (exportTargets) proposal.exportTargets = exportTargets;
  const requiredContextItems = strings(parsed.requiredContextItems);
  if (requiredContextItems) proposal.requiredContextItems = requiredContextItems;
  const excludedContextItems = strings(parsed.excludedContextItems);
  if (excludedContextItems) proposal.excludedContextItems = excludedContextItems;
  if (typeof parsed.qualityTarget === 'number' && Number.isFinite(parsed.qualityTarget)) {
    proposal.qualityTarget = parsed.qualityTarget;
  }
  return proposal;
};

export async function proposeArtifactBriefContract(
  project: Project,
  request: string,
  deterministic: ArtifactGenerationContract,
  settings: Settings,
  opts: { timeoutMs?: number } = {},
): Promise<ArtifactBriefProposalResult> {
  const modelName = resolveModelForSettings('quick', settings).id;
  const prompt = `${buildBasePrompt(project, settings, { mode: 'diagram', maxContextItems: 4, maxDescriptionChars: 600 })}

You are refining a STRUCTURED ARTIFACT GENERATION BRIEF for a software architecture tool.
A deterministic extractor already produced a trusted baseline contract. Return ONLY a
partial proposal for fields you can make more precise; otherwise omit the field.

ORIGINAL USER REQUEST:
"""
${request.trim().slice(0, 1600)}
"""

DETERMINISTIC BASELINE CONTRACT (JSON):
${JSON.stringify({
    normalizedIntent: deterministic.normalizedIntent,
    audience: deterministic.audience,
    artifactFamily: deterministic.artifactFamily,
    purpose: deterministic.purpose,
    detailLevel: deterministic.detailLevel,
    acceptanceCriteria: deterministic.acceptanceCriteria,
    exportTargets: deterministic.exportTargets,
    qualityTarget: deterministic.qualityTarget,
  })}

RULES:
- Do NOT change the meaning of the original request. normalizedIntent must still cover it.
- Do NOT invent source artifacts. Do NOT reference excluded sources.
- Do NOT lower qualityTarget below ${deterministic.qualityTarget}.
- audience ∈ executive|technical|operations|business|mixed
- artifactFamily ∈ auto|document|diagram|hybrid|table|matrix|presentation
- purpose ∈ decision|explanation|design|implementation|analysis|governance|comparison|validation|communication
- detailLevel ∈ executive|conceptual|logical|physical|technical|deep-technical
- acceptanceCriteria: keep every baseline criterion, you may add sharper ones.

Return ONLY valid JSON compatible with this partial shape (no prose, omit unknown fields):
{
  "normalizedIntent": "string",
  "audience": "one enum value",
  "artifactFamily": "one enum value",
  "purpose": "one enum value",
  "detailLevel": "one enum value",
  "acceptanceCriteria": ["string"],
  "exportTargets": ["string"],
  "requiredContextItems": ["string"],
  "excludedContextItems": ["string"],
  "qualityTarget": ${deterministic.qualityTarget}
}`;

  let raw = '';
  try {
    const response = await aiGateway.generateContent(
      settings,
      modelName,
      prompt,
      { temperature: 0.15, topP: 0.85, maxOutputTokens: 900 },
      { timeoutMs: opts.timeoutMs ?? 30000, maxRetries: 1 },
    );
    raw = response.text ?? '';
  } catch (error) {
    console.warn('[artifactBriefProposal] AI proposal failed, degrading to deterministic.', error);
    return { proposal: {}, rawResponse: raw };
  }

  const cleanJson = cleanJsonString(raw || '');
  if (!cleanJson) return { proposal: {}, rawResponse: raw };
  try {
    const parsed: unknown = JSON.parse(cleanJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { proposal: {}, rawResponse: raw };
    }
    return { proposal: toArtifactBriefProposal(parsed as Record<string, unknown>), rawResponse: raw };
  } catch (error) {
    console.warn('[artifactBriefProposal] malformed JSON, degrading to deterministic.', error);
    return { proposal: {}, rawResponse: raw };
  }
}
