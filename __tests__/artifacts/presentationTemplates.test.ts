import { describe, expect, it } from 'vitest';
import { ARTIFACT_TEMPLATES } from '../../constants';
import { getArtifactKind } from '../../lib/artifacts/artifactKind';

const findTemplate = (name: string) => ARTIFACT_TEMPLATES.find(t => t.name === name);

describe('Artifact templates — presentation classification', () => {
  it('classifies "Presentación Ejecutiva" as a presentation deck', () => {
    const template = findTemplate('Presentación Ejecutiva');
    expect(template).toBeDefined();
    expect(template!.type).toBe('presentation-executive');
    expect(template!.artifactKind).toBe('presentation');
    expect(template!.outputFormat).toBe('deck');
    expect(template!.preferredExports).toContain('pptx');
    expect(getArtifactKind(template!.type)).toBe('presentation');
  });

  it('classifies "Presentación Técnica" as a presentation deck', () => {
    const template = findTemplate('Presentación Técnica');
    expect(template).toBeDefined();
    expect(template!.type).toBe('presentation-technical');
    expect(template!.artifactKind).toBe('presentation');
    expect(template!.outputFormat).toBe('deck');
    expect(template!.preferredExports).toContain('pptx');
    expect(getArtifactKind(template!.type)).toBe('presentation');
  });

  it('reclassifies "Resumen Ejecutivo" as a presentation deck (was markdown)', () => {
    const template = findTemplate('Resumen Ejecutivo');
    expect(template).toBeDefined();
    expect(template!.type).toBe('presentation-summary');
    expect(template!.artifactKind).toBe('presentation');
    expect(template!.outputFormat).toBe('deck');
    expect(template!.preferredExports).toContain('pptx');
    expect(getArtifactKind(template!.type)).toBe('presentation');
  });

  it('reclassifies "Resumen de Arquitectura" as a presentation deck (was hybrid)', () => {
    const template = findTemplate('Resumen de Arquitectura');
    expect(template).toBeDefined();
    expect(template!.type).toBe('presentation-overview');
    expect(template!.artifactKind).toBe('presentation');
    expect(template!.outputFormat).toBe('deck');
    expect(template!.preferredExports).toContain('pptx');
    expect(getArtifactKind(template!.type)).toBe('presentation');
  });

  it('keeps "Informe de Revisión de Arquitectura" as a formal document', () => {
    const template = findTemplate('Informe de Revisión de Arquitectura');
    expect(template).toBeDefined();
    expect(template!.type).toBe('markdown');
    expect(getArtifactKind(template!.type)).toBe('document');
    // Should NOT have a presentation artifactKind override
    expect(template!.artifactKind ?? 'document').toBe('document');
  });

  it('keeps "README del Proyecto" as a markdown document', () => {
    const template = findTemplate('README del Proyecto');
    expect(template).toBeDefined();
    expect(template!.type).toBe('markdown');
    expect(getArtifactKind(template!.type)).toBe('document');
    expect(template!.artifactKind ?? 'document').toBe('document');
  });
});
