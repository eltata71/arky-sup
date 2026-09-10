import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagramQualityPanel } from '../../../components/artifacts';
import type { DiagramQualityReport } from '../../../services/diagram/quality/diagramQualityService';

const baseReport: DiagramQualityReport = {
    score: 72,
    summary: 'Diagrama mejorable',
    breakdown: {
        claridadSemantica: 80,
        consistenciaArquitectonica: 70,
        jerarquiaVisual: 60,
        legibilidad: 75,
        narrativa: 65,
        atractivoVisual: 70,
        preparacionEjecutiva: 60,
        preparacionTecnica: 80,
        exportabilidad: 90,
        mantenibilidadPipeline: 70,
    },
    issues: [
        {
            id: 'orphan-1',
            severity: 'high',
            code: 'orphan-node',
            message: 'Nodo huérfano detectado',
            recommendation: 'Conectarlo al sistema principal',
        },
    ],
    visualGate: {
        score: 64,
        state: 'warnings',
        rationale: 'Visual Gate 2.0 con hallazgos de legibilidad.',
        signals: [
            { code: 'EXCESSIVE_EDGE_CROSSINGS', severity: 'medium', message: 'Cruces por encima del umbral.' },
        ],
        recommendedActions: [],
        safeAutomaticActions: [],
    },
};

describe('DiagramQualityPanel', () => {
    it('does not render when closed', () => {
        const { container } = render(
            <DiagramQualityPanel
                open={false}
                qualityReport={baseReport}
                isAutoImproving={false}
                onClose={() => {}}
                onAutoImprove={() => {}}
                onGenerateWorldClass={() => {}}
                onApplyIssueFix={() => {}}
            />,
        );
        expect(container.querySelector('[role="complementary"]')).toBeNull();
    });

    it('does not render when qualityReport is null', () => {
        const { container } = render(
            <DiagramQualityPanel
                open
                qualityReport={null}
                isAutoImproving={false}
                onClose={() => {}}
                onAutoImprove={() => {}}
                onGenerateWorldClass={() => {}}
                onApplyIssueFix={() => {}}
            />,
        );
        expect(container.querySelector('[role="complementary"]')).toBeNull();
    });

    it('renders the score, summary and dispatches actions', () => {
        const onClose = vi.fn();
        const onAuto = vi.fn();
        const onWorldClass = vi.fn();
        const onFix = vi.fn();

        render(
            <DiagramQualityPanel
                open
                qualityReport={baseReport}
                isAutoImproving={false}
                onClose={onClose}
                onAutoImprove={onAuto}
                onGenerateWorldClass={onWorldClass}
                onApplyIssueFix={onFix}
            />,
        );

        expect(screen.getByText(/72\/100/)).toBeInTheDocument();
        expect(screen.getByText('Diagrama mejorable')).toBeInTheDocument();
        expect(screen.getByText(/Visual Quality Gate 2.0/)).toBeInTheDocument();
        expect(screen.getByText(/64\/100/)).toBeInTheDocument();
        expect(screen.getByText(/EXCESSIVE_EDGE_CROSSINGS/)).toBeInTheDocument();
        expect(screen.getByText('Nodo huérfano detectado')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Auto-mejorar diagrama'));
        fireEvent.click(screen.getByText('Generar clase mundial'));
        fireEvent.click(screen.getByText('Aplicar fix rápido'));
        fireEvent.click(screen.getByText('Cerrar'));

        expect(onAuto).toHaveBeenCalled();
        expect(onWorldClass).toHaveBeenCalled();
        expect(onFix).toHaveBeenCalledWith('orphan-1');
        expect(onClose).toHaveBeenCalled();
    });
});
