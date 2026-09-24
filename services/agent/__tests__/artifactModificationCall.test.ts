/**
 * What a `modifyArtifact` call means (F5-02). These guardrails lived in
 * `AssistantPanel` and could only be exercised by rendering it.
 */
import { describe, expect, it } from 'vitest';
import { interpretArtifactModification, MODIFICATION_NOTES } from '../artifactModificationCall';

const open = { content: '# Contexto\n\nTexto actual.' };
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
    expect(interpretArtifactModification(call({ newContent: ' Nuevo ', target: 'current' }), open))
      .toEqual({ kind: 'update-current', content: 'Nuevo' });
    expect(interpretArtifactModification(call({ newContent: 'Nuevo', target: 'new_version' }), open))
      .toEqual({ kind: 'new-version', content: 'Nuevo' });
  });

  it('an unknown target changes nothing and says nothing', () => {
    expect(interpretArtifactModification(call({ newContent: 'Nuevo', target: 'elsewhere' }), open)).toEqual({ kind: 'none' });
  });

  it('names the version it created', () => {
    expect(MODIFICATION_NOTES.versionCreated(3)).toContain('(v3)');
  });
});
