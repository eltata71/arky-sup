/**
 * What a `modifyArtifact` call from the model means for the open artifact
 * (F5-02).
 *
 * `AssistantPanel` decided this between two `setState` calls: whether the
 * content is real, whether it changed anything, which of the two targets it
 * names — and what to tell the person in each case. Those are the guardrails
 * that keep the assistant honest («never declare success when the model
 * returned empty content or repeated what is already on disk»), and they could
 * only be tested by rendering the panel. Here they are a pure function; the
 * screen still does the write, because the write is the context's.
 */
import type { Artifact } from '../../lib/artifacts';

/** The call as the turn returns it: a name and untyped arguments. */
export interface ModelFunctionCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export type ArtifactModification =
  /** No `modifyArtifact` call, or a target this product does not know. */
  | { readonly kind: 'none' }
  /** Nothing to apply; `note` says why, and is appended to the answer. */
  | { readonly kind: 'not-applied'; readonly note: string }
  | { readonly kind: 'update-current'; readonly content: string }
  | { readonly kind: 'new-version'; readonly content: string };

/** What the answer says once the write has been attempted. */
export const MODIFICATION_NOTES = Object.freeze({
  updated: '*He modificado el artefacto actual según tus instrucciones.*',
  updateUnconfirmed: '*No pude confirmar la actualización del artefacto. Vuelve a intentarlo en unos segundos.*',
  versionCreated: (version: number): string =>
    `*He creado una nueva versión del artefacto (v${version}) con las modificaciones solicitadas.*`,
  versionFailed: '*No pude crear la nueva versión del artefacto. Vuelve a intentarlo en unos segundos.*',
});

export const interpretArtifactModification = (
  functionCall: ModelFunctionCall | undefined,
  activeArtifact: Pick<Artifact, 'content'> | null,
): ArtifactModification => {
  if (!functionCall || functionCall.name !== 'modifyArtifact') return { kind: 'none' };
  if (!activeArtifact) {
    // The model proposed a change with nothing open to change (the user closed
    // the artifact mid-stream): a recommendation, never a completed action.
    return {
      kind: 'not-applied',
      note: '*Recomendación lista: abre el artefacto que quieras modificar para que pueda aplicar el cambio.*',
    };
  }
  const content = String(functionCall.args.newContent ?? '').trim();
  if (!content) {
    return {
      kind: 'not-applied',
      note: '*No apliqué cambios: la IA no devolvió contenido válido para modificar el artefacto.*',
    };
  }
  if (content === activeArtifact.content.trim()) {
    return {
      kind: 'not-applied',
      note: '*Sin cambios aplicados: la IA devolvió el mismo contenido que ya tenía el artefacto.*',
    };
  }
  const target = String(functionCall.args.target ?? '');
  if (target === 'current') return { kind: 'update-current', content };
  if (target === 'new_version') return { kind: 'new-version', content };
  return { kind: 'none' };
};
