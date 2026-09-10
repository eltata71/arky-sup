import { describe, expect, it } from 'vitest';
import {
  compileArtifact,
  buildCompilerSummary,
  attachCompilerSummary,
} from '../../services/artifactCompiler';
import {
  makeArtifact,
  brdComplete,
  richMarkdown,
  placeholderDocument,
  incompleteTableDocument,
  validDiagramIR,
} from './fixtures';

describe('compileArtifact — blocked / corrupt artifacts are never shipped as valid', () => {
  it('blocks an empty artifact and marks it non-exportable', () => {
    const result = compileArtifact(makeArtifact({ type: 'markdown', content: '' }));
    expect(result.status).toBe('blocked');
    expect(result.score.value).toBe(0);
    expect(result.score.tier).toBe('blocked');
    expect(result.canExport).toBe(false);
    expect(result.canRender).toBe(false);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.repairs).toHaveLength(0);
    // The candidate is never mutated when it cannot be repaired.
    expect(result.compiled).toBe(result.original);
  });

  it('blocks a diagram artifact with no renderable content', () => {
    const result = compileArtifact(makeArtifact({
      type: 'react-flow-graph',
      representation: 'diagram',
      content: '',
    }));
    expect(result.status).toBe('blocked');
    expect(result.issues.critical.length).toBeGreaterThan(0);
  });

  it('never throws and degrades safely when the compiler itself fails', () => {
    const corrupt = makeArtifact({ type: 'markdown', content: undefined as unknown as string });
    expect(() => compileArtifact(corrupt)).not.toThrow();
    const result = compileArtifact(corrupt);
    expect(result.status).toBe('failed');
    expect(result.canExport).toBe(false);
    expect(result.trace).toBeDefined();
    expect(result.trace.steps.length).toBeGreaterThan(0);
    // The original artifact is returned untouched — no blank screen.
    expect(result.compiled).toBe(result.original);
  });
});

describe('compileArtifact — safe non-destructive repair', () => {
  it('repairs a document with placeholders and records the repairs', () => {
    const result = compileArtifact(makeArtifact({ type: 'markdown', content: placeholderDocument }));
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(result.status).toBe('repaired');
    expect(result.compiled).not.toBe(result.original);
    expect(result.compiled.content).not.toMatch(/\bTODO\b/);
    expect(result.compiled.content).not.toMatch(/\bFIXME\b/);
    // Repair is reflected in the trace.
    expect(result.trace.repairs.length).toBeGreaterThan(0);
    expect(result.requiresHumanReview).toBe(true);
  });

  it('leaves content untouched when repairs are disabled', () => {
    const result = compileArtifact(
      makeArtifact({ type: 'markdown', content: placeholderDocument }),
      { applyRepairs: false },
    );
    expect(result.repairs).toHaveLength(0);
    expect(result.compiled).toBe(result.original);
  });

  it('surfaces incomplete tables as findings without corrupting content', () => {
    const result = compileArtifact(makeArtifact({ type: 'markdown', content: incompleteTableDocument }));
    const allIssues = [
      ...result.issues.critical,
      ...result.issues.high,
      ...result.issues.medium,
      ...result.issues.low,
    ];
    expect(allIssues.some((i) => i.code === 'DOC_TABLE_INCOMPLETE' || i.code === 'DOC_TABLE_NO_ROWS')).toBe(true);
  });
});

describe('compileArtifact — diagram artifacts keep delegating to the diagram pipeline', () => {
  it('compiles a diagram artifact through the diagram contract without repairing it', () => {
    const result = compileArtifact(makeArtifact({
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'C4Context\n  Person(user, "Usuario")',
      ir: validDiagramIR(),
    }));
    expect(result.contractId).toBe('contract.diagram.mermaid');
    expect(result.repairs).toHaveLength(0);
    expect(result.canRender).toBe(true);
    expect(result.status).not.toBe('failed');
    expect(result.status).not.toBe('blocked');
  });
});

describe('compileArtifact — exportability is aligned to the artifact, not cross-blocked', () => {
  it('marks a document exportable even though it has no diagram', () => {
    const result = compileArtifact(makeArtifact({ type: 'markdown', content: richMarkdown }));
    expect(result.exportReadiness.document).toBe(true);
    expect(result.exportReadiness.diagram).toBe(false);
    expect(result.exportReadiness.any).toBe(true);
  });

  it('marks a diagram exportable even though it carries no document', () => {
    const result = compileArtifact(makeArtifact({
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'C4Context',
      ir: validDiagramIR(),
    }));
    expect(result.exportReadiness.diagram).toBe(true);
  });
});

describe('compileArtifact — result shape and observability', () => {
  it('produces a complete trace with a finalize step', () => {
    const result = compileArtifact(makeArtifact({ type: 'sdd-brd', content: brdComplete }));
    expect(result.trace.steps.some((s) => s.stage === 'finalize')).toBe(true);
    expect(result.trace.steps.some((s) => s.stage === 'scoring')).toBe(true);
    expect(result.score.dimensions).toHaveLength(10);
    expect(['passed', 'warning', 'repaired']).toContain(result.status);
  });

  it('projects a compilation result onto the persistable summary block', () => {
    const result = compileArtifact(makeArtifact({ type: 'sdd-brd', content: brdComplete }));
    const summary = buildCompilerSummary(result);
    expect(summary.compilerContractId).toBe('contract.sdd.brd');
    expect(typeof summary.compilerScore).toBe('number');
    expect(summary.compilerTier).toBe(result.score.tier);
    expect(summary.exportReadiness).toEqual(result.exportReadiness);
  });

  it('attaches a compilation summary without mutating the input artifact', () => {
    const artifact = makeArtifact({ type: 'markdown', content: richMarkdown });
    const enriched = attachCompilerSummary(artifact);
    expect(enriched.compilation).toBeDefined();
    expect(enriched.compilation?.compilerContractId).toBe('contract.document.markdown');
    expect(artifact.compilation).toBeUndefined();
  });
});
