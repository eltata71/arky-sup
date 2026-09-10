/**
 * The two languages say the same things.
 *
 * A key present in `en` and missing from `es` does not fail anything: the
 * lookup returns the key, so a Spanish user sees `docCreatedSuccess` in the
 * middle of a toast. That is the failure this file exists to catch, and it is
 * exactly the kind that survives review — nobody reads an 18 KB object literal
 * looking for a hole.
 *
 * Parity holds today at 168 keys each. The assertions below are on the *sets*
 * rather than on a count, so adding a pair of keys passes and adding one does
 * not.
 */
import { describe, expect, it } from 'vitest';
import { translations } from '../../../lib/i18n';

const LANGUAGES = ['en', 'es'] as const;

describe('the dictionary', () => {
  it('carries the two languages `Settings.language` can select', () => {
    expect(Object.keys(translations).sort()).toEqual([...LANGUAGES]);
  });

  it('defines the same keys in both', () => {
    const en = Object.keys(translations.en).sort();
    const es = Object.keys(translations.es).sort();
    expect(es).toEqual(en);
  });

  it.each(LANGUAGES)('leaves no %s entry blank', (language) => {
    const blanks = Object.entries(translations[language])
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    // A blank is worse than a missing key: the lookup treats `''` as falsy and
    // falls back to the key anyway, so it is a hole that looks filled.
    expect(blanks).toEqual([]);
  });

  it('keeps the same placeholders on both sides of a key', () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
    for (const key of Object.keys(translations.en)) {
      expect(
        placeholders(translations.es[key]),
        `${key} does not substitute the same values in both languages`,
      ).toEqual(placeholders(translations.en[key]));
    }
  });
});
