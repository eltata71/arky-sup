import { describe, expect, it } from 'vitest';
import {
  getYamlScalar,
  hasYamlEntries,
  hasYamlPath,
  readYamlStructure,
  yamlTopLevelKeys,
} from '../../services/architectureOffice/yamlStructure';

describe('yamlStructure', () => {
  it('reads top-level keys and nested paths', () => {
    const tree = readYamlStructure([
      'openapi: 3.1.0',
      'info:',
      '  title: API de Siniestros',
      '  version: 1.0.0',
      'paths:',
      '  /claims:',
      '    get:',
      '      summary: Lista siniestros',
    ].join('\n'));

    expect(yamlTopLevelKeys(tree)).toEqual(['openapi', 'info', 'paths']);
    expect(getYamlScalar(tree, 'openapi')).toBe('3.1.0');
    expect(getYamlScalar(tree, 'info.title')).toBe('API de Siniestros');
    expect(hasYamlPath(tree, 'paths./claims.get')).toBe(true);
    expect(hasYamlEntries(tree, 'paths')).toBe(true);
  });

  it('does not confuse a nested key with a top-level one — the whole point', () => {
    const tree = readYamlStructure([
      'info:',
      '  description: este documento define paths y channels',
      '  paths: no es la clave raíz',
    ].join('\n'));

    // `content.includes('paths:')` matched both of these. Structure does not.
    expect(hasYamlPath(tree, 'paths')).toBe(false);
    expect(hasYamlPath(tree, 'info.paths')).toBe(true);
  });

  it('distinguishes a declared-but-empty mapping from a populated one', () => {
    const tree = readYamlStructure(['paths:', 'components:', '  schemas:', '    Claim:'].join('\n'));
    expect(hasYamlPath(tree, 'paths')).toBe(true);
    expect(hasYamlEntries(tree, 'paths')).toBe(false);
    expect(hasYamlEntries(tree, 'components.schemas')).toBe(true);
  });

  it('ignores comments but keeps a quoted hash', () => {
    const tree = readYamlStructure([
      'openapi: 3.1.0  # versión soportada',
      '# paths: comentado, no cuenta',
      'title: "color #ff0000"',
    ].join('\n'));

    expect(getYamlScalar(tree, 'openapi')).toBe('3.1.0');
    expect(hasYamlPath(tree, 'paths')).toBe(false);
    expect(getYamlScalar(tree, 'title')).toBe('color #ff0000');
  });

  it('unquotes scalars and keys', () => {
    const tree = readYamlStructure(['"openapi": \'3.1.0\''].join('\n'));
    expect(getYamlScalar(tree, 'openapi')).toBe('3.1.0');
  });

  it('skips sequence entries without losing the mapping around them', () => {
    const tree = readYamlStructure([
      'servers:',
      '  - url: https://api.example.com',
      'paths:',
      '  /claims: {}',
    ].join('\n'));
    expect(hasYamlPath(tree, 'servers')).toBe(true);
    expect(hasYamlEntries(tree, 'paths')).toBe(true);
  });

  it('degrades to a partial tree instead of throwing on malformed input', () => {
    expect(() => readYamlStructure(':::\n\t\tbroken')).not.toThrow();
    expect(yamlTopLevelKeys(readYamlStructure(''))).toEqual([]);
    expect(yamlTopLevelKeys(readYamlStructure('   '))).toEqual([]);
  });

  it('treats tabs as indentation rather than breaking the tree', () => {
    const tree = readYamlStructure('info:\n\ttitle: X');
    expect(getYamlScalar(tree, 'info.title')).toBe('X');
  });
});
