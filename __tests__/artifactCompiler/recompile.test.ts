import { describe, expect, it } from 'vitest';
import {
  attachCompilerSummary,
  computeArtifactCompilationSignature,
  getCompilationFreshness,
  isCompilationFresh,
  recompileArtifactBeforePersist,
} from '../../services/artifactCompiler';
import type { Artifact } from '../../types';
import {
  makeArtifact,
  brdComplete,
  richMarkdown,
  placeholderDocument,
  validDiagramIR,
} from './fixtures';

/* ------------------------------------------------------------------------- */
/* computeArtifactCompilationSignature                                         */
/* ------------------------------------------------------------------------- */

describe('computeArtifactCompilationSignature — fingerprints the compilation surface', () => {
  it('is stable for an unchanged artifact', () => {
    const artifact = makeArtifact({ type: 'markdown', content: richMarkdown });
    expect(computeArtifactCompilationSignature(artifact)).toBe(
      computeArtifactCompilationSignature(artifact),
    );
  });

  it('changes when a compilation-relevant field changes', () => {
    const base = makeArtifact({ type: 'markdown', content: richMarkdown });
    const baseSignature = computeArtifactCompilationSignature(base);

    expect(computeArtifactCompilationSignature({ ...base, content: `${richMarkdown}\n## Extra` }))
      .not.toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, type: 'sdd-brd' }))
      .not.toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, representation: 'hybrid' }))
      .not.toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, objective: 'Otro objetivo' }))
      .not.toBe(baseSignature);
    expect(computeArtifactCompilationSignature({
      ...base,
      keyConcepts: [{ term: 'API', definition: 'Interfaz' }],
    })).not.toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, ir: validDiagramIR() }))
      .not.toBe(baseSignature);
  });

  it('ignores fields that do not affect compilation (favorite, name, version)', () => {
    const base = makeArtifact({ type: 'markdown', content: richMarkdown });
    const baseSignature = computeArtifactCompilationSignature(base);

    expect(computeArtifactCompilationSignature({ ...base, isFavorite: true })).toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, name: 'Renombrado' })).toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, version: 9 })).toBe(baseSignature);
    expect(computeArtifactCompilationSignature({ ...base, reviewStatus: 'approved' }))
      .toBe(baseSignature);
  });
});

/* ------------------------------------------------------------------------- */
/* getCompilationFreshness                                                     */
/* ------------------------------------------------------------------------- */

describe('getCompilationFreshness — current | stale | missing', () => {
  it('reports `missing` for a legacy artifact without compilation', () => {
    const artifact = makeArtifact({ type: 'markdown', content: richMarkdown });
    expect(getCompilationFreshness(artifact)).toBe('missing');
    expect(isCompilationFresh(artifact)).toBe(false);
  });

  it('reports `current` immediately after the artifact is compiled', () => {
    const artifact = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    expect(getCompilationFreshness(artifact)).toBe('current');
    expect(isCompilationFresh(artifact)).toBe(true);
  });

  it('reports `stale` once a relevant field changes after compilation', () => {
    const compiled = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    const edited: Artifact = { ...compiled, content: `${richMarkdown}\n\n## Sección añadida` };
    expect(getCompilationFreshness(edited)).toBe('stale');
  });

  it('reports `stale` for a legacy compilation snapshot lacking a signature', () => {
    const compiled = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    const legacy: Artifact = {
      ...compiled,
      compilation: { ...compiled.compilation!, sourceSignature: undefined },
    };
    expect(getCompilationFreshness(legacy)).toBe('stale');
  });
});

/* ------------------------------------------------------------------------- */
/* recompileArtifactBeforePersist — safe mode                                  */
/* ------------------------------------------------------------------------- */

