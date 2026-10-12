import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UiTranslationProvider, useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import { es } from '../../../lib/i18n/locales/es';
import { en } from '../../../lib/i18n/locales/en';
import { translate } from '../../../lib/i18n/translate';

function Probe() {
  const t = useUiTranslation();
  return <span>{t('errorBoundary.retry')}</span>;
}

describe('UI translation context', () => {
  it('uses Spanish when a component renders outside the app provider', () => {
    render(<Probe />);
    expect(screen.getByText('Intentar de nuevo')).toBeTruthy();
  });

  it('uses the selected English dictionary inside the provider', () => {
    const dictionaries = { es, en };
    render(<UiTranslationProvider t={key => translate(dictionaries, 'en', key)}><Probe /></UiTranslationProvider>);
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
