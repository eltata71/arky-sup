import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vercel production configuration', () => {
  it('does not disable the production runtime configuration gate', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      buildCommand?: string;
    };

    expect(config.buildCommand).not.toContain('VITE_DISABLE_RUNTIME_CONFIG_GATE=true');
  });
});