describe('recompileArtifactBeforePersist — safe mode never mutates content', () => {
  it('attaches a fresh, current compilation without changing content', () => {
    const artifact = makeArtifact({ type: 'markdown', content: placeholderDocument });
    const outcome = recompileArtifactBeforePersist(artifact, { source: 'manual' });

    expect(outcome.recompiled).toBe(true);
    expect(outcome.contentChanged).toBe(false);
    // Safe mode: content is byte-identical even though the document has placeholders.
    expect(outcome.artifact.content).toBe(placeholderDocument);
    expect(getCompilationFreshness(outcome.artifact)).toBe('current');
    expect(outcome.artifact.compilation?.compilationFreshness).toBe('current');
  });

  it('skips work on the fast path when the compilation is already current', () => {
    const compiled = attachCompilerSummary(makeArtifact({ type: 'sdd-brd', content: brdComplete }));
    const outcome = recompileArtifactBeforePersist(compiled, { source: 'manual' });

    expect(outcome.recompiled).toBe(false);
    expect(outcome.previousFreshness).toBe('current');
    // Reference-equal — no needless object churn for an unchanged artifact.
    expect(outcome.artifact).toBe(compiled);
  });

  it('recompiles on the fast path when `force` is set', () => {
    const compiled = attachCompilerSummary(makeArtifact({ type: 'sdd-brd', content: brdComplete }));
    const outcome = recompileArtifactBeforePersist(compiled, { source: 'manual', force: true });
    expect(outcome.recompiled).toBe(true);
  });

  it('degrades safely and never throws when the compiler fails', () => {
    const corrupt = makeArtifact({ type: 'markdown', content: undefined as unknown as string });
    expect(() => recompileArtifactBeforePersist(corrupt)).not.toThrow();
    const outcome = recompileArtifactBeforePersist(corrupt);
    // The compiler returns a controlled `failed` result — still observable.
    expect(outcome.status).toBe('failed');
    expect(outcome.ok).toBe(false);
    expect(outcome.contentChanged).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* recompileArtifactBeforePersist — assisted improvement mode                  */
/* ------------------------------------------------------------------------- */

describe('recompileArtifactBeforePersist — assisted-improvement mode', () => {
  it('applies non-destructive repairs only under the explicit assisted mode', () => {
    const artifact = makeArtifact({ type: 'markdown', content: placeholderDocument });
    const outcome = recompileArtifactBeforePersist(artifact, {
      mode: 'assisted-improvement',
      source: 'manual',
    });

    expect(outcome.contentChanged).toBe(true);
    expect(outcome.artifact.content).not.toBe(placeholderDocument);
    expect(getCompilationFreshness(outcome.artifact)).toBe('current');
  });

  it('leaves content untouched in assisted mode when no repair is needed', () => {
    const artifact = makeArtifact({ type: 'sdd-brd', content: brdComplete });
    const outcome = recompileArtifactBeforePersist(artifact, { mode: 'assisted-improvement' });
    expect(outcome.contentChanged).toBe(false);
    expect(outcome.artifact.content).toBe(brdComplete);
  });
});

/* ------------------------------------------------------------------------- */
/* Mutation-path simulations — every flow keeps the compilation synchronised   */
/* ------------------------------------------------------------------------- */

describe('mutation flows keep `compilation` synchronised with content', () => {
  it('updateArtifact-style merge refreshes a stale compilation', () => {
    // 1 — artifact persisted with a current compilation.
    const persisted = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    expect(getCompilationFreshness(persisted)).toBe('current');

    // 2 — a manual edit changes the content (mirrors updateArtifact merge).
    const merged: Artifact = { ...persisted, content: `${richMarkdown}\n\n## Decisiones` };
    expect(getCompilationFreshness(merged)).toBe('stale');

    // 3 — recompilation before persistence restores freshness.
    const outcome = recompileArtifactBeforePersist(merged, { source: 'manual' });
    expect(outcome.recompiled).toBe(true);
    expect(getCompilationFreshness(outcome.artifact)).toBe('current');
  });

  it('updateArtifact-style merge of an irrelevant field uses the fast path', () => {
    const persisted = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    const merged: Artifact = { ...persisted, isFavorite: true };
    const outcome = recompileArtifactBeforePersist(merged, { source: 'manual' });
    expect(outcome.recompiled).toBe(false);
    expect(getCompilationFreshness(outcome.artifact)).toBe('current');
  });

  it('restoreArtifactVersion-style clone never inherits a stale compilation', () => {
    const original = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    // The manual edit-and-save path clones the artifact with new content.
    const restored: Artifact = {
      ...original,
      id: 'art-restored',
      version: original.version + 1,
      content: `${richMarkdown}\n\n## Edición manual`,
    };
    const outcome = recompileArtifactBeforePersist(restored, { source: 'manual' });
    expect(getCompilationFreshness(outcome.artifact)).toBe('current');
    expect(outcome.artifact.compilation?.sourceSignature).toBe(
      computeArtifactCompilationSignature(outcome.artifact),
    );
  });

  it('applyConsistencySuggestion-style clone recompiles against the new content', () => {
    const latest = attachCompilerSummary(makeArtifact({ type: 'sdd-brd', content: brdComplete }));
    const suggested: Artifact = {
      ...latest,
      id: 'art-suggested',
      version: latest.version + 1,
      content: `${brdComplete}\n\n## Ajuste de consistencia`,
    };
    const outcome = recompileArtifactBeforePersist(suggested, { source: 'manual' });
    expect(getCompilationFreshness(outcome.artifact)).toBe('current');
  });
});

/* ------------------------------------------------------------------------- */
/* attachCompilerSummary — backwards-compatible, signature-stamped             */
/* ------------------------------------------------------------------------- */

describe('attachCompilerSummary — stamps a current, signed compilation', () => {
  it('produces a compilation that is immediately fresh', () => {
    const enriched = attachCompilerSummary(makeArtifact({ type: 'markdown', content: richMarkdown }));
    expect(enriched.compilation?.sourceSignature).toBeTruthy();
    expect(enriched.compilation?.compilationFreshness).toBe('current');
    expect(isCompilationFresh(enriched)).toBe(true);
  });

  it('never mutates the input artifact', () => {
    const artifact = makeArtifact({ type: 'markdown', content: richMarkdown });
    attachCompilerSummary(artifact);
    expect(artifact.compilation).toBeUndefined();
  });
});
