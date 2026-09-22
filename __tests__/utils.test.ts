import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanJsonString,
  getLatestArtifacts,
  groupArtifactsByView,
  findLatestArtifactByName,
  toggleInArray,
  getFileIcon,
  MemoryCache,
} from '../utils';
import {
  buildGlobalPrompt,
  buildBasePrompt,
  buildArtifactsContext,
  buildSiblingDiagramsPromptBlock,
} from '../services/ai/prompts/projectPrompts';
import { Artifact, Settings, Project } from '../types';

// --- Test Helpers ---

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_1',
    versionGroupId: 'vg_1',
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    name: 'Test Artifact',
    type: 'markdown',
    phase: 'Design',
    architecturalView: 'Vista Lógica y de Diseño',
    content: '# Test',
    objective: 'Test objective',
    keyConcepts: [],
    representation: 'document',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    globalContext: ['Use AWS', 'Prefer serverless'],
    language: 'en',
    theme: 'dark',
    aiConfig: {
      model: 'gemini-3-flash-preview',
      temperature: 0.7,
      tone: 'Professional',
      languageStyle: 'Concise',
      apiKeySource: 'global',
    },
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_1',
    name: 'Test Project',
    description: 'A test project',
    projectContext: ['Context note 1'],
    artifacts: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// =====================================================
// cleanJsonString
// =====================================================

describe('cleanJsonString', () => {
  it('returns "{}" for empty string', () => {
    expect(cleanJsonString('')).toBe('{}');
  });

  it('returns "{}" for null/undefined input', () => {
    expect(cleanJsonString(null as unknown as string)).toBe('{}');
    expect(cleanJsonString(undefined as unknown as string)).toBe('{}');
  });

  it('extracts a simple JSON object', () => {
    expect(cleanJsonString('{"key": "value"}')).toBe('{"key": "value"}');
  });

  it('extracts a JSON array', () => {
    expect(cleanJsonString('[1, 2, 3]')).toBe('[1, 2, 3]');
  });

  it('strips markdown code fences around JSON', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(cleanJsonString(input)).toBe('{"key": "value"}');
  });

  it('strips preamble text before JSON', () => {
    const input = 'Here is the result:\n\n{"key": "value"}';
    expect(cleanJsonString(input)).toBe('{"key": "value"}');
  });

  it('strips trailing text after JSON', () => {
    const input = '{"key": "value"}\n\nHope this helps!';
    expect(cleanJsonString(input)).toBe('{"key": "value"}');
  });

  it('handles nested braces correctly', () => {
    const input = '{"outer": {"inner": "value"}}';
    expect(cleanJsonString(input)).toBe('{"outer": {"inner": "value"}}');
  });

  it('handles array with nested objects', () => {
    const input = '[{"a": 1}, {"b": 2}]';
    expect(cleanJsonString(input)).toBe('[{"a": 1}, {"b": 2}]');
  });

  it('prefers object when { appears before [', () => {
    const input = '{"items": [1, 2]}';
    const result = cleanJsonString(input);
    expect(result).toBe('{"items": [1, 2]}');
  });

  it('prefers array when [ appears before {', () => {
    const input = '[{"a": 1}]';
    const result = cleanJsonString(input);
    expect(result).toBe('[{"a": 1}]');
  });

  it('handles text with no JSON delimiters', () => {
    const input = 'no json here';
    // Should return the text trimmed (no extraction possible)
    expect(cleanJsonString(input)).toBe('no json here');
  });

  it('handles markdown fences without json specifier', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(cleanJsonString(input)).toBe('{"key": "value"}');
  });
});

// =====================================================
// buildGlobalPrompt
// =====================================================

