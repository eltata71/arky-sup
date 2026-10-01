/**
 * Change a document by a patch instead of a rewrite (plan de calidad de
 * artefactos, 7.4b): ask the edit vertical for operations, and let this
 * context's engine say what applying them would do.
 *
 * The preview is the engine's own run, never the model's account of it — a
 * proposal that describes one change and encodes another is what a preview
 * exists to catch. Nothing is persisted here: the caller decides, and the
 * content-preservation policy still judges the result.
 */
import type { Settings } from '../../../types';
import type { Artifact, ArtifactContextPorts, DocumentPatchRejection } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import { assembleArtifactContext, captureArtifactContext, documentEditService, renderArtifactContextBundle } from '../../ai';
import { applyDocumentPatch, outlineOfDocument } from '../domain/documentPatchEngine';

export type DocumentModificationOutcome =
  | {
    readonly kind: 'proposal';
    /** The document with the patch applied. */
    readonly content: string;
    /** One sentence per applied operation, from the engine. */
    readonly applied: readonly string[];
    readonly rejected: readonly DocumentPatchRejection[];
    readonly rationale?: string;
  }
  | { readonly kind: 'refused'; readonly reason: string; readonly rejected: readonly DocumentPatchRejection[] }
  | { readonly kind: 'cancelled' };

/** A document a patch can address: prose with at least one heading to name. */
export const isPatchableDocument = (artifact: Pick<Artifact, 'representation' | 'content'>): boolean =>
  (artifact.representation === 'document' || artifact.representation === 'hybrid')
  && outlineOfDocument(artifact.content ?? '').length > 0;

export const proposeDocumentModification = async (
  params: { readonly artifact: Artifact; readonly instruction: string; readonly project?: Project },
  settings: Settings,
  options: { readonly signal?: AbortSignal; readonly onContextCaptured?: ArtifactContextPorts['onContextCaptured'] } = {},
): Promise<DocumentModificationOutcome> => {
  const { artifact, instruction, project } = params;
  const content = artifact.content ?? '';
  const bundle = project ? assembleArtifactContext({ project, settings, artifact, query: instruction }, 'edit') : undefined;
  if (project && bundle) captureArtifactContext({ project, settings, artifact }, bundle, options.onContextCaptured);
  const context = bundle ? renderArtifactContextBundle(bundle) : undefined;
  const proposal = await documentEditService.proposeEdit(
    { content, outline: outlineOfDocument(content), instruction, context },
    settings,
    { signal: options.signal },
  );
  if (!proposal.ok || !proposal.patch) {
    if (proposal.reason === '') return { kind: 'cancelled' };
    return { kind: 'refused', reason: proposal.reason ?? 'El asistente no encontró un cambio que proponer.', rejected: [] };
  }
  const result = applyDocumentPatch(content, proposal.patch);
  if (!result.changed) {
    return {
      kind: 'refused',
      reason: result.rejected.length
        ? `Ninguna operación propuesta se pudo aplicar: ${result.rejected.map((rejection) => rejection.message).join(' ')}`
        : 'La propuesta no cambia nada del documento.',
      rejected: result.rejected,
    };
  }
  return { kind: 'proposal', content: result.content, applied: result.applied, rejected: result.rejected, rationale: proposal.patch.rationale };
};
