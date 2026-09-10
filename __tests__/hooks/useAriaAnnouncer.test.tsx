import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { AriaAnnouncerProvider, useAriaAnnouncer } from '../../hooks/useAriaAnnouncer';

const Trigger: React.FC<{ message: string; politeness?: 'polite' | 'assertive' }> = ({ message, politeness }) => {
    const { announce } = useAriaAnnouncer();
    return (
        <button type="button" onClick={() => announce(message, politeness)}>
            announce
        </button>
    );
};

describe('useAriaAnnouncer', () => {
    it('announces messages on the polite live region by default', async () => {
        render(
            <AriaAnnouncerProvider>
                <Trigger message="Artefacto guardado" />
            </AriaAnnouncerProvider>,
        );
        const polite = screen.getByTestId('aria-announcer-polite');
        expect(polite).toBeInTheDocument();
        expect(polite).toHaveAttribute('aria-live', 'polite');

        act(() => {
            screen.getByRole('button', { name: 'announce' }).click();
        });
        // Announcement is set on the next animation frame.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        expect(polite).toHaveTextContent('Artefacto guardado');
    });

    it('uses the assertive region when requested', async () => {
        render(
            <AriaAnnouncerProvider>
                <Trigger message="Falló el guardado" politeness="assertive" />
            </AriaAnnouncerProvider>,
        );
        const assertive = screen.getByTestId('aria-announcer-assertive');
        expect(assertive).toHaveAttribute('aria-live', 'assertive');
        act(() => {
            screen.getByRole('button', { name: 'announce' }).click();
        });
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        expect(assertive).toHaveTextContent('Falló el guardado');
    });

    it('returns a no-op announcer outside the provider', () => {
        // The hook itself should not throw when no provider is mounted.
        // We render an isolated consumer and click — no error means pass.
        render(<Trigger message="ignored" />);
        expect(() => screen.getByRole('button', { name: 'announce' }).click()).not.toThrow();
    });
});