describe('buildGlobalPrompt', () => {
  it('includes global context items', () => {
    const settings = makeSettings({ globalContext: ['Standard A', 'Standard B'] });
    const result = buildGlobalPrompt(settings);
    expect(result).toContain('- Standard A');
    expect(result).toContain('- Standard B');
  });

  it('uses the configured tone', () => {
    const settings = makeSettings();
    settings.aiConfig.tone = 'Casual';
    const result = buildGlobalPrompt(settings);
    expect(result).toContain('Tone: Casual');
  });

  it('defaults tone when not set', () => {
    const settings = makeSettings();
    settings.aiConfig.tone = '';
    const result = buildGlobalPrompt(settings);
    expect(result).toContain('Tone: Profesional y Técnico');
  });

  it('outputs English language instruction for en', () => {
    const settings = makeSettings({ language: 'en' });
    const result = buildGlobalPrompt(settings);
    expect(result).toContain('Language: English');
  });

  it('outputs Spanish language instruction for es', () => {
    const settings = makeSettings({ language: 'es' });
    const result = buildGlobalPrompt(settings);
    expect(result).toContain('Language: Spanish (Español)');
  });

  it('includes insurance industry context', () => {
    const settings = makeSettings();
    const result = buildGlobalPrompt(settings);
    expect(result).toContain('Insurance Company');
    expect(result).toContain('Life and Health');
  });
});

// =====================================================
// buildBasePrompt
// =====================================================

describe('buildBasePrompt', () => {
  it('includes project name and description', () => {
    const project = makeProject({ name: 'My Project', description: 'A cool project' });
    const settings = makeSettings();
    const result = buildBasePrompt(project, settings);
    expect(result).toContain('Project Name: My Project');
    expect(result).toContain('Project Description: A cool project');
  });

  it('includes project-specific context', () => {
    const project = makeProject({ projectContext: ['Use DynamoDB', 'Team of 5'] });
    const settings = makeSettings();
    const result = buildBasePrompt(project, settings);
    expect(result).toContain('- Use DynamoDB');
    expect(result).toContain('- Team of 5');
  });

  it('includes global prompt content', () => {
    const project = makeProject();
    const settings = makeSettings({ globalContext: ['Standard X'] });
    const result = buildBasePrompt(project, settings);
    expect(result).toContain('- Standard X');
  });
});

// =====================================================
// buildArtifactsContext
// =====================================================

describe('buildArtifactsContext', () => {
  it('returns empty message for project with no artifacts', () => {
    const project = makeProject({ artifacts: [] });
    const result = buildArtifactsContext(project);
    expect(result).toContain('no artifacts');
  });

  it('lists artifact names and types', () => {
    const artifacts = [
      makeArtifact({ name: 'C4 Diagram', type: 'mermaid-c4-context', objective: 'Show context' }),
    ];
    const project = makeProject({ artifacts });
    const result = buildArtifactsContext(project);
    expect(result).toContain('"C4 Diagram"');
    expect(result).toContain('mermaid-c4-context');
    expect(result).toContain('Show context');
  });

  it('only includes latest version of each artifact', () => {
    const artifacts = [
      makeArtifact({ id: 'a1', versionGroupId: 'vg1', version: 1, name: 'ERD' }),
      makeArtifact({ id: 'a2', versionGroupId: 'vg1', version: 2, name: 'ERD' }),
      makeArtifact({ id: 'a3', versionGroupId: 'vg2', version: 1, name: 'Sequence' }),
    ];
    const project = makeProject({ artifacts });
    const result = buildArtifactsContext(project);
    // Should have ERD and Sequence, but only once each
    const erdMatches = result.match(/"ERD"/g);
    expect(erdMatches).toHaveLength(1);
    expect(result).toContain('"Sequence"');
  });
});

// =====================================================
// getLatestArtifacts
// =====================================================

