import { describe, expect, it } from 'vitest';
import {
  buildArchitectureContextGraph,
  buildContextPackForProject,
  buildContextReportText,
  buildContextUsageReport,
  renderContextGraphReinforcement,
} from '../../services/contextGraph';
import { makeProject, makeRichProject, makeSettings } from './fixtures';

const settings = makeSettings();

describe('contextGraphIntegration — prompt reinforcement', () => {
  it('renders a citable context block for prompt injection', () => {
    const project = makeRichProject();
    const block = renderContextGraphReinforcement(project, settings, {
      artifactType: 'mermaid-c4-context',
      audience: 'technical',
      intent: 'Diagrama de contexto del sistema',
      language: 'es',
    });

    expect(block).toContain('ARCHITECTURE CONTEXT GRAPH');
    expect(block).toContain('[ctx:');
    expect(block).toContain('INSTRUCCIONES DE TRAZABILIDAD');
  });

  it('degrades to an empty string when there is no structured context', () => {
    const empty = makeProject({ name: '', description: '', projectContext: [] });
    const block = renderContextGraphReinforcement(empty, settings, { artifactType: 'markdown' });
    expect(block).toBe('');
  });
});

describe('contextGraphIntegration — traceability of context used', () => {
  it('builds a usage report explaining which context an artifact relied on', () => {
    const project = makeRichProject();
    const pack = buildContextPackForProject(project, settings, {
      artifactType: 'sdd-brd',
      audience: 'mixed',
      intent: 'Requisitos de negocio del asegurado',
      detailLevel: 'standard',
    });
    const report = buildContextUsageReport(pack, 'artifact-42');

    expect(report.packId).toBe(pack.id);
    expect(report.projectId).toBe(project.id);
    expect(report.artifactId).toBe('artifact-42');
    expect(report.usedEntities.length).toBeGreaterThan(0);
    expect(report.usedEntities.every((e) => e.citation.startsWith('[ctx:'))).toBe(true);
    expect(report.sources.length).toBeGreaterThan(0);
    // The report exposes ignored signals and conflicts for an honest trace.
    expect(Array.isArray(report.ignoredSignals)).toBe(true);
    expect(Array.isArray(report.conflicts)).toBe(true);
    expect(Array.isArray(report.appliedConstraints)).toBe(true);
    expect(Array.isArray(report.consideredRisks)).toBe(true);
  });

  it('renders a copy-pasteable context report', () => {
    const project = makeRichProject();
    const graph = buildArchitectureContextGraph(project, settings);
    const text = buildContextReportText(graph);

    expect(text).toContain('# Reporte de contexto');
    expect(text).toContain('## Entidades principales');
    expect(text).toContain('## Fuentes');
  });
});
