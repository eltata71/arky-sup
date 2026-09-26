/**
 * The engine enters `services/ai`, and what it took from `services/artifacts`
 * arrives through a port (F5-01, corte 14).
 *
 * The move failed in Ola 5 because the engine reached into contexts that
 * import this layer back. The last of them was `services/artifacts`: the
 * controlled source selection and the deterministic fallbacks. Generation now
 * declares `ArtifactGenerationSupport`, `services/artifacts` supplies it, and
 * every caller hands it over. What must hold: the engine does not import the
 * artifacts context again, the root of `services/` stays empty, and the
 * fallbacks the canvas depends on are the ones the port returns.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artifactGenerationEngine } from '../../../services/ai/generation/artifacts/artifactGenerationEngine';
import type { ArtifactGenerationSupport } from '../../../services/ai';
import { artifactGenerationSupport } from '../../../services/artifacts/domain/artifactGenerationSupport';
import {
  selectArtifactGenerationContext,
  validateControlledContextForPrompt,
} from '../../../services/artifacts/domain/artifactContextSelectionService';
import type { ArtifactGenerationContract, ArtifactTemplate, Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';

const ENGINE = 'services/ai/generation/artifacts/artifactGenerationEngine.ts';

const project = {
  id: 'p1',
  name: 'Reclamos médicos',
  description: 'Modernización del core de reclamos.',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Project;
const settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, apiKeySource: 'user' },
} as unknown as Settings;
const documentTemplate = {
  name: 'Documento de decisiones',
  type: 'markdown',
  phase: 'Fase 1',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Documenta las decisiones del core.',
  keyConcepts: [],
  representation: 'document',
} as unknown as ArtifactTemplate;
const diagramTemplate = {
  ...documentTemplate,
  name: 'Diagrama de integración',
  type: 'mermaid-graph',
  representation: 'diagram',
} as unknown as ArtifactTemplate;

const fakeSupport = (): ArtifactGenerationSupport => ({
  controlledContext: vi.fn(() => ({ promptBlock: '', ok: true, errors: [], warnings: [] })),
  deterministicArtifact: vi.fn(() => 'DETERMINISTA'),
  deterministicDiagramSkeleton: vi.fn(() => 'flowchart LR\n  a[Usuario] --> b[Sistema]'),
  markSkeleton: vi.fn((mermaid: string) => mermaid),
});

type TextPath = { generateTextWithFallback: (...args: unknown[]) => Promise<string> };

/** Makes every model path fail the way a provider outage does. */
const failEveryModelCall = () => {
  const outage = Object.assign(new Error('Service Unavailable'), { status: 503 });
  vi.spyOn(artifactGenerationEngine as unknown as TextPath, 'generateTextWithFallback').mockRejectedValue(outage);
};

const codeOf = (file: string): string =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => vi.restoreAllMocks());

describe('the engine lives in services/ai (F5-01 corte 14)', () => {
  it('and the root of services/ holds no loose file', () => {
    const loose = readdirSync('services')
      .filter((entry) => statSync(join('services', entry)).isFile() && /\.tsx?$/.test(entry));
    expect(loose).toEqual([]);
    expect(existsSync('services/geminiService.ts')).toBe(false);
  });

  it('does not import the artifacts context, the Office, the agent or chat', () => {
    expect(codeOf(ENGINE)).not.toMatch(/from ['"](?:\.\.\/)+(?:artifacts|architectureOffice|agent|chat)(?:\/[^'"]*)?['"]/);
  });
});

describe('the artifacts context supplies the port', () => {
  it('its controlled context is the selection and validation the engine used to run', () => {
    const contract = {
      id: 'c1',
      normalizedIntent: 'Decisiones del core',
      audience: 'technical',
      purpose: 'decision',
      detailLevel: 'logical',
      artifactFamily: 'document',
      qualityTarget: 80,
      exportTargets: [],
      acceptanceCriteria: [],
      requiredSourceArtifactIds: [],
      optionalSourceArtifactIds: [],
      excludedSourceArtifactIds: [],
      requiredContextItems: [],
      excludedContextItems: [],
      originalRequest: 'Documenta las decisiones del core.',
      language: 'es',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies ArtifactGenerationContract;

    const selection = selectArtifactGenerationContext(project, contract, {
      maxOptionalSources: 3,
      maxContextItems: 5,
      sourceSummaryChars: 900,
    });
    expect(artifactGenerationSupport.controlledContext(project, contract, 900)).toEqual({
      promptBlock: selection.promptBlock,
      ...validateControlledContextForPrompt(selection),
    });
  });
});

describe('generation degrades through the port it is handed', () => {
  it('a document falls back to the port’s deterministic artifact when the provider is down', async () => {
    failEveryModelCall();
    const support = fakeSupport();

    const content = await artifactGenerationEngine.generateArtifactContent(project, documentTemplate, settings, undefined, {
      architectureGraphPromptBlock: '',
      support,
    });

    expect(content).toBe('DETERMINISTA');
    expect(support.deterministicArtifact).toHaveBeenCalledWith(project, documentTemplate);
  });

  it('a diagram falls back to the port’s skeleton, never to an empty canvas', async () => {
    failEveryModelCall();
    const support = fakeSupport();

    const content = await artifactGenerationEngine.generateArtifactContent(project, diagramTemplate, settings, undefined, {
      architectureGraphPromptBlock: '',
      support,
    });

    expect(content.trim().length).toBeGreaterThan(0);
    expect(
      vi.mocked(support.deterministicArtifact).mock.calls.length
        + vi.mocked(support.deterministicDiagramSkeleton).mock.calls.length,
    ).toBeGreaterThan(0);
  });
});