describe('getLatestArtifacts', () => {
  it('returns empty array for empty input', () => {
    expect(getLatestArtifacts([])).toEqual([]);
  });

  it('returns single artifact unchanged', () => {
    const a = makeArtifact();
    expect(getLatestArtifacts([a])).toEqual([a]);
  });

  it('keeps only the highest version per versionGroupId', () => {
    const v1 = makeArtifact({ id: 'a1', versionGroupId: 'vg1', version: 1 });
    const v2 = makeArtifact({ id: 'a2', versionGroupId: 'vg1', version: 2 });
    const v3 = makeArtifact({ id: 'a3', versionGroupId: 'vg1', version: 3 });
    const result = getLatestArtifacts([v1, v3, v2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a3');
  });

  it('handles multiple groups', () => {
    const a1 = makeArtifact({ id: 'a1', versionGroupId: 'vg1', version: 2 });
    const a2 = makeArtifact({ id: 'a2', versionGroupId: 'vg1', version: 1 });
    const b1 = makeArtifact({ id: 'b1', versionGroupId: 'vg2', version: 1 });
    const result = getLatestArtifacts([a1, a2, b1]);
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.id).sort();
    expect(ids).toEqual(['a1', 'b1']);
  });
});

// =====================================================
// groupArtifactsByView
// =====================================================

describe('groupArtifactsByView', () => {
  it('returns empty object for empty array', () => {
    expect(groupArtifactsByView([])).toEqual({});
  });

  it('groups artifacts by architecturalView', () => {
    const a1 = makeArtifact({ id: 'a1', versionGroupId: 'vg1', architecturalView: 'Vista de Datos' });
    const a2 = makeArtifact({ id: 'a2', versionGroupId: 'vg2', architecturalView: 'Vista de Datos' });
    const a3 = makeArtifact({ id: 'a3', versionGroupId: 'vg3', architecturalView: 'Vista Lógica y de Diseño' });
    const result = groupArtifactsByView([a1, a2, a3]);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['Vista de Datos']).toHaveLength(2);
    expect(result['Vista Lógica y de Diseño']).toHaveLength(1);
  });

  it('only groups latest versions', () => {
    const v1 = makeArtifact({ id: 'a1', versionGroupId: 'vg1', version: 1, architecturalView: 'Vista de Datos' });
    const v2 = makeArtifact({ id: 'a2', versionGroupId: 'vg1', version: 2, architecturalView: 'Vista de Datos' });
    const result = groupArtifactsByView([v1, v2]);
    expect(result['Vista de Datos']).toHaveLength(1);
    expect(result['Vista de Datos'][0].id).toBe('a2');
  });

  it('handles non-array input gracefully', () => {
    expect(groupArtifactsByView(null as unknown as Artifact[])).toEqual({});
  });
});

// =====================================================
// findLatestArtifactByName
// =====================================================

describe('findLatestArtifactByName', () => {
  it('returns undefined for empty array', () => {
    expect(findLatestArtifactByName([], 'Test')).toBeUndefined();
  });

  it('returns undefined when name does not match', () => {
    const a = makeArtifact({ name: 'Other' });
    expect(findLatestArtifactByName([a], 'Test')).toBeUndefined();
  });

  it('returns the artifact when there is one match', () => {
    const a = makeArtifact({ name: 'ERD' });
    expect(findLatestArtifactByName([a], 'ERD')).toBe(a);
  });

  it('returns the latest version when multiple versions exist', () => {
    const v1 = makeArtifact({ id: 'a1', name: 'ERD', version: 1 });
    const v2 = makeArtifact({ id: 'a2', name: 'ERD', version: 3 });
    const v3 = makeArtifact({ id: 'a3', name: 'ERD', version: 2 });
    const result = findLatestArtifactByName([v1, v2, v3], 'ERD');
    expect(result?.id).toBe('a2');
  });

  it('does not match partial names', () => {
    const a = makeArtifact({ name: 'ERD Diagram' });
    expect(findLatestArtifactByName([a], 'ERD')).toBeUndefined();
  });
});

// =====================================================
// toggleInArray
// =====================================================

