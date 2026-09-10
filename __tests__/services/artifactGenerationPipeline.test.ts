import { describe, expect, it } from 'vitest';
import { getArtifactViewCapabilities, normalizeArtifactEnvelope, resolveSafeArtifactView, validateArtifactEnvelope, parseArtifactRawResponse } from '../../services/artifacts/artifactGenerationPipeline';
import { sanitizeGeneratedHtml } from '../../lib/security';
import { buildGenerationObservabilityAlert } from '../../components/artifactCanvasObservability';
import { validateArtifactForExport } from '../../services/export/artifactExportValidation';
import type { Artifact } from '../../types';

const baseArtifact: Artifact = {
  id: 'a1',
  versionGroupId: 'vg1',
  version: 1,
  createdAt: '2026-05-11T00:00:00.000Z',
  name: 'Documento de Arquitectura',
  type: 'markdown',
  phase: 'Lógica',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# Documento\n\nContenido operativo suficiente para exportar como documento sin requerir nodos ni aristas de diagrama. Incluye decisiones y alcance.',
  objective: 'Documentar',
  keyConcepts: [],
  representation: 'document',
};

describe('artifactGenerationPipeline', () => {
  it('normaliza markdown aunque se esperara diagrama y provee fallback visible', () => {
    const envelope = normalizeArtifactEnvelope({
      artifactId: 'gen-1',
      title: 'Diagrama de Integración',
      artifactType: 'mermaid-graph',
      representation: 'diagram',
      rawResponse: '# Integración\n\nLa IA devolvió documentación en lugar de Mermaid.',
      intent: 'on-demand',
    });
    const validation = validateArtifactEnvelope(envelope);
    expect(envelope.metadata.parser).toBe('markdown');
    expect(envelope.viewModes).toContain('document');
    expect(validation.ok).toBe(true);
    expect(validation.visibleViewMode).toBe('document');
  });

  it('extrae Mermaid precedido por texto introductorio y selecciona diagrama', () => {
    const envelope = normalizeArtifactEnvelope({
      artifactId: 'gen-intro-mermaid',
      title: 'Diagrama de Integración',
      artifactType: 'mermaid-graph',
      representation: 'diagram',
      rawResponse: 'Claro. Aquí está el diagrama solicitado:\n\nflowchart TD\n  Cliente --> API\n  API --> Core',
      intent: 'on-demand',
    });
    expect(envelope.metadata.parser).toBe('mermaid');
    expect(envelope.payloads.mermaid?.content).toMatch(/^flowchart TD/);
    expect(envelope.primaryViewMode).toBe('diagram');
    expect(validateArtifactEnvelope(envelope).visibleViewMode).toBe('diagram');
  });

  it('normaliza JSON/IR válido con nodos y aristas como vista de diagrama', () => {
    const parsed = parseArtifactRawResponse(JSON.stringify({
      ir: {
        nodes: [{ id: 'api', label: 'API', kind: 'service' }],
        edges: [],
      },
      content: '# Integración\n\nDocumento complementario.',
    }), 'react-flow-graph');
    expect(parsed.parser).toBe('json');
    expect(parsed.payloads['react-flow']?.renderable).toBe(true);
    expect(parsed.payloads.markdown?.renderable).toBe(true);
  });

  it('redirige una vista de diagrama no renderizable a documento seguro', () => {
    const artifact: Artifact = {
      ...baseArtifact,
      id: 'bad-diagram',
      name: 'Diagrama incompleto',
      type: 'mermaid-graph',
      representation: 'diagram',
      content: 'La IA describió el diagrama pero no devolvió Mermaid ni IR.',
    };
    expect(getArtifactViewCapabilities(artifact).hasRenderableDiagram).toBe(false);
    expect(resolveSafeArtifactView(artifact, 'diagram')).toBe('document');
  });

  it('registra JSON parcial como warning y conserva texto crudo renderizable', () => {
    const parsed = parseArtifactRawResponse('{ "nodes": [', 'react-flow-graph');
    expect(parsed.diagnostics.some((item) => item.code === 'parser.json.partial')).toBe(true);
    expect(parsed.payloads.text?.renderable).toBe(true);
  });

  it('bloquea respuesta vacía antes de marcarla como visible', () => {
    const envelope = normalizeArtifactEnvelope({
      artifactId: 'gen-empty',
      title: 'Vacío',
      artifactType: 'markdown',
      representation: 'document',
      rawResponse: '   ',
      intent: 'catalog',
    });
    expect(validateArtifactEnvelope(envelope).ok).toBe(false);
  });
});

describe('artifact rendering observability', () => {
  it('no muestra éxito con notas cuando el render especializado está repairable', () => {
    const alert = buildGenerationObservabilityAlert({
      traceStatus: 'warning',
      traceErrorCount: 1,
      renderStatus: 'repairable',
      hasDisplayFlowNodes: true,
      hasVisibleFallbackContent: true,
      activeViewMode: 'markdown',
    });
    expect(alert?.tone).toBe('amber');
    expect(alert?.title).toMatch(/degradada/i);
  });

  it('sanitiza HTML generado por IA antes de inyectarlo', () => {
    expect(sanitizeGeneratedHtml('<h1>Ok</h1><script>alert(1)</script><a href="javascript:alert(1)" onclick="x()">x</a>')).not.toMatch(/script|javascript|onclick/i);
  });
});

describe('document export validation', () => {
  it('no exige nodos/aristas para exportar documentos', () => {
    const result = validateArtifactForExport({ artifact: baseArtifact, activeView: 'document', format: 'pdf' });
    expect(result.canExport).toBe(true);
    expect(result.blockingScopes).not.toContain('diagram');
  });
});
