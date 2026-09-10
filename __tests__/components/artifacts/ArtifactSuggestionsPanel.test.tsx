import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ArtifactSuggestionsPanel } from '../../../components/artifacts/suggestions/ArtifactSuggestionsPanel';
import type { ArtifactSuggestionReport } from '../../../services/ai/artifactSuggestionService';

const noop = () => {};

const baseProps = {
  isOpen: true,
  onClose: noop,
  artifactName: 'Diagrama de contexto',
  status: 'idle' as const,
  report: null,
  error: null,
  onAnalyze: noop,
  onApplyWithAI: noop,
  canApplyWithAI: false,
  isApplyingWithAI: false,
  onAutoImprove: noop,
  canAutoImprove: true,
  isAutoImproving: false,
  onGenerateWorldClass: noop,
};

const successReport: ArtifactSuggestionReport = {
  generatedAt: '2026-05-18T00:00:00.000Z',
  qualitySummary: 'El artefacto necesita más contexto técnico para alcanzar nivel productivo.',
  currentScore: 68,
  suggestions: [
    {
      id: 's1',
      title: 'Conecta el nodo huérfano',
      description: 'El nodo B no tiene relaciones entrantes.',
      gapType: 'diagram',
      impact: 'high',
      effort: 'low',
      recommendedAction: 'Conecta el nodo B con su origen lógico.',
      evidence: 'Traza: nodo huérfano detectado.',
      expectedQualityGain: 12,
    },
  ],
  insufficientContext: false,
  missingContextHints: [],
  modelUsed: 'gemini-2.5-flash',
};

describe('ArtifactSuggestionsPanel', () => {
  it('shows the idle state with an analyze action', () => {
    const onAnalyze = vi.fn();
    render(<ArtifactSuggestionsPanel {...baseProps} status="idle" onAnalyze={onAnalyze} />);
    const analyze = screen.getByRole('button', { name: /Analizar artefacto/ });
    fireEvent.click(analyze);
    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while the analysis runs', () => {
    render(<ArtifactSuggestionsPanel {...baseProps} status="loading" />);
    expect(screen.getByText(/Analizando calidad y contexto/)).toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    const onAnalyze = vi.fn();
    render(
      <ArtifactSuggestionsPanel
        {...baseProps}
        status="error"
        error="El servicio de IA no respondió."
        onAnalyze={onAnalyze}
      />,
    );
    expect(screen.getByText('El servicio de IA no respondió.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('renders the prioritized suggestions on success', () => {
    render(
      <ArtifactSuggestionsPanel
        {...baseProps}
        status="success"
        report={successReport}
        canApplyWithAI
      />,
    );
    expect(screen.getByText('Conecta el nodo huérfano')).toBeInTheDocument();
    expect(screen.getByText(/necesita más contexto técnico/)).toBeInTheDocument();
    expect(screen.getByText('Calidad diagramática')).toBeInTheDocument();
  });

  it('separates the automatic AI actions and disables "Mejorar con IA" without suggestions', () => {
    const onGenerateWorldClass = vi.fn();
    render(
      <ArtifactSuggestionsPanel
        {...baseProps}
        status="idle"
        canApplyWithAI={false}
        onGenerateWorldClass={onGenerateWorldClass}
      />,
    );
    expect(screen.getByRole('button', { name: /Mejorar con IA/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Mejorar automáticamente/ })).toBeInTheDocument();
    const worldClass = screen.getByRole('button', { name: /Generar versión de clase mundial/ });
    fireEvent.click(worldClass);
    expect(onGenerateWorldClass).toHaveBeenCalledTimes(1);
  });
});