describe('toggleInArray', () => {
  it('adds item when not present', () => {
    expect(toggleInArray([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it('removes item when present', () => {
    expect(toggleInArray([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it('works with strings', () => {
    expect(toggleInArray(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleInArray(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('works with empty array (always adds)', () => {
    expect(toggleInArray([], 'x')).toEqual(['x']);
  });

  it('does not mutate the original array', () => {
    const original = [1, 2, 3];
    toggleInArray(original, 2);
    expect(original).toEqual([1, 2, 3]);
  });
});

// =====================================================
// getFileIcon
// =====================================================

describe('getFileIcon', () => {
  it('returns image icon for image types', () => {
    expect(getFileIcon('image/png')).toBe('🖼️');
    expect(getFileIcon('image/jpeg')).toBe('🖼️');
    expect(getFileIcon('image/svg+xml')).toBe('🖼️');
  });

  it('returns PDF icon for application/pdf', () => {
    expect(getFileIcon('application/pdf')).toBe('📄');
  });

  it('returns spreadsheet icon for spreadsheet types', () => {
    expect(getFileIcon('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('📊');
    expect(getFileIcon('text/csv')).toBe('📊');
  });

  it('returns presentation icon for presentation types', () => {
    expect(getFileIcon('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('📑');
  });

  it('returns generic icon for unknown types', () => {
    expect(getFileIcon('application/octet-stream')).toBe('📎');
    expect(getFileIcon('text/plain')).toBe('📎');
  });
});

// =====================================================
// MemoryCache
// =====================================================

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for non-existent keys', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('stores and retrieves values', () => {
    cache.set('key', { data: 'hello' });
    expect(cache.get('key')).toEqual({ data: 'hello' });
  });

  it('returns null for expired entries', () => {
    cache.set('key', 'value');
    // Advance past default TTL (5 minutes)
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(cache.get('key')).toBeNull();
  });

  it('respects custom TTL', () => {
    cache.set('key', 'value');
    // Advance 3 minutes — still valid with default TTL
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(cache.get('key')).toBe('value');

    // But expired with 2 min TTL
    cache.set('key2', 'value2');
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(cache.get('key2', 2 * 60 * 1000)).toBeNull();
  });

  it('invalidates a specific key', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
  });

  it('invalidates by prefix', () => {
    cache.set('projects_user1_true', []);
    cache.set('projects_user2_false', []);
    cache.set('settings_global', {});
    cache.invalidatePrefix('projects_');
    expect(cache.get('projects_user1_true')).toBeNull();
    expect(cache.get('projects_user2_false')).toBeNull();
    expect(cache.get('settings_global')).toEqual({});
  });

  it('clears all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('overwrites existing entries', () => {
    cache.set('key', 'old');
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
  });

  it('resets TTL on overwrite', () => {
    cache.set('key', 'v1');
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 min in
    cache.set('key', 'v2'); // reset TTL
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 more min
    // Total 8 min from first set, but only 4 from last set — still valid
    expect(cache.get('key')).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// buildArtifactsContext — cross-artifact content excerpts (round 2 Top 5)
// ---------------------------------------------------------------------------

import { buildArtifactExcerpt, selectExcerptCandidates } from '../services/ai/prompts/projectPrompts';

describe('buildArtifactExcerpt', () => {
  it('strips fenced diagram/code blocks and keeps the prose', () => {
    const content = 'Intro del documento.\n\n```mermaid\nflowchart TD\nA-->B\n```\n\nConclusión final.';
    const excerpt = buildArtifactExcerpt(content);
    expect(excerpt).not.toContain('flowchart');
    expect(excerpt).toContain('[bloque de diagrama/código omitido]');
    expect(excerpt).toContain('Conclusión final.');
  });

  it('caps long content at a word boundary with a truncation marker', () => {
    const content = 'Una frase con sentido. '.repeat(200);
    const excerpt = buildArtifactExcerpt(content, 300);
    expect(excerpt.length).toBeLessThan(360);
    expect(excerpt).toContain('[…extracto truncado…]');
  });
});

describe('selectExcerptCandidates', () => {
  it('prefers text-bearing artifacts and excludes the one being regenerated', () => {
    const artifacts = [
      makeArtifact({ id: 'd1', versionGroupId: 'vgd1', name: 'BRD', representation: 'document', content: 'B'.repeat(300), createdAt: '2024-01-01T00:00:00Z' }),
      makeArtifact({ id: 'g1', versionGroupId: 'vgg1', name: 'C4', representation: 'diagram', content: 'flowchart TD\n'.repeat(30), createdAt: '2024-03-01T00:00:00Z' }),
      makeArtifact({ id: 'd2', versionGroupId: 'vgd2', name: 'Casos de Uso', representation: 'document', content: 'U'.repeat(300), createdAt: '2024-02-01T00:00:00Z' }),
      makeArtifact({ id: 'self', versionGroupId: 'vg-self', name: 'SDD', representation: 'document', content: 'S'.repeat(300) }),
    ];
    const picked = selectExcerptCandidates(artifacts, { excludeVersionGroupId: 'vg-self', limit: 2 });
    expect(picked.map((a) => a.name)).toEqual(['Casos de Uso', 'BRD']);
  });

  it('skips near-empty artifacts', () => {
    const artifacts = [makeArtifact({ content: 'corto' })];
    expect(selectExcerptCandidates(artifacts)).toHaveLength(0);
  });
});

describe('buildArtifactsContext with excerpts', () => {
  it('embeds capped content excerpts and the consistency directive', () => {
    const artifacts = [
      makeArtifact({ id: 'd1', versionGroupId: 'vgd1', name: 'BRD Aprobado', content: `# BRD\n\n${'Requisito BR-001 descrito en detalle. '.repeat(20)}` }),
    ];
    const project = makeProject({ artifacts });
    const result = buildArtifactsContext(project, { includeExcerpts: true });
    expect(result).toContain('CONTENT EXCERPTS FROM RELATED ARTIFACTS');
    expect(result).toContain('### "BRD Aprobado"');
    expect(result).toContain('Requisito BR-001');
  });

  it('keeps the legacy shape when excerpts are not requested', () => {
    const project = makeProject({ artifacts: [makeArtifact({ content: 'X'.repeat(300) })] });
    const result = buildArtifactsContext(project);
    expect(result).not.toContain('CONTENT EXCERPTS');
  });
});

// =====================================================
// buildSiblingDiagramsPromptBlock
// =====================================================

describe('buildSiblingDiagramsPromptBlock', () => {
  const mermaidSource = 'flowchart LR\n  api[API Gateway] --> core[Core PBM]\n  core --> db[(Claims DB)]';

  it('exposes the mermaid source of diagram artifacts with reuse instructions', () => {
    const artifacts = [
      makeArtifact({
        id: 'dg1', versionGroupId: 'vgdg1', name: 'Diagrama de Contenedores',
        type: 'mermaid-c4-container', representation: 'diagram', content: mermaidSource,
      }),
    ];
    const block = buildSiblingDiagramsPromptBlock(makeProject({ artifacts }));
    expect(block).toContain('PREVIOUSLY GENERATED PROJECT DIAGRAMS');
    expect(block).toContain('### Diagrama existente: "Diagrama de Contenedores"');
    expect(block).toContain('flowchart LR');
    expect(block).toContain('EMBED that diagram');
  });

  it('extracts the fenced mermaid block from hybrid artifacts', () => {
    const artifacts = [
      makeArtifact({
        id: 'h1', versionGroupId: 'vgh1', name: 'Análisis Híbrido',
        representation: 'hybrid', content: `# Doc\n\nProsa.\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\``,
      }),
    ];
    const block = buildSiblingDiagramsPromptBlock(makeProject({ artifacts }));
    expect(block).toContain('Análisis Híbrido');
    expect(block).toContain('Claims DB');
  });

  it('returns empty string when there are no reusable diagram sources', () => {
    const artifacts = [
      makeArtifact({ id: 'doc1', versionGroupId: 'vgdoc1', representation: 'document', content: '# Solo prosa' }),
    ];
    expect(buildSiblingDiagramsPromptBlock(makeProject({ artifacts }))).toBe('');
  });

  it('skips oversized sources and the excluded version group', () => {
    const huge = `flowchart LR\n${Array.from({ length: 120 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n')}`;
    const artifacts = [
      makeArtifact({
        id: 'big', versionGroupId: 'vgbig', name: 'Gigante',
        representation: 'diagram', content: huge, createdAt: '2024-03-01T00:00:00.000Z',
      }),
      makeArtifact({
        id: 'self', versionGroupId: 'vgself', name: 'Yo Mismo',
        representation: 'diagram', content: mermaidSource, createdAt: '2024-02-01T00:00:00.000Z',
      }),
      makeArtifact({
        id: 'ok', versionGroupId: 'vgok', name: 'Compacto',
        representation: 'diagram', content: mermaidSource, createdAt: '2024-01-15T00:00:00.000Z',
      }),
    ];
    const block = buildSiblingDiagramsPromptBlock(makeProject({ artifacts }), { excludeVersionGroupId: 'vgself' });
    expect(block).not.toContain('Gigante');
    expect(block).not.toContain('Yo Mismo');
    expect(block).toContain('Compacto');
  });

  it('caps the number of embedded sources', () => {
    const artifacts = ['A', 'B', 'C'].map((n, i) => makeArtifact({
      id: `d${i}`, versionGroupId: `vgd${i}`, name: `Diagrama ${n}`,
      representation: 'diagram', content: mermaidSource,
      createdAt: `2024-0${i + 1}-01T00:00:00.000Z`,
    }));
    const block = buildSiblingDiagramsPromptBlock(makeProject({ artifacts }), { maxSources: 2 });
    expect(block).toContain('Diagrama C');
    expect(block).toContain('Diagrama B');
    expect(block).not.toContain('Diagrama A');
  });
});
