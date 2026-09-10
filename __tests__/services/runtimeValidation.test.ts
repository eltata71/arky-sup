import { describe, expect, it } from 'vitest';
import {
  validateArtifact,
  validateProject,
  validateProjects,
} from '../../services/architectureProjects/projectRuntimeValidation';

describe('services/architectureProjects/projectRuntimeValidation — artifact', () => {
  it('rejects non-objects', () => {
    expect(validateArtifact(null).value).toBeNull();
    expect(validateArtifact('string').value).toBeNull();
    expect(validateArtifact([]).value).toBeNull();
  });

  it('rejects when required fields are missing', () => {
    const result = validateArtifact({ id: 'a1' });
    expect(result.value).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('returns sanitised artifact when minimum required fields present', () => {
    const result = validateArtifact({
      id: 'a1',
      versionGroupId: 'a1',
      name: 'context',
      type: 'mermaid-c4-context',
    });
    expect(result.value).not.toBeNull();
    expect(result.value?.id).toBe('a1');
    expect(result.value?.version).toBe(1);
    expect(result.value?.content).toBe('');
    expect(result.value?.representation).toBe('document');
  });

  it('preserves valid optional fields', () => {
    const result = validateArtifact({
      id: 'a2',
      versionGroupId: 'a2',
      name: 'doc',
      type: 'markdown',
      content: '# hi',
      audience: 'executive',
      isFavorite: true,
    });
    expect(result.value?.audience).toBe('executive');
    expect(result.value?.isFavorite).toBe(true);
    expect(result.value?.content).toBe('# hi');
  });

  it('drops malformed keyConcepts entries instead of failing', () => {
    const result = validateArtifact({
      id: 'a3',
      versionGroupId: 'a3',
      name: 'doc',
      type: 'markdown',
      keyConcepts: [{ term: 'ok', definition: 'fine' }, { invalid: true }, null],
    });
    expect(result.value?.keyConcepts).toHaveLength(1);
    expect(result.value?.keyConcepts[0].term).toBe('ok');
  });
});

describe('services/architectureProjects/projectRuntimeValidation — project', () => {
  it('rejects when id is missing', () => {
    const result = validateProject({ name: 'x' });
    expect(result.value).toBeNull();
  });

  it('produces a default name when missing', () => {
    const result = validateProject({ id: 'p1' });
    expect(result.value?.name).toBe('Proyecto sin nombre');
  });

  it('drops corrupt artifacts but keeps the project envelope', () => {
    const result = validateProject({
      id: 'p1',
      name: 'demo',
      artifacts: [
        { id: 'a1', versionGroupId: 'a1', name: 'good', type: 'markdown' },
        { broken: true },
        { id: 'a3', versionGroupId: 'a3', name: 'good2', type: 'markdown' },
      ],
    });
    expect(result.value?.artifacts).toHaveLength(2);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('coerces missing projectContext into an empty array', () => {
    const result = validateProject({ id: 'p2', name: 'x', projectContext: 'not-an-array' });
    expect(result.value?.projectContext).toEqual([]);
  });
});

describe('services/architectureProjects/projectRuntimeValidation — projects (batch)', () => {
  it('drops fully corrupt projects but keeps valid ones', () => {
    const result = validateProjects([
      { id: 'p1', name: 'ok' },
      { name: 'no id — drop' },
      { id: 'p3', name: 'ok2' },
    ]);
    expect(result.value?.map(p => p.id)).toEqual(['p1', 'p3']);
  });
});
