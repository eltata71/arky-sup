import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { Alert } from '../../../components/ui/Alert';

describe('Alert', () => {
    it('renders title and body', () => {
        render(
            <Alert title="Operación exitosa" tone="success">
                El artefacto se guardó correctamente.
            </Alert>,
        );
        expect(screen.getByText('Operación exitosa')).toBeInTheDocument();
        expect(screen.getByText('El artefacto se guardó correctamente.')).toBeInTheDocument();
    });

    it('uses role="status" for non-danger tones', () => {
        render(<Alert tone="info">Aviso</Alert>);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('escalates to role="alert" + assertive aria-live for danger tone', () => {
        render(<Alert tone="danger">Falló la operación</Alert>);
        const node = screen.getByRole('alert');
        expect(node).toHaveAttribute('aria-live', 'assertive');
    });

    it('respects an explicit aria-live override', () => {
        render(<Alert tone="info" live="assertive">Aviso urgente</Alert>);
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'assertive');
    });

    it('renders a dismiss button when onDismiss is provided', () => {
        const onDismiss = vi.fn();
        render(<Alert tone="warning" onDismiss={onDismiss}>Cuidado</Alert>);
        const btn = screen.getByRole('button', { name: 'Descartar alerta' });
        fireEvent.click(btn);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not depend solely on color — exposes an icon for every tone by default', () => {
        const { container } = render(<Alert tone="warning">Sin titulo</Alert>);
        // The default icon renders as an SVG inside the alert.
        expect(container.querySelector('svg')).toBeTruthy();
    });

    it('renders actions when provided', () => {
        render(
            <Alert tone="info" actions={<button>Reintentar</button>}>Algo pasó</Alert>,
        );
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });
});
