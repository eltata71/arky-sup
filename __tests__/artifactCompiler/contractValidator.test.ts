import { describe, expect, it } from 'vitest';
import { resolveContract } from '../../services/artifactCompiler';
import { validateAgainstContract } from '../../services/artifactCompiler/validators';
import {
  makeArtifact,
  brdComplete,
  useCaseComplete,
  userStoryComplete,
  nfrComplete,
  bddComplete,
  traceabilityComplete,
  glossaryComplete,
  domainModelComplete,
  eventStormingComplete,
  placeholderDocument,
} from './fixtures';

const validate = (content: string, type: NonNullable<Parameters<typeof makeArtifact>[0]>['type']) => {
  const artifact = makeArtifact({ type, content });
  return validateAgainstContract(artifact, resolveContract(artifact.type));
};

const missingSectionCodes = (issues: { code: string }[]): number =>
  issues.filter((i) => i.code === 'CONTRACT_MISSING_SECTION').length;

describe('validateAgainstContract — empty / corrupt input', () => {
  it('flags an empty document with a critical issue', () => {
    const result = validate('', 'markdown');
    const critical = result.issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].code).toBe('CONTRACT_EMPTY');
  });

  it('flags an empty diagram artifact with a critical issue', () => {
    const artifact = makeArtifact({ type: 'react-flow-graph', representation: 'diagram', content: '' });
    const result = validateAgainstContract(artifact, resolveContract(artifact.type));
    expect(result.structure).toBeNull();
    expect(result.issues.some((i) => i.code === 'CONTRACT_DIAGRAM_EMPTY' && i.severity === 'critical')).toBe(true);
  });
});

describe('validateAgainstContract — SDD families satisfy their contracts', () => {
  it.each([
    ['sdd-brd', brdComplete],
    ['sdd-use-case', useCaseComplete],
    ['sdd-user-story', userStoryComplete],
    ['sdd-nfr', nfrComplete],
    ['sdd-bdd', bddComplete],
    ['sdd-traceability', traceabilityComplete],
    ['sdd-glossary', glossaryComplete],
    ['sdd-domain-model', domainModelComplete],
    ['sdd-event-storming', eventStormingComplete],
  ] as const)('reports no missing required sections for a complete %s', (type, content) => {
    const result = validate(content, type);
    expect(missingSectionCodes(result.issues)).toBe(0);
    expect(result.issues.some((i) => i.severity === 'critical')).toBe(false);
  });
});

describe('validateAgainstContract — SDD families detect contract gaps', () => {
  it('flags a missing required section in a BRD', () => {
    const withoutStakeholders = brdComplete.replace(/## Stakeholders[\s\S]*?(?=\n## )/, '');
    const result = validate(withoutStakeholders, 'sdd-brd');
    const issue = result.issues.find((i) => i.id === 'contract.section.stakeholders.missing');
    expect(issue).toBeDefined();
    expect(issue?.code).toBe('CONTRACT_MISSING_SECTION');
    expect(issue?.severity).toBe('high');
  });

  it('flags a BDD artifact that has no Gherkin scenarios', () => {
    const result = validate('# BDD\n\n## Escenarios\n\nTexto descriptivo sin estructura.', 'sdd-bdd');
    expect(result.issues.some((i) => i.code === 'CONTRACT_MISSING_GHERKIN')).toBe(true);
  });

  it('flags a traceability matrix without a coverage table', () => {
    const result = validate('# Matriz\n\n## Matriz de trazabilidad\n\nSin tabla todavía.', 'sdd-traceability');
    expect(result.issues.some((i) => i.code === 'CONTRACT_MISSING_TRACEABILITY')).toBe(true);
  });
});

describe('validateAgainstContract — structural findings', () => {
  it('detects unresolved TBD/TODO/FIXME placeholders', () => {
    const result = validate(placeholderDocument, 'markdown');
    const issue = result.issues.find((i) => i.code === 'CONTRACT_HARD_PLACEHOLDER');
    expect(issue).toBeDefined();
    expect(issue?.autoFixable).toBe(true);
  });

  it('detects a missing H1 title and missing headings', () => {
    const noHeadings = validate('Sólo texto plano sin ninguna estructura jerárquica visible.', 'markdown');
    expect(noHeadings.issues.some((i) => i.code === 'CONTRACT_NO_HEADINGS')).toBe(true);
    expect(noHeadings.issues.some((i) => i.code === 'CONTRACT_NO_TITLE')).toBe(true);
  });

  it('keeps diagram artifacts free of document structure findings', () => {
    const artifact = makeArtifact({
      type: 'mermaid-c4-context',
      representation: 'diagram',
      content: 'C4Context\n  Person(user, "Usuario")\n  System(sys, "Sistema")',
    });
    const result = validateAgainstContract(artifact, resolveContract(artifact.type));
    expect(result.structure).toBeNull();
    expect(result.issues).toHaveLength(0);
  });
});
