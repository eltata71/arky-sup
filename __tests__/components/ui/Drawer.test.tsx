import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { Drawer } from '../../../components/ui/Drawer';

describe('Drawer', () => {
    it('does not render content when closed', () => {
        render(
            <Drawer isOpen={false} onClose={() => undefined} title="Detalles">
                <p>Contenido</p>
            </Drawer>,
        );
        expect(screen.queryByText('Contenido')).not.toBeInTheDocument();
    });

    it('renders with role="dialog" and aria-modal when open', () => {
        render(
            <Drawer isOpen onClose={() => undefined} title="Detalles">
                <p>Cuerpo</p>
            </Drawer>,
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText('Detalles')).toBeInTheDocument();
        expect(screen.getByText('Cuerpo')).toBeInTheDocument();
    });

    it('triggers onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <Drawer isOpen onClose={onClose} title="Panel">
                <p>x</p>
            </Drawer>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(
            <Drawer isOpen onClose={onClose} title="Panel">
                <p>x</p>
            </Drawer>,
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders a footer when provided', () => {
        render(
            <Drawer isOpen onClose={() => undefined} title="Panel" footer={<button>Guardar</button>}>
                <p>x</p>
            </Drawer>,
        );
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    });

    it('uses aria-label when no title is provided', () => {
        render(
            <Drawer isOpen onClose={() => undefined} ariaLabel="Panel sin título">
                <p>contenido</p>
            </Drawer>,
        );
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Panel sin título');
    });
});
