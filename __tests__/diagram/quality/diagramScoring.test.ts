/**
 * Specs for the ten scoring dimensions and the caps.
 *
 * These were reachable only through `analyzeDiagramQuality`, which runs the
 * archetype detector, the visual linter, BPMN, healthcare and C4 first. A test
 * that wanted to know what one dimension rewards had to set up all of them and
 * then infer the answer from a blended number.
 *
 * The caps are the part that matters most and were the hardest to reach: a
 * diagram with one critical structural defect can otherwise average into the
 * eighties, because nine healthy dimensions outvote the broken one — and a
 * rubric that rates a broken diagram highly is worse than no rubric.
 */

import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../../lib/diagram';
import {
  DIMENSION_WEIGHTS,
  applyQualityCaps,
  buildBreakdown,
  issuePenalty,
} from '../../../services/diagram/quality/diagramScoring';
import type { DiagramLintIssue } from '../../../services/diagram/quality/diagramQualityTypes';

const ir = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
  nodes: [],
  edges: [],
  groups: [],
  ...overrides,
} as DiagramIR);

const richDiagram = (): DiagramIR => ir({
  nodes: [
    { id: 'a', label: 'Portal del asegurado', kind: 'Frontend', description: 'SPA React', technology: 'React', semanticType: 'internal-system' },
    { id: 'b', label: 'API de pólizas', kind: 'Service', description: 'REST', technology: 'Node', semanticType: 'internal-system' },
    { id: 'c', label: 'Núcleo de pólizas', kind: 'Database', description: 'PostgreSQL', technology: 'PostgreSQL', semanticType: 'database' },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b', label: 'consulta pólizas vía HTTPS', relation: 'default' },
    { id: 'e2', source: 'b', target: 'c', label: 'lee mediante JDBC', relation: 'default' },
  ],
  metadata: { title: 'Plataforma de pólizas' },
} as Partial<DiagramIR>);

const issue = (severity: DiagramLintIssue['severity'], code = 'X'): DiagramLintIssue => ({
  id: `${code}-${severity}`, code, severity, message: 'm', recommendation: 'r',
});

describe('the breakdown', () => {
  it('scores all ten dimensions inside 0–100', () => {
    for (const diagram of [richDiagram(), ir()]) {
      const breakdown = buildBreakdown(diagram);
      expect(Object.keys(breakdown)).toHaveLength(10);
      for (const [name, value] of Object.entries(breakdown)) {
        expect(Number.isFinite(value), name).toBe(true);
        expect(value, name).toBeGreaterThanOrEqual(0);
        expect(value, name).toBeLessThanOrEqual(100);
      }
    }
  });

  it('rates a described, labelled diagram above an empty one', () => {
    const rich = buildBreakdown(richDiagram());
    const empty = buildBreakdown(ir());
    expect(rich.claridadSemantica).toBeGreaterThan(empty.claridadSemantica);
  });

  it('rewards actionable edge labels over bare nouns', () => {
    const withVerbs = buildBreakdown(richDiagram());
    const withoutVerbs = buildBreakdown(ir({
      ...richDiagram(),
      edges: richDiagram().edges.map((e) => ({ ...e, label: 'relación' })),
    } as Partial<DiagramIR>));
    expect(withVerbs.narrativa).toBeGreaterThanOrEqual(withoutVerbs.narrativa);
  });
});

describe('the weights', () => {
  it('cover every dimension the breakdown produces', () => {
    // A dimension with no weight is scored and then silently ignored.
    expect(Object.keys(DIMENSION_WEIGHTS).sort()).toEqual(Object.keys(buildBreakdown(ir())).sort());
  });

  it('sum to 100, so the blend is a weighted percentage', () => {
    // Percentages, not fractions. A set that does not total 100 silently
    // rescales every score, which is invisible in the output.
    const total = Object.values(DIMENSION_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });
});

describe('the caps', () => {
  // The caps trigger on named structural conditions, not on severity. That is
  // the point: a diagram can accumulate several "high" issues and still be a
  // usable diagram, while one broken edge reference makes it wrong regardless
  // of how well every dimension scored.

  it('scores an empty diagram zero, whatever the dimensions said', () => {
    expect(applyQualityCaps(ir(), [], 95)).toBe(0);
  });

  it('holds a skeleton fallback well below a finished diagram', () => {
    // A deliberate placeholder must not read as finished work.
    const skeleton = ir({ ...richDiagram(), metadata: { fallback: 'skeleton' } } as Partial<DiagramIR>);
    expect(applyQualityCaps(skeleton, [], 95)).toBe(40);
  });

  it('caps hardest on a broken edge reference — the diagram is simply wrong', () => {
    const capped = applyQualityCaps(richDiagram(), [issue('critical', 'EDGE_INVALID_REFERENCE')], 95);
    expect(capped).toBe(40);
  });

  it('caps a diagram whose edges carry no labels', () => {
    expect(applyQualityCaps(richDiagram(), [issue('medium', 'EDGE_MISSING_LABEL')], 95)).toBe(60);
  });

  it('caps a C4 diagram that has almost nothing in it', () => {
    const thin = ir({
      nodes: [{ id: 'a', label: 'Sistema', kind: 'System' }],
      edges: [],
      metadata: { title: 'Diagrama C4 de contexto' },
    } as Partial<DiagramIR>);
    expect(applyQualityCaps(thin, [], 95)).toBe(50);
  });

  it('caps hardest of all when the audience projection emptied the diagram', () => {
    const degraded = ir({
      ...richDiagram(),
      metadata: { degradationReason: 'audience-empty' },
    } as Partial<DiagramIR>);
    expect(applyQualityCaps(degraded, [], 95)).toBe(30);
  });

  it('leaves the score of a clean diagram alone', () => {
    expect(applyQualityCaps(richDiagram(), [], 88)).toBe(88);
  });

  it('applies the strictest cap when several conditions hold at once', () => {
    const capped = applyQualityCaps(
      richDiagram(),
      [issue('critical', 'EDGE_INVALID_REFERENCE'), issue('medium', 'EDGE_MISSING_LABEL')],
      95,
    );
    expect(capped).toBe(40);
  });
});

describe('the issue penalty', () => {
  it('grows with severity', () => {
    expect(issuePenalty([issue('critical')])).toBeGreaterThan(issuePenalty([issue('low')]));
  });

  it('is zero when there is nothing wrong', () => {
    expect(issuePenalty([])).toBe(0);
  });

  it('accumulates across issues', () => {
    expect(issuePenalty([issue('high', 'A'), issue('high', 'B')])).toBeGreaterThan(issuePenalty([issue('high', 'A')]));
  });
});
