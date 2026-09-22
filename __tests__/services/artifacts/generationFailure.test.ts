import { describe, expect, it } from 'vitest';
import { AIServiceError } from '../../../services/ai';
import { describeGenerationFailure } from '../../../services/artifacts/application/generationFailure';

describe('describeGenerationFailure', () => {
  it('da a cada categoría conocida su titular y conserva si se puede reintentar', () => {
    const report = describeGenerationFailure(new AIServiceError('overloaded', 503, 'busy', 'El modelo está saturado.', true));
    expect(report).toMatchObject({
      headline: 'Modelo saturado',
      userMessage: 'El modelo está saturado.',
      retryable: true,
      severity: 'warning',
      technicalDetail: 'category=overloaded; status=503; message=busy',
    });
  });

  it('informa como error lo que reintentar no arregla', () => {
    expect(describeGenerationFailure(new AIServiceError('auth', 401, 'bad key', 'Revisa la clave.', false)).severity).toBe('error');
    expect(describeGenerationFailure(new AIServiceError('invalid-request', 400, 'bad', 'Petición inválida.', false)).severity).toBe('error');
  });

  it('clasifica un error cualquiera en vez de enseñar su pila', () => {
    const report = describeGenerationFailure(new Error('socket hang up'));
    expect(report.headline).toBeTruthy();
    expect(report.userMessage).toBeTruthy();
    expect(report.technicalDetail).toContain('socket hang up');
  });
});
