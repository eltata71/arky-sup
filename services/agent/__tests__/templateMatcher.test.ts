import { describe, it, expect } from 'vitest';
import { matchTemplateFromInstruction, buildCustomTemplate } from '../templateMatcher';

describe('matchTemplateFromInstruction', () => {
  it('returns null for empty or unmappable instructions', () => {
    expect(matchTemplateFromInstruction('')).toBeNull();
    expect(matchTemplateFromInstruction('   ')).toBeNull();
    // A single stopword string is filtered out by the tokeniser.
    expect(matchTemplateFromInstruction('crea un')).toBeNull();
  });

  it('matches the C4-N1 context template when the user references "diagrama de contexto"', () => {
    const result = matchTemplateFromInstruction('Crea un diagrama de contexto C4 para el sistema');
    expect(result).not.toBeNull();
    expect(result!.template.name).toContain('Contexto');
    expect(result!.confidence).toBeGreaterThan(0.4);
  });

  it('uses type hints to boost the right template even when the name is partial', () => {
    const result = matchTemplateFromInstruction('Necesito un diagrama BPMN para el proceso de cotización');
    expect(result).not.toBeNull();
    // The BPMN hint should route to a hybrid-text-diagram template.
    expect(result!.template.type).toBe('hybrid-text-diagram');
  });

  it('matches the executive summary template for "resumen ejecutivo"', () => {
    const result = matchTemplateFromInstruction('Genera un resumen ejecutivo para el directorio');
    expect(result).not.toBeNull();
    expect(result!.template.name).toMatch(/Resumen Ejecutivo/i);
  });
});

describe('buildCustomTemplate', () => {
  it('falls back to markdown when no diagram keyword is present', () => {
    const template = buildCustomTemplate('Documento de evaluación de proveedor');
    expect(template.type).toBe('markdown');
    expect(template.representation).toBe('document');
    expect(template.requestContext?.userRequest).toContain('Documento de evaluación');
  });

  it('produces a diagram template when the instruction mentions diagram-ish keywords', () => {
    const template = buildCustomTemplate('Diagrama de flujo de aprobación de pagos');
    expect(template.representation).toBe('diagram');
    expect(template.type).toMatch(/^mermaid/);
  });

  it('always carries a requestContext so the generation pipeline gets the rationale', () => {
    const template = buildCustomTemplate('Algo a medida');
    expect(template.requestContext).toBeDefined();
    expect(template.requestContext!.userRequest).toBe('Algo a medida');
    expect(template.requestContext!.audience).toBe('mixed');
  });
});
