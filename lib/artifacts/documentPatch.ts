/**
 * A change to a document, expressed over what already exists (plan de calidad
 * de artefactos, 7.4b) — the document counterpart of `lib/diagram/semanticPatch`.
 *
 * The copilot changed a document by rewriting it whole: to add one risk to a
 * table the model returned the entire document, which cost the whole document
 * in tokens, could not work at all past what fits in a prompt, and put every
 * other paragraph at the mercy of the rewrite. An operation names the section
 * it touches by its heading and says only what changes.
 *
 * Five operations and no more. There is no "rewrite paragraph N": positions
 * shift under every edit and a number would silently point at the wrong text;
 * a heading is what a person would point at.
 */

export type DocumentPatchOperation =
  /** Replace a section's body (everything under its heading, subsections included). */
  | { readonly op: 'replace-section'; readonly heading: string; readonly body: string }
  /** Insert a new section after an existing one, or at the end when `after` is null. */
  | { readonly op: 'insert-section'; readonly after: string | null; readonly heading: string; readonly body: string }
  /** Remove a section and its subsections. */
  | { readonly op: 'remove-section'; readonly heading: string }
  /** Append a row to the first table of a section. */
  | { readonly op: 'append-table-row'; readonly heading: string; readonly cells: readonly string[] }
  /** Replace the row of a section's first table whose first cell matches. */
  | { readonly op: 'update-table-row'; readonly heading: string; readonly match: string; readonly cells: readonly string[] };

export type DocumentPatchOperationKind = DocumentPatchOperation['op'];

export const DOCUMENT_PATCH_OPERATIONS: readonly DocumentPatchOperationKind[] = [
  'replace-section',
  'insert-section',
  'remove-section',
  'append-table-row',
  'update-table-row',
];

export interface DocumentPatch {
  /** One line on why, from whoever proposed it. */
  readonly rationale?: string;
  readonly operations: readonly DocumentPatchOperation[];
}

export type DocumentPatchRejectionCode =
  | 'invalid-operation'
  | 'unknown-section'
  | 'ambiguous-section'
  | 'duplicate-section'
  | 'empty-body'
  | 'no-table'
  | 'row-not-found'
  | 'cell-count';

export interface DocumentPatchRejection {
  readonly index: number;
  readonly op: string;
  readonly code: DocumentPatchRejectionCode;
  readonly message: string;
}

export interface DocumentPatchResult {
  /** The document after the operations that could be applied. */
  readonly content: string;
  /** False when nothing changed — and then `content` is the original. */
  readonly changed: boolean;
  /** One Spanish sentence per applied operation. */
  readonly applied: readonly string[];
  readonly rejected: readonly DocumentPatchRejection[];
}
