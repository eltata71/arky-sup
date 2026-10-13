import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../../context/ToastContext';
import { UiTranslationProvider } from '../../lib/i18n/UiTranslationContext';
import { en } from '../../lib/i18n/locales/en';
import { es } from '../../lib/i18n/locales/es';
import { translate } from '../../lib/i18n/translate';

function Trigger() {
  const { addToast } = useToast();
  return <button onClick={() => addToast('Saved', 'success', { durationMs: 0 })}>Show toast</button>;
}

describe('toast language', () => {
  it('uses the selected language for its close control', () => {
    const t = (key: string) => translate({ es, en }, 'en', key);
    render(<UiTranslationProvider t={t}><ToastProvider><Trigger /></ToastProvider></UiTranslationProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }));
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });
});
