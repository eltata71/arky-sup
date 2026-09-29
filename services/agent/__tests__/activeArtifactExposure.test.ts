/**
 * Cuánto ve el modelo del artefacto que puede reescribir (plan de calidad de
 * artefactos, 7.1b): entero, o su índice y su comienzo — nunca un recorte a
 * ciegas bajo una herramienta que pide el contenido completo.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_REWRITE_CONTENT_CAP,
  artifactFitsWholeRewrite,
  describeActiveArtifactContent,
  describeRewriteRefusal,
} from '../activeArtifactExposure';

describe('artifactFitsWholeRewrite', () => {
  it('fits what can be shown whole, and nothing when no artifact is open', () => {
    expect(artifactFitsWholeRewrite({ content: 'x'.repeat(ARTIFACT_REWRITE_CONTENT_CAP) })).toBe(true);
    expect(artifactFitsWholeRewrite({ content: 'x'.repeat(ARTIFACT_REWRITE_CONTENT_CAP + 1) })).toBe(false);
    expect(artifactFitsWholeRewrite(null)).toBe(false);
  });
});

describe('describeActiveArtifactContent', () => {
  it('shows the whole artifact, fenced as external content', () => {
    const block = describeActiveArtifactContent('# Título\n\nCuerpo.\n\n## Final\nÚltima línea.', { excerptCap: 10 });
    expect(block).toContain('Última línea.');
    expect(block).toContain('<<<CONTENIDO_EXTERNO artefacto activo');
    expect(block).toContain('devuélvelo ENTERO');
  });

  it('shows the outline and the beginning of what does not fit, and forbids the rewrite', () => {
    const content = `# Título\n${'a'.repeat(200)}\n## Riesgos\n## Final\nÚltima línea.`;
    const block = describeActiveArtifactContent(content, { excerptCap: 50, rewriteCap: 100 });
    expect(block).toContain('- riesgos');
    expect(block).toContain('- final');
    expect(block).toContain('No uses modifyArtifact');
    expect(block).not.toContain('Última línea.');
  });

  it('says nothing about an empty artifact', () => {
    expect(describeActiveArtifactContent('   ', { excerptCap: 50 })).toBe('');
  });
});

describe('describeRewriteRefusal', () => {
  it('names the size, the limit and what to do instead', () => {
    expect(describeRewriteRefusal(50_000, 40_000)).toMatch(/50000.*40000.*sección concreta/);
  });
});
