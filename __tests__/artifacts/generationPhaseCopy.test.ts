import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATION_PHASE_COPY, GENERATION_STATUS_COPY } from '../../lib/artifacts/generationPhaseCopy';

describe('vocabulario de generación', () => {
  it('nombra todas las fases en español con una explicación y un icono', () => {
    expect(Object.keys(GENERATION_PHASE_COPY)).toHaveLength(12);
    for (const copy of Object.values(GENERATION_PHASE_COPY)) {
      expect(copy.label.trim()).not.toBe('');
      expect(copy.description.trim()).not.toBe('');
      expect(copy.icon.trim()).not.toBe('');
      expect(`${copy.label} ${copy.description}`).not.toMatch(/\b(?:parsing|fallback|quality gate|prompt|render)\b/i);
    }
    expect(GENERATION_STATUS_COPY['in-progress']).toBe('En curso');
  });

  it('impide otro mapa de etiquetas de estas fases fuera del catálogo', () => {
    const roots = ['components', 'pages', 'hooks', 'services', 'lib'];
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
    for (const root of roots) {
      for (const file of files(resolve(process.cwd(), root))) {
        if (file.endsWith('/lib/artifacts/generationPhaseCopy.ts')) continue;
        const source = readFileSync(file, 'utf8');
        expect(source, file).not.toMatch(/\bSTAGE_LABELS\b|Record<ArtifactGenerationStage\s*,/);
      }
    }
  });
});
