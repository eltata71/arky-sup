import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { DocumentOutline } from '../../../components/artifacts/DocumentOutline';

const SAMPLE = '# Introducción\n\ntexto de intro\n\n## Alcance\n\n# Riesgos\n';

describe('DocumentOutline', () => {
    it('shows an empty state when there are no headings', () => {
        render(<DocumentOutline content="solo texto plano sin encabezados" />);
        expect(screen.getByText('Sin estructura de secciones')).toBeInTheDocument();
    });

    it('lists every heading as a navigation item', () => {
        render(<DocumentOutline content={SAMPLE} />);
        expect(screen.getByRole('button', { name: /Introducción/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Alcance/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Riesgos/ })).toBeInTheDocument();
    });

    it('renders a completion progressbar', () => {
        render(<DocumentOutline content={SAMPLE} />);
        // 1 of 3 sections has content → 33%.
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '33');
    });

    it('invokes onNavigate with the section when activated', () => {
        const onNavigate = vi.fn();
        render(<DocumentOutline content={SAMPLE} onNavigate={onNavigate} />);
        fireEvent.click(screen.getByRole('button', { name: /Alcance/ }));
        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(onNavigate.mock.calls[0][0]).toMatchObject({ title: 'Alcance' });
    });

    it('shows comment counts when provided', () => {
        render(
            <DocumentOutline
                content={SAMPLE}
                commentCounts={{ introduccion: 3 }}
            />,
        );
        expect(screen.getByLabelText('3 comentarios abiertos')).toBeInTheDocument();
    });

    it('marks the active section with aria-current', () => {
        render(<DocumentOutline content={SAMPLE} activeSectionId="alcance" />);
        expect(screen.getByRole('button', { name: /Alcance/ })).toHaveAttribute('aria-current', 'true');
    });
});
