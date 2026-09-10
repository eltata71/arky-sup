import { describe, it, expect } from 'vitest';
import { detectProactiveSuggestion } from '../proactiveDetector';

describe('detectProactiveSuggestion', () => {
  it('returns null on empty or trivial responses', () => {
    expect(detectProactiveSuggestion('')).toBeNull();
    expect(detectProactiveSuggestion('Sí.')).toBeNull();
  });

  it('detects an improvement recommendation', () => {
    const suggestion = detectProactiveSuggestion(
      'En resumen, este diagrama es claro. Te recomiendo mejorar la separación de capas para reducir el acoplamiento.',
    );
    expect(suggestion).not.toBeNull();
    expect(suggestion!.intentType).toBe('artifact.improve');
    expect(suggestion!.derivedInstruction.toLowerCase()).toContain('mejor');
  });

  it('detects a regeneration recommendation', () => {
    const suggestion = detectProactiveSuggestion(
      'Dado el alcance que mencionas, te recomiendo regenerar este diagrama desde cero con esa nueva información.',
    );
    expect(suggestion).not.toBeNull();
    expect(suggestion!.intentType).toBe('artifact.regenerate');
  });

  it('detects a patch recommendation', () => {
    const suggestion = detectProactiveSuggestion(
      'Deberías cambiar el nombre del nodo "ServiceA" a "Servicio de Autenticación" para mayor claridad.',
    );
    expect(suggestion).not.toBeNull();
    expect(suggestion!.intentType).toBe('artifact.patch');
  });

  it('returns null when the response is purely informational', () => {
    expect(
      detectProactiveSuggestion(
        'Este diagrama representa la vista de contexto C4. Los actores externos están a la izquierda y el sistema a la derecha.',
      ),
    ).toBeNull();
  });

  it('prefers the highest-confidence suggestion when multiple match', () => {
    const suggestion = detectProactiveSuggestion(
      'Te recomiendo mejorar el contraste. Sin embargo, te recomiendo regenerar el diagrama por completo.',
    );
    expect(suggestion).not.toBeNull();
    expect(['artifact.regenerate', 'artifact.improve']).toContain(suggestion!.intentType);
  });
});
