import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReviewStatusBadge, reviewStatusLabel } from '../../../components/artifacts/ReviewStatusBadge';
import { UiTranslationProvider } from '../../../lib/i18n/UiTranslationContext';
import { en } from '../../../lib/i18n/locales/en';
import { es } from '../../../lib/i18n/locales/es';
import { translate } from '../../../lib/i18n/translate';

describe('ReviewStatusBadge', () => {
    it('defaults to "Borrador" when status is undefined', () => {
        render(<ReviewStatusBadge />);
        expect(screen.getByText('Borrador')).toBeInTheDocument();
    });

    it('maps each status to its localized label', () => {
        expect(reviewStatusLabel('approved')).toBe('Aprobado');
        expect(reviewStatusLabel('pending-review')).toBe('En revisión');
        expect(reviewStatusLabel('changes-requested')).toBe('Requiere cambios');
        expect(reviewStatusLabel('rejected')).toBe('Rechazado');
        expect(reviewStatusLabel('draft')).toBe('Borrador');
    });

    it('renders an aria-label that announces the workflow state', () => {
        render(<ReviewStatusBadge status="changes-requested" />);
        expect(screen.getByLabelText(/Requiere cambios/)).toBeInTheDocument();
    });

    it('hides the text in compact mode but keeps the aria-label', () => {
        render(<ReviewStatusBadge status="approved" compact />);
        expect(screen.queryByText('Aprobado')).not.toBeInTheDocument();
        expect(screen.getByLabelText(/Aprobado/)).toBeInTheDocument();
    });

    it('translates both the badge and its accessible description in English', () => {
        render(<UiTranslationProvider t={(key, replacements) => translate({ es, en }, 'en', key, replacements)}><ReviewStatusBadge status="changes-requested" /></UiTranslationProvider>);
        expect(screen.getByText('Changes required')).toBeInTheDocument();
        expect(screen.getByLabelText(/Changes required/)).toHaveAttribute('title', 'A reviewer requested adjustments');
    });
});
