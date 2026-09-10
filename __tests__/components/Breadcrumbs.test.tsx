import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { Breadcrumbs } from '../../components/Breadcrumbs';

describe('Breadcrumbs', () => {
    it('renders every crumb label', () => {
        render(
            <Breadcrumbs
                crumbs={[
                    { label: 'Proyecto Alfa' },
                    { label: 'Documento de Arquitectura' },
                ]}
            />,
        );
        expect(screen.getByText('Proyecto Alfa')).toBeInTheDocument();
        expect(screen.getByText('Documento de Arquitectura')).toBeInTheDocument();
    });

    it('exposes an accessible Breadcrumb landmark', () => {
        render(<Breadcrumbs crumbs={[{ label: 'Inicio' }]} />);
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    });

    it('invokes onClick for interactive non-last crumbs', () => {
        const onClick = vi.fn();
        render(
            <Breadcrumbs
                crumbs={[
                    { label: 'Proyecto', onClick },
                    { label: 'Artefacto' },
                ]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Proyecto/ }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not make the last crumb interactive even with onClick', () => {
        const onClick = vi.fn();
        render(
            <Breadcrumbs
                crumbs={[
                    { label: 'Proyecto' },
                    { label: 'Artefacto', onClick },
                ]}
            />,
        );
        expect(screen.queryByRole('button', { name: /Artefacto/ })).not.toBeInTheDocument();
    });

    it('renders the optional meta label', () => {
        render(<Breadcrumbs crumbs={[{ label: 'Doc', meta: 'v3' }]} />);
        expect(screen.getByText('v3')).toBeInTheDocument();
    });
});
