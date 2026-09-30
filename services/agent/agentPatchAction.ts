/**
 * The agent's «cambio puntual» (plan de calidad de artefactos, 7.4b).
 *
 * A document is changed by a patch — operations over its headings, applied
 * by the artifacts context's engine — so a small change costs a small
 * answer, works on a document of any length and cannot damage a paragraph
 * the model never touched. What has no headings to name (a diagram, a bare
 * text) keeps the whole rewrite through `modifyArtifact`, and that path still
 * refuses what the model cannot see whole (7.1b).
 */
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { ChatMessage } from '../chat';
import { isPatchableDocument, proposeDocumentModification } from '../artifacts';
import { artifactFitsWholeRewrite, describeRewriteRefusal } from './activeArtifactExposure';
import { requestArtifactPatch } from './agentConversation';
import type { AgentPersonaBriefing } from './agentPersonaBriefing';

export type AgentPatchOutcome =
  | { readonly ok: true; readonly content: string; readonly changes: readonly string[] }
  | { readonly ok: false; readonly message: string };

export async function runArtifactPatch(input: {
  artifact: Artifact;
  project: Project;
  settings: Settings;
  history: ChatMessage[];
  instruction: string;
  resolvePersona?: (message: string) => AgentPersonaBriefing;
}): Promise<AgentPatchOutcome> {
  const { artifact, project, settings, history, instruction } = input;
  if (isPatchableDocument(artifact)) {
    const outcome = await proposeDocumentModification({ artifact, instruction, project }, settings);
    if (outcome.kind === 'cancelled') return { ok: false, message: 'Cambio cancelado.' };
    if (outcome.kind === 'refused') return { ok: false, message: outcome.reason };
    const skipped = outcome.rejected.map((rejection) => `No aplicado: ${rejection.message}`);
    return { ok: true, content: outcome.content, changes: [...outcome.applied, ...skipped] };
  }
  if (!artifactFitsWholeRewrite(artifact)) return { ok: false, message: describeRewriteRefusal(artifact.content.trim().length) };
  const question = `Aplica el siguiente cambio puntual al artefacto y devuelve el contenido completo modificado mediante la herramienta modifyArtifact. Cambio solicitado: ${instruction}`;
  const content = await requestArtifactPatch({
    project, activeArtifact: artifact, history, question, settings, persona: input.resolvePersona?.(question),
  });
  return { ok: true, content, changes: [`Cambio puntual: ${instruction.length > 140 ? `${instruction.slice(0, 139)}…` : instruction}`] };
}
