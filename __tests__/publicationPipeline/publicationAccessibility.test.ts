import { describe, expect, it } from 'vitest';
import { evaluatePublicationAccessibility } from '../../services/publicationPipeline';
import { worldClassDocument, emptyDocument, makeArtifact } from './fixtures';

describe('publication accessibility', () => {
  it('passes a well-structured document', () => {
    const report = evaluatePublicationAccessibility(
      [worldClassDocument()], 'standard', 'artifact', 'art-wc-doc',
    );
    expect(report.verdict).toBe('passed');
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.blocked).toBe(false);
  });

  it('blocks an empty / unreadable artifact', () => {
    const report = evaluatePublicationAccessibility(
      [emptyDocument()], 'basic', 'package', 'pkg-1',
    );
    expect(report.blocked).toBe(true);
    expect(report.issues.some((i) => i.code === 'readable-in-export')).toBe(true);
  });

  it('detects a diagram without an equivalent textual description', () => {
    const diagram = makeArtifact({
      id: 'art-diag',
      type: 'mermaid-graph',
      representation: 'diagram',
      content: 'graph TD; A-->B',
      objective: '',
    });
    const report = evaluatePublicationAccessibility([diagram], 'basic', 'artifact', 'art-diag');
    expect(report.issues.some((i) => i.code === 'diagram-alt-text')).toBe(true);
  });

  it('detects a table with empty header cells', () => {
    const doc = makeArtifact({
      id: 'art-table',
      content: '# Doc\n\n## Objetivo\nTexto.\n\n| | Severidad |\n|---|---|\n| Riesgo | Alta |',
    });
    const report = evaluatePublicationAccessibility([doc], 'standard', 'artifact', 'art-table');
    expect(report.issues.some((i) => i.code === 'table-headers')).toBe(true);
  });

  it('blocks a package with no artifacts', () => {
    const report = evaluatePublicationAccessibility([], 'basic', 'package', 'pkg-empty');
    expect(report.blocked).toBe(true);
  });
});
