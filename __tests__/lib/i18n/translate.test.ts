/**
 * The lookup, on a fixture rather than on the product dictionary.
 *
 * Moved here with `translate` itself when i18n stopped being a section of
 * `utils.ts`. The fixture is the point: these assertions are about the lookup
 * rule — unknown key, unknown language, placeholder substitution — and binding
 * them to real copy would make every wording change a test change.
 */
import { describe, it, expect } from 'vitest';
import { translate } from '../../../lib/i18n';

describe('translate', () => {
  const translations: Record<string, Record<string, string>> = {
    en: {
      projects: 'Projects',
      greeting: 'Hello {name}!',
      multi: '{a} and {b}',
    },
    es: {
      projects: 'Proyectos',
      greeting: '¡Hola {name}!',
    },
  };

  it('returns the translated string for a known key', () => {
    expect(translate(translations, 'en', 'projects')).toBe('Projects');
    expect(translate(translations, 'es', 'projects')).toBe('Proyectos');
  });

  it('returns the key itself for an unknown key', () => {
    expect(translate(translations, 'en', 'unknown_key')).toBe('unknown_key');
  });

  it('returns the key for an unknown language', () => {
    expect(translate(translations, 'fr', 'projects')).toBe('projects');
  });

  it('performs placeholder substitution', () => {
    expect(translate(translations, 'en', 'greeting', { name: 'Alice' })).toBe('Hello Alice!');
  });

  it('performs multiple placeholder substitutions', () => {
    expect(translate(translations, 'en', 'multi', { a: 'X', b: 'Y' })).toBe('X and Y');
  });

  it('leaves unreplaced placeholders when no matching replacement is given', () => {
    expect(translate(translations, 'en', 'greeting')).toBe('Hello {name}!');
  });
});
