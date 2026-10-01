/**
 * Navegar de un nivel C4 al siguiente sin montar el lienzo (plan de
 * diagramas, 4.1).
 *
 * Fija las reglas del portafolio aplicadas al enlace de detalle: se enlaza
 * por id de grupo y abre la última versión, sólo se enlaza lo que existe en
 * el proyecto, un enlace roto se informa y nunca se descarta, y un clic que
 * no cambia nada no crea una versión.
 */
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';
import {
  describeDetailLinks,
  expectedDetailLevel,
  listDetailLinkCandidates,
  planDetailLink,
  resolveDetailLinks,
  resolveNodeDetailLink,
} from '../../../services/artifacts/application/diagramDetailLinks';
import { planCanvasDiagramSave } from '../../../services/artifacts/application/diagramModification';
import { irToReactFlow, mergeIRMetadata, resolveRenderableDiagram, toDiagramIR } from '../../../services/diagram';

const contextIR = (overrides: Partial<DiagramIR['nodes'][number]> = {}): DiagramIR => ({
  nodes: [
    { id: 'cliente', label: 'Cliente', kind: 'person', position: { x: 0, y: 0 } },
    { id: 'core', label: 'Core de pólizas', kind: 'system', position: { x: 300, y: 0 }, ...overrides },
  ],
  edges: [{ id: 'e1', source: 'cliente', target: 'core', label: 'usa' }],
  groups: [],
  metadata: { layoutMode: 'manual', qualityReview: { score: 92, issues: [] } },
});

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'ctx-v2',
  versionGroupId: 'ctx',
  version: 2,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Contexto',
  type: 'mermaid-c4-context',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'C4Context\nPerson(cliente, "Cliente")',
  objective: '',
  keyConcepts: [],
  representation: 'diagram',
  ir: contextIR(),
  ...overrides,
});

const containersV1 = artifact({ id: 'cont-v1', versionGroupId: 'cont', version: 1, name: 'Contenedores', type: 'mermaid-c4-container', ir: undefined });
const containersV3 = { ...containersV1, id: 'cont-v3', version: 3 };
const sequence = artifact({ id: 'seq-v1', versionGroupId: 'seq', version: 1, name: 'Alta de póliza', type: 'mermaid-sequence', ir: undefined });
const document = artifact({ id: 'doc-v1', versionGroupId: 'doc', version: 1, name: 'ADR', type: 'adr' as Artifact['type'], representation: 'document', ir: undefined });
const project = [artifact(), artifact({ id: 'ctx-v1', version: 1 }), containersV1, containersV3, sequence, document];

describe('candidatos al detalle', () => {
  it('ofrece la última versión de cada diagrama del proyecto, sin el propio y sin documentos', () => {
    const candidates = listDetailLinkCandidates(artifact(), project);
    expect(candidates.map((c) => [c.groupId, c.artifactId])).toEqual([
      ['cont', 'cont-v3'],
      ['seq', 'seq-v1'],
    ]);
  });

  it('pone primero el nivel C4 que se espera debajo', () => {
    const [first] = listDetailLinkCandidates(artifact(), project);
    expect(first.recommended).toBe(true);
    expect(first.levelLabel).toBe('C4 · Contenedores');
    expect(expectedDetailLevel('mermaid-c4-container')).toBe('component');
    expect(expectedDetailLevel('mermaid-c4-component')).toBeNull();
  });
});

describe('guardar un enlace', () => {
  const now = () => '2026-09-28T12:00:00.000Z';

  it('pasa por el motor de patches y crea una versión con su nota, sin tocar el texto ni la revisión', () => {
    const plan = planDetailLink({ artifact: artifact(), nodeId: 'core', targetGroupId: 'cont', artifacts: project, now });
    expect(plan.kind).toBe('version');
    if (plan.kind !== 'version') return;
    const core = plan.draft.ir?.nodes.find((n) => n.id === 'core');
    expect(core?.detailArtifactGroupId).toBe('cont');
    expect(core?.position).toEqual({ x: 300, y: 0 });
    expect(plan.draft.content).toBe(artifact().content);
    expect(plan.draft.ir?.metadata?.qualityReview?.score).toBe(92);
    expect(plan.draft.changeNote).toEqual({
      kind: 'diagram-patch',
      basedOnVersion: 2,
      changes: ['«Core de pólizas» se detalla en «Contenedores».'],
      at: now(),
    });
  });

  it('no crea una versión cuando el enlace ya era ése', () => {
    const linked = artifact({ ir: contextIR({ detailArtifactGroupId: 'cont' }) });
    expect(planDetailLink({ artifact: linked, nodeId: 'core', targetGroupId: 'cont', artifacts: project }).kind).toBe('no-change');
    expect(planDetailLink({ artifact: artifact(), nodeId: 'core', targetGroupId: null, artifacts: project }).kind).toBe('no-change');
  });

  it('quitar el enlace borra el campo en vez de dejarlo vacío', () => {
    const linked = artifact({ ir: contextIR({ detailArtifactGroupId: 'cont' }) });
    const plan = planDetailLink({ artifact: linked, nodeId: 'core', targetGroupId: null, artifacts: project });
    expect(plan.kind).toBe('version');
    if (plan.kind !== 'version') return;
    const core = plan.draft.ir?.nodes.find((n) => n.id === 'core');
    expect(core && 'detailArtifactGroupId' in core).toBe(false);
  });

  it('rechaza lo que no existe en el proyecto, un documento y el propio diagrama', () => {
    const refused = (targetGroupId: string) =>
      planDetailLink({ artifact: artifact(), nodeId: 'core', targetGroupId, artifacts: project }).kind;
    expect(refused('otro-proyecto')).toBe('refused');
    expect(refused('doc')).toBe('refused');
    expect(refused('ctx')).toBe('refused');
    expect(planDetailLink({ artifact: artifact(), nodeId: 'fantasma', targetGroupId: 'cont', artifacts: project }).kind).toBe('refused');
  });
});

