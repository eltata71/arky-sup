import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { DiagramQualityPanel } from '../../components/artifacts/quality/DiagramQualityPanel';
import type { DiagramQualityReport } from '../../services/diagram/quality/diagramQualityService';

const baseReport: DiagramQualityReport = {
  score: 72,
  summary: 'Diagrama con margen de mejora.',
  archetype: 'context',
  issues: [],
  breakdown: {
    claridadSemantica: 80,
    consistenciaArquitectonica: 75,
    jerarquiaVisual: 70,
    legibilidad: 60,
    narrativa: 78,
    atractivoVisual: 72,
    preparacionEjecutiva: 70,
    preparacionTecnica: 70,
    exportabilidad: 80,
    mantenibilidadPipeline: 80,
  } as DiagramQualityReport['breakdown'],
  visualGate: {
    score: 64,
    state: 'warnings',
    rationale: 'Visual Gate 2.0: 2 hallazgos.',
    recommendedActions: [],
    safeAutomaticActions: ['APPLY_FOCUS_PRIMARY_FIT', 'RETRY_LAYOUT_SPACIOUS', 'EXPAND_LOGICAL_CANVAS_BOUNDS'],
    signals: [
      { code: 'INITIAL_ZOOM_ILLEGIBLE', severity: 'high', message: 'Zoom inicial bajo el umbral.' },
    ],
  },
};

const noop = () => {};

describe('DiagramQualityPanel — Visual Gate actions (Brecha 4 + Recomendación 5)', () => {
  it('renders safeAutomaticActions as informational chips when no callback is provided', () => {
    render(
      <DiagramQualityPanel
        open
        qualityReport={baseReport}
        isAutoImproving={false}
        onClose={noop}
        onAutoImprove={noop}
        onGenerateWorldClass={noop}
        onApplyIssueFix={noop}
      />,
    );
    // The actions render but they are not interactive (no buttons).
    expect(screen.getByText('APPLY_FOCUS_PRIMARY_FIT')).toBeInTheDocument();
    expect(screen.getByText('RETRY_LAYOUT_SPACIOUS')).toBeInTheDocument();
    // The chip should not be a button when there's no handler.
    expect(screen.getByText('APPLY_FOCUS_PRIMARY_FIT').tagName).not.toBe('BUTTON');
  });

  it('renders safeAutomaticActions as buttons that invoke onApplyAutoAction', () => {
    const onApplyAutoAction = vi.fn();
    render(
      <DiagramQualityPanel
        open
        qualityReport={baseReport}
        isAutoImproving={false}
        onClose={noop}
        onAutoImprove={noop}
        onGenerateWorldClass={noop}
        onApplyIssueFix={noop}
        onApplyAutoAction={onApplyAutoAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /APPLY_FOCUS_PRIMARY_FIT/ }));
    expect(onApplyAutoAction).toHaveBeenCalledWith('APPLY_FOCUS_PRIMARY_FIT');

    fireEvent.click(screen.getByRole('button', { name: /RETRY_LAYOUT_SPACIOUS/ }));
    expect(onApplyAutoAction).toHaveBeenCalledWith('RETRY_LAYOUT_SPACIOUS');
  });

  it('shows the Visual Quality Gate state badge', () => {
    render(
      <DiagramQualityPanel
        open
        qualityReport={baseReport}
        isAutoImproving={false}
        onClose={noop}
        onAutoImprove={noop}
        onGenerateWorldClass={noop}
        onApplyIssueFix={noop}
      />,
    );
    expect(screen.getByText('warnings')).toBeInTheDocument();
    expect(screen.getByText(/Visual Gate 2.0/i)).toBeInTheDocument();
  });

  it('hides the auto-action section entirely when the gate produced no safe actions', () => {
    const reportWithoutActions: DiagramQualityReport = {
      ...baseReport,
      visualGate: { ...baseReport.visualGate!, safeAutomaticActions: [] },
    };
    render(
      <DiagramQualityPanel
        open
        qualityReport={reportWithoutActions}
        isAutoImproving={false}
        onClose={noop}
        onAutoImprove={noop}
        onGenerateWorldClass={noop}
        onApplyIssueFix={noop}
        onApplyAutoAction={() => {}}
      />,
    );
    expect(screen.queryByText(/Acciones automáticas seguras/i)).not.toBeInTheDocument();
  });
});
