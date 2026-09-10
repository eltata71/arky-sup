import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObservabilityBanner } from '../../../components/artifacts';

describe('ObservabilityBanner', () => {
    it('renders nothing when alert is null', () => {
        const { container } = render(
            <ObservabilityBanner
                alert={null}
                diagnosticCopied={false}
                onCopyDiagnosticReport={() => {}}
                onOpenTracePanel={() => {}}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders the alert tone and surfaces the trace + copy actions', () => {
        const onCopy = vi.fn();
        const onOpen = vi.fn();
        render(
            <ObservabilityBanner
                alert={{
                    tone: 'amber',
                    title: 'Fallback usado',
                    body: 'La IA no entregó IR completa',
                    detail: 'Etapa render: degradación',
                }}
                diagnosticReport="report"
                diagnosticCopied={false}
                onCopyDiagnosticReport={onCopy}
                onOpenTracePanel={onOpen}
            />,
        );
        expect(screen.getByText('Fallback usado')).toBeInTheDocument();
        expect(screen.getByText('Etapa render: degradación')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Ver traza'));
        fireEvent.click(screen.getByText('Copiar reporte técnico'));
        expect(onOpen).toHaveBeenCalled();
        expect(onCopy).toHaveBeenCalled();
    });

    it('hides the copy report button when no report is available', () => {
        render(
            <ObservabilityBanner
                alert={{ tone: 'blue', title: 'Notas', body: 'Sin issues' }}
                diagnosticReport={null}
                diagnosticCopied={false}
                onCopyDiagnosticReport={() => {}}
                onOpenTracePanel={() => {}}
            />,
        );
        expect(screen.queryByText('Copiar reporte técnico')).toBeNull();
    });
});