describe('resolver enlaces', () => {
  it('abre la última versión del grupo enlazado', () => {
    const linked = artifact({ ir: contextIR({ detailArtifactGroupId: 'cont' }) });
    const link = resolveNodeDetailLink(linked, 'core', project);
    expect(link).toMatchObject({ status: 'resolved', target: { artifactId: 'cont-v3', name: 'Contenedores' } });
    expect(resolveNodeDetailLink(linked, 'cliente', project)).toBeNull();
  });

  it('informa un enlace roto y no lo descarta', () => {
    const orphan = artifact({ ir: contextIR({ detailArtifactGroupId: 'borrado' }) });
    expect(resolveDetailLinks(orphan.ir, project)).toEqual([
      { status: 'broken', nodeId: 'core', nodeLabel: 'Core de pólizas', groupId: 'borrado' },
    ]);
    const { rows } = describeDetailLinks(orphan, project);
    expect(rows.find((row) => row.nodeId === 'core')?.link?.status).toBe('broken');
    expect(rows.find((row) => row.nodeId === 'cliente')?.link).toBeNull();
  });
});

describe('el enlace sobrevive al lienzo', () => {
  it('viaja en los datos del nodo y vuelve al IR al guardar posiciones', () => {
    const ir = contextIR({ detailArtifactGroupId: 'cont' });
    const flow = irToReactFlow(ir);
    const node = flow.nodes.find((n) => n.id === 'core');
    expect(node?.data.detailArtifactGroupId).toBe('cont');
    const back = mergeIRMetadata(toDiagramIR(flow.nodes, flow.edges), ir);
    expect(back.nodes.find((n) => n.id === 'core')?.detailArtifactGroupId).toBe('cont');
  });
});

describe('guardar el lienzo (plan de diagramas, 8.1a)', () => {
  const canvas = (artifact: Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>) => {
    const { reactFlow } = resolveRenderableDiagram(artifact, { audience: 'technical' });
    return { nodes: reactFlow.nodes.filter((n) => n.type !== 'groupZone'), edges: reactFlow.edges };
  };

  it('un híbrido conserva su prosa y su bloque Mermaid, y una etiqueta con «$» llega literal', () => {
    const hybrid = { id: 'h', content: 'Texto\n```mermaid\ngraph TD\n  a[Inicio] --> b[Fin]\n```\nFin', type: 'hybrid-text-diagram' as const, representation: 'hybrid' as const };
    const before = canvas(hybrid);
    const after = { ...before, nodes: before.nodes.map((n) => (n.id === 'a' ? { ...n, data: { ...n.data, label: 'Coste $1 y $&' } } : n)) };
    const saved = planCanvasDiagramSave(hybrid, { before, after });
    expect(saved.content.startsWith('Texto\n```mermaid\n')).toBe(true);
    expect(saved.content).toContain('Coste $1 y $&');
    expect(saved.content.endsWith('```\nFin')).toBe(true);
    expect(saved.content).not.toContain('```json');
    expect(saved.type).toBe('hybrid-text-diagram');
  });

  it('cualquier otro diagrama conserva su tipo y su notación: una secuencia sigue siendo una secuencia', () => {
    const sequence = { id: 's', content: 'sequenceDiagram\n  A->>B: Pide\n  B-->>A: Responde', type: 'mermaid-sequence' as const, representation: 'diagram' as const };
    const before = canvas(sequence);
    const after = { ...before, nodes: before.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: n.position.x + 30, y: n.position.y } } : n)) };
    const saved = planCanvasDiagramSave(sequence, { before, after });
    expect(saved.type).toBe('mermaid-sequence');
    expect(saved.representation).toBe('diagram');
    expect(saved.content).toBe(sequence.content);
    expect(saved.notice).toBeNull();
  });
});
