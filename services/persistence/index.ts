/**
 * How this product writes, and what it says when a write does not land.
 *
 * `PersistenceResult` was already the shared envelope; what was missing was a
 * module around it. The classification lived in `services/persistence.ts` and
 * the *degradation* — keep the value locally, report it as pending — lived in
 * two private methods of `firestoreService`, out of reach of every repository
 * outside that 1.379-line file. So `trainingService` and the review repository
 * each invented their own answer, and one of them was a `console.warn`.
 *
 * This is the gateway a per-context repository sits on:
 *
 *   - `executeRemoteWrite` runs the write, classifies the outcome and reports
 *     it to observability. Everything that writes goes through it.
 *   - `writeLocalDraft` is the one correct way to degrade, and it returns
 *     `success: false` because a local draft is not a saved document.
 *   - `PersistenceResult` is what a caller renders; `isWriteConfirmed` is the
 *     only question worth asking about one.
 */
export * from './persistenceResult';
export * from './supabaseErrors';
export * from './localDraftStore';
export * from './collectionPaths';
export * from './mirroredList';
