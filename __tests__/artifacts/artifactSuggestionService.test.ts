import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import {
  ArtifactSuggestionError,
  parseArtifactSuggestionReport,
  sortSuggestionsByPriority,
  type ArtifactSuggestion,
} from '../../services/ai/artifactSuggestionTypes';
import { buildArtifactSuggestionContext, requestArtifactSuggestions } from '../../services/ai/artifactSuggestionService';
import { aiGateway } from '../../services/ai/generation/aiGateway';

const settings = { language: 'es' } as Settings;

const project: Project = {
  id: 'p1',
  name: 'Core bancario',
  description: 'Plataforma core.',
  projectContext: ['El API Gateway es el punto único de entrada.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const artifact = {
  id: 'a1',
  name: 'Diagrama de contexto',
  type: 'mermaid-c4-context',
  representation: 'diagram',
  objective: 'Mostrar el contexto del sistema.',
  content: 'flowchart LR\n  A --> B',
  keyConcepts: [{ term: 'API Gateway', definition: 'Punto de entrada.' }],
  generationTrace: {
    id: 't1',
    source: 'on-demand',
    status: 'warning',
    startedAt: '2026-01-01T00:00:00.000Z',
    model: 'gemini-2.5-flash',
    request: { userRequest: 'Necesito un diagrama de contexto.' },
    decisions: [{ stage: 'ai-generation', status: 'success', message: 'IR generada', at: '' }],
    errors: [{ stage: 'render', status: 'error', message: 'Nodo huérfano', at: '' }],
    warnings: ['Etiqueta vacía en una arista'],
  },
} as unknown as Artifact;

const makeSuggestion = (over: Partial<ArtifactSuggestion>): ArtifactSuggestion => ({
  id: 's',
  title: 't',
  description: 'd',
  gapType: 'architecture',
  impact: 'medium',
  effort: 'medium',
  recommendedAction: 'a',
  evidence: 'e',
  expectedQualityGain: null,
  ...over,
});

describe('artifactSuggestionService — report validation', () => {
  it('#1 parses a well-formed AI response into a sorted report', () => {
    const report = parseArtifactSuggestionReport(
      {
        qualitySummary: 'El artefacto necesita más contexto técnico.',
        insufficientContext: false,
        suggestions: [
          {
            title: 'Define los actores',
            description: 'Faltan actores externos.',
            gapType: 'business',
            impact: 'low',
            effort: 'high',
            recommendedAction: 'Agrega actores.',
            evidence: 'No hay actores en el contenido.',
            expectedQualityGain: 8,
          },
          {
            title: 'Conecta el nodo huérfano',
            description: 'El nodo B no tiene relaciones entrantes.',
            gapType: 'diagram',
            impact: 'high',
            effort: 'low',
            recommendedAction: 'Conecta el nodo B.',
            evidence: 'Trace: Nodo huérfano.',
            expectedQualityGain: 15,
          },
        ],
      },
      { currentScore: 72, modelUsed: 'gemini-2.5-flash' },
    );

    expect(report.suggestions).toHaveLength(2);
    // High impact / low effort must come first.
    expect(report.suggestions[0].title).toBe('Conecta el nodo huérfano');
    expect(report.currentScore).toBe(72);
    expect(report.insufficientContext).toBe(false);
  });

  it('#2 drops malformed suggestions and clamps invalid enums', () => {
    const report = parseArtifactSuggestionReport(
      {
        qualitySummary: 'Resumen',
        insufficientContext: false,
        suggestions: [
          { description: 'Sin título — se descarta' },
          {
            title: 'Válida',
            description: 'Con enums inválidos',
            gapType: 'no-existe',
            impact: 'huge',
            effort: 'tiny',
            recommendedAction: 'Acción',
            evidence: 'Evidencia',
            expectedQualityGain: 999,
          },
        ],
      },
      { currentScore: null, modelUsed: null },
    );

    expect(report.suggestions).toHaveLength(1);
    expect(report.suggestions[0].gapType).toBe('architecture');
    expect(report.suggestions[0].impact).toBe('medium');
    expect(report.suggestions[0].effort).toBe('medium');
    // expectedQualityGain is clamped to the 0–40 range.
    expect(report.suggestions[0].expectedQualityGain).toBe(40);
  });

  it('#3 flags insufficient context when there are no usable suggestions', () => {
    const report = parseArtifactSuggestionReport(
      { qualitySummary: 'Resumen', insufficientContext: false, suggestions: [] },
      { currentScore: null, modelUsed: null },
    );
    expect(report.insufficientContext).toBe(true);
  });

  it('#4 throws ArtifactSuggestionError on a non-object response', () => {
    expect(() => parseArtifactSuggestionReport('not-json', { currentScore: null, modelUsed: null }))
      .toThrow(ArtifactSuggestionError);
  });

  it('#5 sortSuggestionsByPriority ranks impact first, then effort', () => {
    const sorted = sortSuggestionsByPriority([
      makeSuggestion({ id: 'low', impact: 'low', effort: 'low' }),
      makeSuggestion({ id: 'high-high', impact: 'high', effort: 'high' }),
      makeSuggestion({ id: 'high-low', impact: 'high', effort: 'low' }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['high-low', 'high-high', 'low']);
  });
});

describe('artifactSuggestionService — context assembly', () => {
  it('#6 assembles a provider-agnostic context from the artifact and trace', () => {
    const context = buildArtifactSuggestionContext(
      { artifact, project, qualityScore: 68, qualitySummary: 'Mejorable', qualityIssues: ['Issue A'] },
      settings,
    );

    expect(context.artifactType).toBe('mermaid-c4-context');
    expect(context.currentScore).toBe(68);
    expect(context.originalPrompt).toBe('Necesito un diagrama de contexto.');
    expect(context.traceErrors).toContain('Nodo huérfano');
    expect(context.validationWarnings).toContain('Etiqueta vacía en una arista');
    expect(context.modelUsed).toBe('gemini-2.5-flash');
    expect(context.language).toBe('es');
  });

  it('#7 caps very long content so the AI request stays bounded', () => {
    const huge = { ...artifact, content: 'x'.repeat(10_000) } as Artifact;
    const context = buildArtifactSuggestionContext(
      { artifact: huge, project, qualityScore: null, qualitySummary: null, qualityIssues: [] },
      settings,
    );
    expect(context.content.length).toBeLessThan(10_000);
    expect(context.content).toContain('contenido truncado');
  });
});

describe('artifactSuggestionService — inference', () => {
  it('uses the shared gateway and validates the JSON response', async () => {
    const gateway = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: '```json\n{"qualitySummary":"Falta contexto","insufficientContext":true,"suggestions":[]}\n```',
    });
    try {
      const context = buildArtifactSuggestionContext(
        { artifact, project, qualityScore: 68, qualitySummary: 'Mejorable', qualityIssues: ['Issue A'] },
        settings,
      );
      const report = await requestArtifactSuggestions(context, settings);
      expect(report.qualitySummary).toBe('Falta contexto');
      expect(gateway).toHaveBeenCalledOnce();
      expect(gateway.mock.calls[0][2]).toContain('Issue A');
      expect(gateway.mock.calls[0][3]).toMatchObject({ responseMimeType: 'application/json', temperature: 0.4 });
      expect(gateway.mock.calls[0][4]).toEqual({ maxRetries: 1, maxCandidates: 4 });
    } finally {
      gateway.mockRestore();
    }
  });

  it('reports malformed JSON as an actionable suggestion error', async () => {
    const gateway = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'not JSON' });
    try {
      const context = buildArtifactSuggestionContext(
        { artifact, project, qualityScore: null, qualitySummary: null, qualityIssues: [] },
        settings,
      );
      await expect(requestArtifactSuggestions(context, settings)).rejects.toThrow(ArtifactSuggestionError);
    } finally {
      gateway.mockRestore();
    }
  });
});
