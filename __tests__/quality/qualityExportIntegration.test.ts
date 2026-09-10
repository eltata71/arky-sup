import { describe, expect, it } from 'vitest';
import { exportArtifact } from '../../services/export/exportService';
import { renderQualityReportMarkdown } from '../../services/quality/qualityReportRenderer';
import { buildArtifactQualityReport } from '../../services/quality/artifactQualityService';
import { richDocumentArtifact, tableOnlyContent, baseArtifact } from './fixtures';

const ctx = (artifact = richDocumentArtifact, extra: Record<string, unknown> = {}) => ({
  artifact,
  activeView: 'document' as const,
  appName: 'Arky Pro',
  generatedAt: new Date('2026-05-15T00:00:00Z'),
  ...extra,
});

describe('quality + export integration', () => {
  it('Markdown export appends the quality report when includeQualityReport is true', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact, { includeQualityReport: true }), 'md');
    const text = await result.file.blob.text();
    expect(text).toMatch(/## Reporte de calidad/);
    expect(text).toMatch(/Dimensiones evaluadas/);
  });

  it('Markdown export omits the quality report by default', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact), 'md');
    const text = await result.file.blob.text();
    expect(text).not.toMatch(/## Reporte de calidad/);
  });

  it('JSON export always carries a quality payload for trace-ability', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact), 'json');
    const text = await result.file.blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.quality).toBeDefined();
    expect(parsed.quality.score.value).toBeGreaterThanOrEqual(0);
    expect(parsed.quality.dimensions.length).toBeGreaterThan(0);
  });

  it('XLSX export works with a table-only Markdown artifact', async () => {
    const artifact = baseArtifact({ content: tableOnlyContent });
    const result = await exportArtifact({
      artifact,
      activeView: 'table',
      appName: 'Arky Pro',
    }, 'xlsx');
    expect(result.file.blob.size).toBeGreaterThan(0);
    const header = new Uint8Array(await result.file.blob.slice(0, 4).arrayBuffer());
    expect(header[0]).toBe(0x50); // P (ZIP)
    expect(header[1]).toBe(0x4b); // K
  });

  it('DOCX export embeds the quality report when requested', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact, { includeQualityReport: true }), 'docx');
    expect(result.file.blob.size).toBeGreaterThan(2000);
    const header = new Uint8Array(await result.file.blob.slice(0, 4).arrayBuffer());
    expect(header[0]).toBe(0x50);
    expect(header[1]).toBe(0x4b);
  });

  it('renderQualityReportMarkdown produces a stable Markdown block', () => {
    const report = buildArtifactQualityReport(richDocumentArtifact);
    const md = renderQualityReportMarkdown(report);
    expect(md).toContain('## Reporte de calidad');
    expect(md).toContain('Puntaje global');
    expect(md).toContain('Dimensiones evaluadas');
  });

  it('PDF export grows when the quality report is embedded', async () => {
    const withReport = await exportArtifact(ctx(richDocumentArtifact, { includeQualityReport: true }), 'pdf');
    const without = await exportArtifact(ctx(richDocumentArtifact), 'pdf');
    expect(withReport.file.blob.size).toBeGreaterThan(without.file.blob.size);
    const header = new Uint8Array(await withReport.file.blob.slice(0, 4).arrayBuffer());
    expect(String.fromCharCode(...header)).toBe('%PDF');
  });

  it('HTML export embeds the quality report section when requested', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact, { includeQualityReport: true }), 'html');
    const text = await result.file.blob.text();
    expect(text).toMatch(/Reporte de calidad/);
    expect(text).toMatch(/quality-report/);
  });

  it('JSON export carries the full ArtifactQualityReport and exportability state', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact), 'json');
    const parsed = JSON.parse(await result.file.blob.text());
    expect(parsed.quality.report).toBeDefined();
    expect(parsed.quality.report.score.value).toBeGreaterThanOrEqual(0);
    expect(parsed.quality.exportability.document).toBeDefined();
    expect(parsed.quality.exportability.diagram).toBeDefined();
    expect(parsed.quality.exportability.table).toBeDefined();
  });

  it('records quality traceability on every export attempt', async () => {
    const result = await exportArtifact(ctx(richDocumentArtifact), 'docx');
    expect(result.trace.quality).toBeDefined();
    expect(result.trace.quality?.gateId).toBe('export:docx');
    expect(typeof result.trace.quality?.score).toBe('number');
    expect(result.trace.quality?.gatePassed).toBe(true);
  });
});
