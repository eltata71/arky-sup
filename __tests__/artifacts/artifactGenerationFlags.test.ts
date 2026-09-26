import { describe, expect, it } from 'vitest';
import {
  getArtifactGenerationFeatureFlags,
  __test__parseArtifactGenerationFlag as parseFlag,
} from '../../services/artifacts/domain/artifactGenerationFlags';

describe('artifactGenerationFlags', () => {
  it('interpreta valores habilitados', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'enabled', 'TRUE']) {
      expect(parseFlag(value, false)).toBe(true);
    }
  });

  it('interpreta valores deshabilitados', () => {
    for (const value of ['0', 'false', 'no', 'off', 'disabled', 'FALSE']) {
      expect(parseFlag(value, true)).toBe(false);
    }
  });

  it('cae al valor por defecto ante entradas vacías o desconocidas', () => {
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag(undefined, false)).toBe(false);
    expect(parseFlag('', true)).toBe(true);
    expect(parseFlag('quizas', false)).toBe(false);
  });

  it('#29 los valores por defecto preservan el flujo legacy de forma segura', () => {
    const flags = getArtifactGenerationFeatureFlags();
    // El brief estructurado y el Top 3 vienen habilitados por defecto; la
    // extracción IA permanece detrás de feature flag (apagada por defecto), de
    // modo que el flujo legacy nunca depende de una llamada IA obligatoria.
    expect(typeof flags.structuredBrief).toBe('boolean');
    expect(typeof flags.top3Recommendations).toBe('boolean');
    expect(flags.aiBriefExtraction).toBe(false);
  });
});
