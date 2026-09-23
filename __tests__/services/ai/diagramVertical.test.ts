/**
 * The diagram vertical is out of the engine (F5-01, corte 6), and stays out.
 *
 * Six public methods — IR generation, self-healing, critique/refine, the
 * Mermaid→ReactFlow and Excalidraw conversions, and the render repair — left
 * `services/geminiService.ts` for `services/ai/generation/diagram/`. The IR
 * path keeps its transport (`generateTextWithFallback`, the same the engine
 * used) and the self-healing ladder keeps its three rungs; these pin both.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import { generateDiagramIR, generateDiagramIRWithSelfHealing } from '../../../services/ai/generation/diagram';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import type { Settings } from '../../../types';

const settings = {
  globalContext: [],
  language: 'es',
  theme: 'dark',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'profesional', languageStyle: 'es', apiKeySource: 'global' },
} as unknown as Settings;

const project = {
  id: 'p1',
  name: 'Portal de asegurados',
  description: 'Autogestión de pólizas.',
  projectContext: [],
  artifacts: [],
} as unknown as Project;

const artifact = {
  id: 'a1',
  name: 'Contexto del portal',
  type: 'mermaid-c4-context',
  objective: 'Mostrar el contexto',
  content: '',
  keyConcepts: [{ term: 'Portal', definition: 'Canal web' }, { term: 'Core', definition: 'Sistema de pólizas' }],
  representation: 'diagram',
} as unknown as Artifact;

const readCode = (file: string): string =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the diagram vertical outside the engine', () => {
  it('the engine no longer declares any of the moved methods', () => {
    const engine = readCode('services/geminiService.ts');
    for (const method of [
      'parseMermaidToReactFlow', 'generateDiagramIR', 'generateDiagramIRCorrective',
      'generateAndRefineDiagramIR', 'runCritiqueAndRefine', 'convertToExcalidrawJSON', 'fixDiagramError',
    ]) {
      expect(engine, method).not.toMatch(new RegExp(`(public|private)\\s+(async\\s+)?${method}\\s*\\(`));
    }
  });

  it('the façade does not import the engine', () => {
    expect(readCode('services/ai/generation/diagramGenerationService.ts')).not.toMatch(/geminiService['"]/);
  });
});

describe('generateDiagramIR', () => {
  it('drops edges and group members whose endpoints do not exist', async () => {
    vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue(JSON.stringify({
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'a', target: 'ghost' }],
      groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'ghost'] }, { id: 'g2', label: 'G2', nodeIds: ['ghost'] }],
    }));

    const ir = await generateDiagramIR(artifact, project, settings);

    expect(ir?.edges.map((edge) => edge.id)).toEqual(['e1']);
    expect(ir?.groups).toEqual([expect.objectContaining({ id: 'g', nodeIds: ['a'] })]);
  });

  it('returns null when the model declines or returns no nodes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const spy = vi.spyOn(legacyTransport, 'generateTextWithFallback');

    spy.mockResolvedValueOnce(JSON.stringify({ error: 'no puedo' }));
    await expect(generateDiagramIR(artifact, project, settings)).resolves.toBeNull();

    spy.mockResolvedValueOnce(JSON.stringify({ nodes: [], edges: [] }));
    await expect(generateDiagramIR(artifact, project, settings)).resolves.toBeNull();
  });
});

describe('generateDiagramIRWithSelfHealing', () => {
  it('falls back to the deterministic skeleton after the direct and the corrective attempt fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const spy = vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue('{"nodes":[],"edges":[]}');

    const result = await generateDiagramIRWithSelfHealing(artifact, project, settings);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe('skeleton');
    expect(result.attempts).toBe(3);
    expect(result.lastReason).toBe('skeleton-fallback');
    expect(result.ir.nodes.length).toBeGreaterThan(0);
  });

  it('stops at the first attempt when it yields nodes', async () => {
    const spy = vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue(JSON.stringify({
      nodes: [{ id: 'a', label: 'A' }], edges: [],
    }));

    const result = await generateDiagramIRWithSelfHealing(artifact, project, settings);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ attempts: 1, fallback: 'none' });
  });
});
