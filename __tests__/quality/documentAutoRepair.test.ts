import { describe, expect, it } from 'vitest';
import { analyzeDocumentQuality } from '../../services/quality/documentQualityService';
import { repairDocumentContent, buildTraceabilityTable } from '../../services/quality/documentAutoRepair';

describe('repairDocumentContent', () => {
  it('adds an H1 when missing and reports the change', () => {
    const result = repairDocumentContent({
      content: 'Sólo texto sin encabezado.',
      issues: [],
      artifactName: 'Mi Documento',
    });
    expect(result.content.startsWith('# Mi Documento')).toBe(true);
    expect(result.changes.find((c) => c.id === 'doc-h1-added')).toBeTruthy();
  });

  it('appends missing canonical sections detected from the issue list', () => {
    const initial = '# Doc\n\nSólo título y texto.';
    const snap = analyzeDocumentQuality(initial);
    const result = repairDocumentContent({ content: initial, issues: snap.issues });
    expect(result.content).toMatch(/## Objetivo/);
    expect(result.content).toMatch(/## Alcance/);
    expect(result.changes.find((c) => c.id === 'doc-sections-added')).toBeTruthy();
  });

  it('normalises TBD/TODO markers to "_Pendiente_"', () => {
    const result = repairDocumentContent({
      content: '# Doc\n\nEstado: TBD. Acción: TODO revisar.',
      issues: [],
    });
    expect(result.content).not.toMatch(/\bTBD\b/);
    expect(result.content).not.toMatch(/\bTODO\b/);
    expect(result.changes.find((c) => c.id === 'doc-tbd-normalised')).toBeTruthy();
  });

  it('appends a Próximos pasos section when missing', () => {
    const result = repairDocumentContent({ content: '# Doc\n\n## Objetivo\nAlgo.', issues: [] });
    expect(result.content).toMatch(/## Próximos pasos/);
  });

  it('does not duplicate Próximos pasos when present', () => {
    const result = repairDocumentContent({
      content: '# Doc\n\n## Próximos pasos\n- A.\n',
      issues: [],
    });
    const occurrences = (result.content.match(/## Próximos pasos/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('buildTraceabilityTable produces a valid markdown table', () => {
    const rendered = buildTraceabilityTable([
      { requirement: 'RF-01', artifact: 'API', coverage: 'Total' },
      { requirement: 'RF-02', artifact: 'DB', coverage: 'Parcial' },
    ]);
    expect(rendered).toMatch(/\| Requisito \| Artefacto \| Cobertura \|/);
    expect(rendered).toMatch(/RF-01/);
    expect(rendered).toMatch(/Parcial/);
  });
});
