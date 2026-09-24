/**
 * Specs for the module size budget.
 *
 * The rule "do not grow `geminiService.ts` / `AppContext.tsx` /
 * `ArtifactCanvas.tsx`" has been written in CLAUDE.md for a long time with
 * nothing enforcing it — which is precisely how those files reached 6.300,
 * 920 and 1.230 lines. Nobody added a thousand lines; everyone added forty.
 */

import { describe, expect, it } from 'vitest';
import {
  BYTE_CEILINGS,
  CEILINGS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  byteCount,
  lineCount,
  scan,
  sourceFiles,
} from '../../scripts/checkModuleSize.mjs';

describe('the budget holds today', () => {
  it('reports nothing over its ceiling', () => {
    const { overBudget } = scan();
    expect(overBudget.map((entry: { file: string }) => entry.file)).toEqual([]);
  });

  it('reports nothing over its weight', () => {
    const { overWeight } = scan();
    expect(overWeight.map((entry: { file: string }) => entry.file)).toEqual([]);
  });
});

describe('a line budget is a budget on newlines', () => {
  // The case this half exists for: the `en`/`es` dictionary that lived inside
  // `context/AppContext.tsx` was 17 lines and 20 KB — over half the file by
  // weight and invisible to every check the repository had. It is `lib/i18n/`
  // now, and the assertions below are what keeps it from coming back inline.

  it('measures bytes as well as lines', () => {
    expect(byteCount('lib/i18n/translations.ts')).toBeGreaterThan(15_000);
    // Under 40 lines, so no line budget would ever have seen it.
    expect(lineCount('lib/i18n/translations.ts')).toBeLessThan(40);
  });

  it('holds unlisted modules to 20 KB', () => {
    expect(DEFAULT_MAX_BYTES).toBe(20_000);
  });

  it('would refuse the dictionary going back into a provider', () => {
    // `AppContext` is composition now: small in lines and small in bytes. Its
    // weight plus the dictionary's exceeds the default, which is exactly the
    // failure the guard is for.
    const provider = byteCount('context/AppContext.tsx');
    const dictionary = byteCount('lib/i18n/translations.ts');
    expect(provider).toBeLessThan(DEFAULT_MAX_BYTES);
    expect(provider + dictionary).toBeGreaterThan(DEFAULT_MAX_BYTES);
  });

  it('records a weight for every file heavier than the default', () => {
    // Same monotonic rule as the lines: a recorded number may fall, never rise,
    // and a file not listed is held to the default.
    for (const file of sourceFiles() as string[]) {
      const bytes = byteCount(file);
      if (bytes <= DEFAULT_MAX_BYTES) continue;
      expect(BYTE_CEILINGS, `${file} weighs ${bytes} bytes and has no recorded weight`)
        .toHaveProperty(file);
    }
  });

  it('records no weight below the default, which would be headroom', () => {
    for (const [file, ceiling] of Object.entries(BYTE_CEILINGS) as [string, number][]) {
      expect(ceiling, `${file} does not need a recorded weight`).toBeGreaterThan(DEFAULT_MAX_BYTES);
    }
  });
});

describe('the ceilings are records, not aspirations', () => {
  it('every recorded ceiling names a file that exists and is genuinely large', () => {
    // A stale entry is worse than none: it reserves headroom for a file that
    // no longer needs it, and nothing would notice.
    for (const [file, ceiling] of Object.entries(CEILINGS) as [string, number][]) {
      expect(sourceFiles(), `${file} is recorded but not in the scanned tree`).toContain(file);
      expect(ceiling, `${file} does not need an exception`).toBeGreaterThan(DEFAULT_MAX_LINES);
    }
  });

  it('sits close to the real size, so it cannot absorb quiet growth', () => {
    for (const [file, ceiling] of Object.entries(CEILINGS) as [string, number][]) {
      const slack = ceiling - lineCount(file);
      expect(slack, `${file} has ${slack} lines of unused headroom`).toBeLessThanOrEqual(40);
    }
  });

  it('covers the modules CLAUDE.md names explicitly', () => {
    // `context/AppContext.tsx` was the third name here until Wave 4 split it
    // into `context/app/`. It is under the default now, so a recorded ceiling
    // would be headroom rather than a record — which the assertion above
    // rejects. An entry leaving this table is the intended end state.
    for (const file of ['services/ai/generation/artifacts/artifactGenerationEngine.ts', 'components/ArtifactCanvas.tsx']) {
      expect(CEILINGS).toHaveProperty(file);
    }
  });

  it('holds AppContext to the ordinary default now that it is composition', () => {
    expect(CEILINGS).not.toHaveProperty('context/AppContext.tsx');
    expect(lineCount('context/AppContext.tsx')).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
  });
});

describe('the default applies to everything else', () => {
  it('is the size a module is expected to stay under', () => {
    expect(DEFAULT_MAX_LINES).toBe(500);
  });

  it('governs any file without a recorded exception', () => {
    const unlisted = sourceFiles().filter((file: string) => !(file in CEILINGS));
    const offenders = unlisted.filter((file: string) => lineCount(file) > DEFAULT_MAX_LINES);
    expect(offenders).toEqual([]);
  });
});
