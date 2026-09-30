/**
 * El contexto de una operación sobre un artefacto, ensamblado una vez (plan de
 * calidad de artefactos, 7.2): ámbitos, jerarquía, relevancia y presupuesto.
 */
import { describe, expect, it } from 'vitest';
import type { MemoryEntry, Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import {
  ARTIFACT_CONTEXT_PROFILES,
  ARTIFACT_CONTEXT_SCOPES,
  assembleArtifactContext,
  bundleItems,
  renderArtifactContextBundle,
} from '../../../services/ai/prompts/artifactContext';
import { UNTRUSTED_FENCE_CLOSE, UNTRUSTED_FENCE_OPEN } from '../../../lib/untrustedContent';

const settings = {
  language: 'es',
  globalContext: ['Toda integración usa OAuth 2.0 con mTLS'],
  agentMemory: ['Prefiero alternativas comparadas con su coste'],
} as unknown as Settings;

const artifactOf = (overrides: Partial<Artifact>): Artifact => ({
  id: 'a1',
  versionGroupId: 'g1',
  version: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  name: 'Artefacto',
  type: 'markdown',
  phase: 'Fase 2',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: '',
  keyConcepts: [],
  representation: 'document',
  content: '',
  ...overrides,
} as Artifact);

const projectOf = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Autorización previa',
  description: 'Modernizar la autorización previa',
  projectContext: ['La autorización urgente se resuelve en menos de 72 horas'],
  initialCapture: ['Stakeholder: dirección médica'],
  agentMemory: ['Se descartó el bus propietario del core'],
  artifacts: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
} as unknown as Project);

describe('assembleArtifactContext', () => {
  it('reads every scope its profile declares, in hierarchy order', () => {
    const artifact = artifactOf({ artifactMemory: ['Citar la norma de retención de datos clínicos'] });
    const sibling = artifactOf({ id: 's1', versionGroupId: 'gs', name: 'Visión', content: `# Visión\n${'La visión prioriza la trazabilidad regulatoria. '.repeat(4)}` });
    const bundle = assembleArtifactContext({ project: projectOf({ artifacts: [sibling, artifact] }), settings, artifact }, 'generate');
    expect(bundle.sections.map((section) => section.scope)).toEqual([...ARTIFACT_CONTEXT_SCOPES]);
    expect(bundleItems(bundle, 'hermanos')[0]).toContain('«Visión»');
  });

  it('never excerpts the artifact itself, nor the version group being regenerated', () => {
    const artifact = artifactOf({ content: `# Propio\n${'contenido propio. '.repeat(20)}` });
    const previous = artifactOf({ id: 'old', versionGroupId: 'regen', content: `# Anterior\n${'versión anterior. '.repeat(20)}` });
    const bundle = assembleArtifactContext(
      { project: projectOf({ artifacts: [artifact, previous] }), settings, artifact, excludeVersionGroupId: 'regen' },
      'generate',
    );
    expect(bundleItems(bundle, 'hermanos')).toEqual([]);
  });

  it('keeps a note repeated in two scopes only in the higher one, and counts the duplicate', () => {
    const shared = 'Todo pago pasa por el control de sanciones';
    const bundle = assembleArtifactContext(
      { project: projectOf({ projectContext: [shared] }), settings: { ...settings, globalContext: [`${shared}.`] } as Settings },
      'generate',
    );
    expect(bundleItems(bundle, 'proyecto').join()).toContain(shared);
    expect(bundleItems(bundle, 'global')).toEqual([]);
    expect(bundle.omitted).toContainEqual({ scope: 'global', count: 1, reason: 'duplicado' });
  });

  it('ranks notes by relevance to the query and counts what the limit left out', () => {
    const notes = Array.from({ length: 20 }, (_, i) => `Nota operativa número ${i} sin relación`);
    notes.push('La adjudicación de reclamaciones médicas usa el motor de coberturas');
    const bundle = assembleArtifactContext(
      { project: projectOf({ projectContext: notes }), settings, query: 'adjudicación de reclamaciones' },
      'diagram',
    );
    expect(bundleItems(bundle, 'proyecto')[0]).toContain('adjudicación de reclamaciones');
    expect(bundleItems(bundle, 'proyecto')).toHaveLength(ARTIFACT_CONTEXT_PROFILES.diagram.limits.proyecto!);
    expect(bundle.omitted).toContainEqual({ scope: 'proyecto', count: 21 - ARTIFACT_CONTEXT_PROFILES.diagram.limits.proyecto!, reason: 'limite' });
  });

  it('orders a user priority before a stored order', () => {
    const entries: MemoryEntry[] = [
      { id: 'n1', text: 'Nota de prioridad baja', priority: 'low', createdAt: null, author: null } as MemoryEntry,
      { id: 'n2', text: 'Nota de prioridad alta', priority: 'high', createdAt: null, author: null } as MemoryEntry,
    ];
    const bundle = assembleArtifactContext(
      { project: projectOf({ projectContext: entries.map((e) => e.text), projectContextEntries: entries }), settings },
      'generate',
    );
    expect(bundleItems(bundle, 'proyecto')[0]).toContain('prioridad alta');
  });

  it('cuts the lowest scopes first when over budget, and says so', () => {
    const long = (label: string) => Array.from({ length: 12 }, (_, i) => `${label} ${i} ${'detalle '.repeat(40)}`);
    const bundle = assembleArtifactContext(
      {
        project: projectOf({ projectContext: long('proyecto') }),
        settings: { ...settings, globalContext: long('global'), agentMemory: long('agente') } as Settings,
      },
      { ...ARTIFACT_CONTEXT_PROFILES.diagram, totalChars: 5_000 },
    );
    expect(bundle.chars).toBeLessThanOrEqual(5_000);
    expect(bundleItems(bundle, 'agente')).toEqual([]);
    expect(bundleItems(bundle, 'proyecto').length).toBeGreaterThan(0);
    expect(bundle.omitted.some((entry) => entry.scope === 'agente' && entry.reason === 'presupuesto')).toBe(true);
  });

  it('does not read a scope its profile leaves out', () => {
    const artifact = artifactOf({ artifactMemory: ['Memoria propia'] });
    const sibling = artifactOf({ id: 's1', versionGroupId: 'gs', content: `# Otro\n${'texto. '.repeat(40)}` });
    const bundle = assembleArtifactContext({ project: projectOf({ artifacts: [sibling] }), settings, artifact }, 'consult');
    expect(bundleItems(bundle, 'hermanos')).toEqual([]);
    expect(bundleItems(bundle, 'artefacto')).toHaveLength(1);
  });
});

describe('renderArtifactContextBundle', () => {
  it('fences what people wrote and keeps the hierarchy rule outside the fence', () => {
    const bundle = assembleArtifactContext({ project: projectOf(), settings }, 'generate');
    const rendered = renderArtifactContextBundle(bundle);
    const close = rendered.indexOf(UNTRUSTED_FENCE_CLOSE);
    expect(rendered.indexOf(UNTRUSTED_FENCE_OPEN)).toBeGreaterThanOrEqual(0);
    expect(rendered.indexOf('72 horas')).toBeLessThan(close);
    expect(rendered.indexOf('Jerarquía del contexto')).toBeGreaterThan(close);
  });

  it('renders nothing for an empty bundle', () => {
    const empty = assembleArtifactContext(
      { project: projectOf({ projectContext: [], initialCapture: [], agentMemory: [] }), settings: { language: 'es' } as Settings },
      'generate',
    );
    expect(renderArtifactContextBundle(empty)).toBe('');
  });
});
