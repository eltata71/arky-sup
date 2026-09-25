import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const relativeImports = (path: string): string[] => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return [...source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);
};

describe('Vercel API ESM imports', () => {
  it('uses explicit .js extensions for runtime-relative imports', () => {
    const imports = [
      ...relativeImports('../../api/ai.ts').filter((specifier) => specifier.startsWith('./')),
      ...relativeImports('../../api/_shared/authenticateProxyCaller.ts'),
      ...relativeImports('../../api/_shared/proxyRuntime.ts'),
      ...relativeImports('../../services/ai/schema/index.ts'),
    ];

    expect(imports).not.toHaveLength(0);
    expect(relativeImports('../../api/ai.ts')).toContain('../services/ai/schema/index.js');
    expect(imports.every((specifier) => specifier.endsWith('.js'))).toBe(true);
  });
});
