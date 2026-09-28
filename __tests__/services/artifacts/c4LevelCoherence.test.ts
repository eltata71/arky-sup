/**
 * Coherencia entre niveles C4 (plan de diagramas, 4.2).
 *
 * Fija la puerta: un contenedor fuera del sistema que su diagrama detalla se
 * avisa con la referencia al nodo; un detalle sin límite con el nombre del
 * sistema se avisa una vez; el nombre se compara como lo hace el grafo de
 * conocimiento; y el aviso no toca la puntuación ni el preflight.
 */
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';
import {
  assessC4LevelCoherence,
  toC4CoherenceIssues,
  withC4Coherence,
} from '../../../services/artifacts/application/c4LevelCoherence';
import type { DiagramQualityReport } from '../../../services/diagram';

const base = (overrides: Partial<Artifact>): Artifact => ({
  id: 'x',
  versionGroupId: 'x',
  version: 1,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'x',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '',
  objective: '',
  keyConcepts: [],
  representation: 'diagram',
  ...overrides,
});

const contextIR = (detail: string | undefined, label = 'Core de Pólizas'): DiagramIR => ({
  nodes: [
    { id: 'cliente', label: 'Cliente', kind: 'person' },
    { id: 'core', label, kind: 'system', ...(detail ? { detailArtifactGroupId: detail } : {}) },
  ],
  edges: [{ id: 'e1', source: 'cliente', target: 'core', label: 'usa' }],
  groups: [],
});

const context = (detail = 'cont', label?: string) =>
  base({ id: 'ctx-v1', versionGroupId: 'ctx', name: 'Contexto', type: 'mermaid-c4-context', ir: contextIR(detail, label) });

const API = 'Container(api, "API de pólizas", "Java", "Reglas")';
const containersSource = (boundary: string, apiInside = true) => [
  'C4Container',
  'Person(cliente, "Cliente")',
  `System_Boundary(core, "${boundary}") {`,
  '  Container(web, "Portal web", "React", "Autoservicio")',
  '  ContainerDb(db, "Base de pólizas", "PostgreSQL", "Datos")',
  ...(apiInside ? [`  ${API}`, '}'] : ['}', API]),
  'Rel(cliente, web, "Usa")',
  'Rel(web, api, "Llama")',
].join('\n');

const containers = (source: string) =>
  base({ id: 'cont-v1', versionGroupId: 'cont', name: 'Contenedores', type: 'mermaid-c4-container', content: source });

describe('assessC4LevelCoherence', () => {
  it('no avisa cuando los contenedores están dentro del sistema, aunque el nombre difiera en acentos y mayúsculas', () => {
    const detail = containers(containersSource('core de polizas'));
    expect(assessC4LevelCoherence(detail, [context(), detail])).toEqual([]);
  });

  it('avisa, con la referencia al nodo, del contenedor que queda fuera del sistema', () => {
    const source = containersSource('Core de Pólizas', false);
    const detail = containers(source);
    const warnings = assessC4LevelCoherence(detail, [context(), detail]);
    expect(warnings.map((w) => [w.code, w.nodeId])).toEqual([
      ['C4_ELEMENT_OUTSIDE_PARENT', 'api'],
    ]);
    expect(warnings[0].message).toContain('«API de pólizas»');
    expect(warnings[0].message).toContain('«Core de Pólizas»');
  });

  it('avisa una sola vez cuando ningún límite lleva el nombre del sistema', () => {
    const detail = containers(containersSource('Plataforma digital'));
    const warnings = assessC4LevelCoherence(detail, [context(), detail]);
    expect(warnings.map((w) => [w.code, w.nodeId])).toEqual([['C4_DETAIL_PARENT_MISSING', 'core']]);
  });

  it('no dice nada de un diagrama que nadie enlaza, ni de uno que no es C4', () => {
    const detail = containers(containersSource('Plataforma digital'));
    expect(assessC4LevelCoherence(detail, [context('otro'), detail])).toEqual([]);
    const sequence = base({ id: 'seq', versionGroupId: 'cont', type: 'mermaid-sequence', content: 'sequenceDiagram\nA->>B: hola' });
    expect(assessC4LevelCoherence(sequence, [context(), sequence])).toEqual([]);
  });

  it('lee el enlace de la última versión del diagrama de arriba', () => {
    const detail = containers(containersSource('Plataforma digital'));
    const unlinked = base({ ...context(), id: 'ctx-v2', version: 2, ir: contextIR(undefined) });
    expect(assessC4LevelCoherence(detail, [context(), unlinked, detail])).toEqual([]);
  });

  it('informa los enlaces de detalle rotos del propio diagrama', () => {
    const orphan = context('borrado');
    const warnings = assessC4LevelCoherence(orphan, [orphan]);
    expect(warnings.map((w) => [w.code, w.nodeId])).toEqual([['C4_DETAIL_LINK_BROKEN', 'core']]);
  });
});

describe('en el informe de calidad', () => {
  const report = { score: 88, issues: [], summary: 'ok' } as unknown as DiagramQualityReport;

  it('añade los avisos sin tocar la puntuación', () => {
    const detail = containers(containersSource('Core de Pólizas', false));
    const warnings = assessC4LevelCoherence(detail, [context(), detail]);
    const merged = withC4Coherence(report, warnings);
    expect(merged?.score).toBe(88);
    expect(merged?.issues).toEqual(toC4CoherenceIssues(warnings));
    expect(merged?.issues[0]).toMatchObject({ id: 'c4-coherence:C4_ELEMENT_OUTSIDE_PARENT:api', severity: 'medium' });
  });

  it('sin avisos o sin informe devuelve lo mismo', () => {
    expect(withC4Coherence(report, [])).toBe(report);
    expect(withC4Coherence(null, [{ code: 'C4_DETAIL_LINK_BROKEN', nodeId: 'n', nodeLabel: 'n', message: '', recommendation: '' }])).toBeNull();
  });
});
