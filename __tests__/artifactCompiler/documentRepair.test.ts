import { describe, expect, it } from 'vitest';
import { resolveContract } from '../../services/artifactCompiler';
import { validateAgainstContract } from '../../services/artifactCompiler/validators';
import { repairAgainstContract } from '../../services/artifactCompiler/repair';
import { makeArtifact, placeholderDocument } from './fixtures';

const repair = (content: string, type: NonNullable<Parameters<typeof makeArtifact>[0]>['type']) => {
  const artifact = makeArtifact({ type, content });
  const contract = resolveContract(artifact.type);
  const validation = validateAgainstContract(artifact, contract);
  return repairAgainstContract({ content, contract, validation, artifactName: artifact.name });
};

describe('repairAgainstContract — non-destructive guarantees', () => {
  it('normalises hard placeholders without deleting user content', () => {
    const outcome = repair(placeholderDocument, 'markdown');
    expect(outcome.repairs.some((r) => r.id === 'repair.placeholders')).toBe(true);
    expect(outcome.content).not.toMatch(/\bTODO\b/);
    expect(outcome.content).not.toMatch(/\bFIXME\b/);
    expect(outcome.content).toContain('_Pendiente de completar_');
    // User-authored sentences survive verbatim.
    expect(outcome.content).toContain('El sistema actual concentra el riesgo operativo');
    expect(outcome.repairs.every((r) => r.destructive === false)).toBe(true);
  });

  it('adds a missing H1 title using the artifact name', () => {
    const outcome = repair('## Objetivo\n\nContenido inicial del documento.', 'markdown');
    expect(outcome.repairs.some((r) => r.id === 'repair.title')).toBe(true);
    expect(outcome.content.startsWith('# ')).toBe(true);
    expect(outcome.content).toContain('## Objetivo');
  });

  it('scaffolds missing required sections only when the contract allows it', () => {
    const outcome = repair(
      '# BRD\n\n## Objetivo de negocio\n\nIncrementar la conversión del checkout.',
      'sdd-brd',
    );
    expect(outcome.repairs.some((r) => r.id === 'repair.sections')).toBe(true);
    expect(outcome.content).toContain('## Stakeholders');
    expect(outcome.content).toContain('## Requerimientos funcionales');
    // The original objective text is preserved.
    expect(outcome.content).toContain('Incrementar la conversión del checkout.');
  });

  it('repairs malformed list bullets', () => {
    const outcome = repair('# Lista\n\n## Objetivo\n\n-primer punto\n-segundo punto', 'markdown');
    expect(outcome.repairs.some((r) => r.id === 'repair.lists')).toBe(true);
    expect(outcome.content).toContain('- primer punto');
  });

  it('never repairs diagram artifacts', () => {
    const artifact = makeArtifact({
      type: 'mermaid-graph',
      representation: 'diagram',
      content: 'graph TD\n  A-->B',
    });
    const contract = resolveContract(artifact.type);
    const validation = validateAgainstContract(artifact, contract);
    const outcome = repairAgainstContract({
      content: artifact.content,
      contract,
      validation,
      artifactName: artifact.name,
    });
    expect(outcome.repairs).toHaveLength(0);
    expect(outcome.content).toBe(artifact.content);
  });

  it('never repairs empty content', () => {
    const outcome = repair('', 'markdown');
    expect(outcome.repairs).toHaveLength(0);
    expect(outcome.content).toBe('');
  });
});
