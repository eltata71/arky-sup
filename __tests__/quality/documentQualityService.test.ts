import { describe, expect, it } from 'vitest';
import { analyzeDocumentQuality } from '../../services/quality/documentQualityService';
import { fullDocumentContent, tableOnlyContent } from './fixtures';

describe('analyzeDocumentQuality', () => {
  it('flags an empty document as critical', () => {
    const snap = analyzeDocumentQuality('');
    expect(snap.wordCount).toBe(0);
    expect(snap.issues.some((i) => i.severity === 'critical')).toBe(true);
    expect(snap.scores['doc.exportability']).toBeLessThan(40);
  });

  it('rewards a document that has all canonical sections', () => {
    const snap = analyzeDocumentQuality(fullDocumentContent);
    expect(snap.hasStructure).toBe(true);
    expect(snap.scores['doc.objective']).toBeGreaterThanOrEqual(80);
    expect(snap.scores['doc.scope']).toBeGreaterThanOrEqual(80);
    expect(snap.scores['doc.risks']).toBeGreaterThanOrEqual(80);
    expect(snap.scores['doc.acceptance']).toBeGreaterThanOrEqual(80);
    expect(snap.scores['doc.headings']).toBeGreaterThanOrEqual(70);
    expect(snap.tables.length).toBeGreaterThanOrEqual(2);
  });

  it('emits missing-section findings for an incomplete document', () => {
    const snap = analyzeDocumentQuality('# Título\n\nContenido breve sin estructura.');
    const codes = snap.issues.map((i) => i.code);
    expect(codes).toContain('DOC_MISSING_SECTION_OBJECTIVE');
    expect(codes).toContain('DOC_MISSING_SECTION_SCOPE');
  });

  it('detects incomplete tables and surfaces them as findings', () => {
    const content = `# Tabla\n\n| A | B | C |\n|---|---|---|\n|  |  |  |\n`;
    const snap = analyzeDocumentQuality(content, { expectsTables: true });
    expect(snap.tables).toHaveLength(1);
    expect(snap.tableCompleteness).toBeLessThan(0.4);
    expect(snap.issues.some((i) => i.code === 'DOC_TABLE_INCOMPLETE')).toBe(true);
  });

  it('penalises TBD/TODO markers as terminology issues', () => {
    const snap = analyzeDocumentQuality('# Doc\n\nTBD: pendiente. TODO: revisar.');
    expect(snap.scores['doc.terminology']).toBeLessThan(85);
    expect(snap.issues.some((i) => i.code === 'DOC_TBD_TOKENS')).toBe(true);
  });

  it('accepts a table-heavy data dictionary', () => {
    const snap = analyzeDocumentQuality(tableOnlyContent, { expectsTables: true });
    expect(snap.tables.length).toBe(1);
    expect(snap.scores['doc.tables']).toBeGreaterThan(60);
  });

  it('treats expectsTraceability=true as a high-severity gap when section is missing', () => {
    const snap = analyzeDocumentQuality('# Doc\n\n## Objetivo\nAlgo.', { expectsTraceability: true });
    const trace = snap.issues.find((i) => i.code === 'DOC_MISSING_SECTION_TRACEABILITY');
    expect(trace?.severity).toBe('high');
  });
});
