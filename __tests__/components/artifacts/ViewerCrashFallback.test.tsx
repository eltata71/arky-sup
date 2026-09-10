import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewerCrashFallback } from '../../../components/artifacts';

describe('ViewerCrashFallback', () => {
    it('renders the alert with reset and document fallback', () => {
        const onReset = vi.fn();
        const onSwitch = vi.fn();
        render(
            <ViewerCrashFallback
                title="El canvas falló"
                error={new Error('Boom')}
                onReset={onReset}
                onSwitchToDocument={onSwitch}
                viewerLabel="ReactFlow"
            />,
        );

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('El canvas falló')).toBeInTheDocument();
        expect(screen.getByText(/Vista afectada/)).toHaveTextContent('Vista afectada: ReactFlow');

        fireEvent.click(screen.getByText('Reintentar render'));
        expect(onReset).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Ver como documento'));
        expect(onSwitch).toHaveBeenCalled();
    });

    it('omits the document switch button when no handler is provided', () => {
        render(
            <ViewerCrashFallback
                title="Excalidraw falló"
                error={new Error('No fallback')}
                onReset={() => {}}
            />,
        );
        expect(screen.queryByText('Ver como documento')).toBeNull();
    });

    it('shows the technical details inside a closed disclosure by default', () => {
        render(
            <ViewerCrashFallback
                title="Lucid falló"
                error={new Error('Lucid stacktrace')}
                onReset={() => {}}
            />,
        );
        const details = screen.getByText('Detalles técnicos').closest('details');
        expect(details).not.toBeNull();
        expect(details).not.toHaveAttribute('open');
        expect(screen.getByText('Lucid stacktrace')).toBeInTheDocument();
    });
});
