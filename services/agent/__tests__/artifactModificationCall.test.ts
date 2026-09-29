/**
 * What a `modifyArtifact` call means (F5-02). These guardrails lived in
 * `AssistantPanel` and could only be exercised by rendering it.
 */
import { describe, expect, it } from 'vitest';
import { interpretArtifactModification, MODIFICATION_NOTES } from '../artifactModificationCall';

const open = { content: '# Contexto\n\nTexto actual.', representation: 'document' as const };
const call = (args: Record<string, unknown>) => ({ name: 'modifyArtifact', args });

describe('interpretArtifactModification', () => {
  it('ignores turns without a call, and calls to other tools', () => {
    expect(interpretArtifactModification(undefined, open)).toEqual({ kind: 'none' });
    expect(interpretArtifactModification({ name: 'otherTool', args: {} }, open)).toEqual({ kind: 'none' });
  });

  it('with nothing open, it is a recommendation, never a completed action', () => {
    const result = interpretArtifactModification(call({ newContent: 'x', target: 'current' }), null);
    expect(result.kind).toBe('not-applied');
    expect(result.kind === 'not-applied' && result.note).toMatch(/abre el artefacto/);
  });

  it('never declares success for empty content', () => {
    const result = interpretArtifactModification(call({ newContent: '   ', target: 'current' }), open);
    expect(result.kind === 'not-applied' && result.note).toMatch(/no devolvió contenido válido/);
  });

  it('never declares success for content identical to what is on disk', () => {
    const result = interpretArtifactModification(call({ newContent: `  ${open.content}  `, target: 'current' }), open);
    expect(result.kind === 'not-applied' && result.note).toMatch(/mismo contenido/);
  });

  it('routes a real change to its target, trimmed', () => {
    const changed = '# Contexto\n\nNuevo';
    expect(interpretArtifactModification(call({ newContent: ` ${changed} `, target: 'current' }), open))
      .toEqual({ kind: 'update-current', content: changed });
    expect(interpretArtifactModification(call({ newContent: changed, target: 'new_version' }), open))
      .toEqual({ kind: 'new-version', content: changed });
  });

  describe('content preservation (plan de calidad de artefactos, 7.1a)', () => {
    const long = {
      representation: 'document' as const,
      content: [
        '# Plan de recuperación',
        '## Resumen Ejecutivo',
        'Texto del resumen. '.repeat(20),
        '## Riesgos',
        '| ID | Riesgo |',
        '| --- | --- |',
        '| R1 | Pérdida del centro de datos |',
        '| R2 | Corrupción de la base |',
        '## Próximos Pasos',
        'Pasos concretos. '.repeat(20),
      ].join('\n'),
    };

    it('refuses a rewrite that drops a section the person did not ask to remove', () => {
      const gutted = long.content.replace(/## Riesgos[\s\S]*?(?=## Próximos Pasos)/, '');
      const result = interpretArtifactModification(call({ newContent: gutted, target: 'current' }), long, 'mejora la redacción');
      expect(result.kind).toBe('not-applied');
      expect(result.kind === 'not-applied' && result.note).toMatch(/no perder contenido.*riesgos/i);
    });

    it('refuses a rewrite that keeps only the beginning', () => {
      const truncated = long.content.slice(0, 200);
      const result = interpretArtifactModification(call({ newContent: truncated, target: 'current' }), long, 'añade un riesgo');
      expect(result.kind).toBe('not-applied');
    });

    it('accepts removing a section when the person asked for it', () => {
      const withoutRisks = long.content.replace(/## Riesgos[\s\S]*?(?=## Próximos Pasos)/, '');
      const result = interpretArtifactModification(
        call({ newContent: withoutRisks, target: 'current' }), long, 'Elimina la sección de riesgos',
      );
      expect(result).toEqual({ kind: 'update-current', content: withoutRisks.trim() });
    });

    it('leaves a diagram to its IR reconciliation', () => {
      const diagram = { representation: 'diagram' as const, content: 'flowchart LR\n  A-->B\n  B-->C' };
      expect(interpretArtifactModification(call({ newContent: 'flowchart LR\n  A-->B', target: 'current' }), diagram))
        .toEqual({ kind: 'update-current', content: 'flowchart LR\n  A-->B' });
    });
  });

  it('an unknown target changes nothing and says nothing', () => {
    expect(interpretArtifactModification(call({ newContent: 'Nuevo', target: 'elsewhere' }), open)).toEqual({ kind: 'none' });
  });

  it('names the version it created', () => {
    expect(MODIFICATION_NOTES.versionCreated(3)).toContain('(v3)');
  });
});
