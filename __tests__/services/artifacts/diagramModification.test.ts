/**
 * «Modificar diagrama» sin montar el lienzo (plan de diagramas, 1.1).
 *
 * Fija las cuatro promesas del panel: se propone sobre el IR completo y no
 * sobre la vista de una audiencia, nada se guarda si la vista previa dejó de
 * describir el cambio, lo que se guarda conserva el trabajo manual, y una
 * cancelación no se cuenta como fallo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR, DiagramPatch } from '../../../lib/diagram';
import type { Settings } from '../../../types';
import { applySemanticPatch, resolveEditableDiagramIR, resolveRenderableDiagram } from '../../../services/diagram';

const ai = vi.hoisted(() => ({ proposeEdit: vi.fn() }));
vi.mock('../../../services/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  diagramEditService: { proposeEdit: ai.proposeEdit },
}));

import {
  canModifyDiagram,
  planDiagramModification,
  proposeDiagramModification,
  withDiagramContent,
  type DiagramModificationProposal,
} from '../../../services/artifacts/application/diagramModification';

const settings = { aiConfig: { model: 'm', provider: 'gemini' } } as unknown as Settings;

const baseIR = (): DiagramIR => ({
  nodes: [
    { id: 'cliente', label: 'Cliente', kind: 'person', position: { x: 12, y: 40 } },
    { id: 'api', label: 'API', kind: 'service', position: { x: 300, y: 40 } },
    { id: 'db', label: 'Base de datos', kind: 'data', position: { x: 600, y: 40 } },
  ],
  edges: [
    { id: 'e1', source: 'cliente', target: 'api', label: 'llama' },
    { id: 'e2', source: 'api', target: 'db', label: 'lee' },
  ],
  groups: [],
  metadata: { layoutMode: 'manual', qualityReview: { score: 95, issues: [] } },
});

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'a1',
  versionGroupId: 'a1',
  version: 2,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Flujo de consulta',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'graph TD; cliente-->api',
  objective: 'Mostrar la consulta',
  keyConcepts: [],
  representation: 'diagram',
  ir: baseIR(),
  ...overrides,
});

const renamePatch = (): DiagramPatch => ({
  id: 'dp-1',
  source: 'ai',
  rationale: 'Renombrar la API',
  operations: [{ op: 'update-node', nodeId: 'api', changes: { label: 'API Gateway' } }],
});

/** La propuesta tal como la devolvería el servicio real: vista previa del motor. */
const proposalFor = (source: Artifact, patch: DiagramPatch): DiagramModificationProposal => {
  const preview = applySemanticPatch(resolveEditableDiagramIR(source)!, patch);
  return { artifactId: source.id, instruction: 'renombra la API', patch, applied: preview.applied, rejected: preview.rejected };
};

beforeEach(() => ai.proposeEdit.mockReset());

describe('resolveEditableDiagramIR', () => {
  it('devuelve el IR persistido completo, con sus posiciones', () => {
    const ir = resolveEditableDiagramIR(artifact());
    expect(ir?.nodes.map((n) => n.id)).toEqual(['cliente', 'api', 'db']);
    expect(ir?.nodes[0].position).toEqual({ x: 12, y: 40 });
  });

  it('lee el contenido cuando no hay IR persistido', () => {
    const ir = resolveEditableDiagramIR(artifact({ ir: undefined, content: 'graph TD\n  A[Web] --> B[API]' }));
    expect(ir?.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('devuelve null cuando no hay diagrama', () => {
    const source = artifact({ ir: undefined, content: 'Sólo texto', representation: 'document', type: 'markdown' });
    expect(resolveEditableDiagramIR(source)).toBeNull();
    expect(canModifyDiagram(source)).toBe(false);
  });
});

describe('proposeDiagramModification', () => {
  it('no llama al asistente si no hay diagrama', async () => {
    const outcome = await proposeDiagramModification(
      { artifact: artifact({ ir: undefined, content: '', type: 'markdown', representation: 'document' }), instruction: 'x' },
      settings,
    );
    expect(outcome.kind).toBe('refused');
    expect(ai.proposeEdit).not.toHaveBeenCalled();
  });

  it('propone sobre el IR completo y con el contexto del artefacto', async () => {
    const source = artifact();
    const patch = renamePatch();
    ai.proposeEdit.mockResolvedValue({ ok: true, patch, preview: applySemanticPatch(source.ir!, patch) });

    const outcome = await proposeDiagramModification({ artifact: source, instruction: 'renombra la API' }, settings);

    const [request] = ai.proposeEdit.mock.calls[0];
    expect(request.ir.nodes).toHaveLength(3);
    expect(request.instruction).toBe('renombra la API');
    expect(request.context).toContain('Flujo de consulta');
    expect(outcome.kind).toBe('proposal');
    if (outcome.kind === 'proposal') {
      expect(outcome.proposal.applied).toHaveLength(1);
      expect(outcome.proposal.instruction).toBe('renombra la API');
    }
  });

  it('con el proyecto, el contexto lleva sus notas y la memoria del artefacto, cercados (7.3a)', async () => {
    const source = { ...artifact(), artifactMemory: ['Nombrar la base como «Pólizas»'] };
    const patch = renamePatch();
    ai.proposeEdit.mockResolvedValue({ ok: true, patch, preview: applySemanticPatch(source.ir!, patch) });
    const project = {
      id: 'p1',
      name: 'Consulta de pólizas',
      description: '',
      projectContext: ['La API de consulta expone sólo lectura'],
      artifacts: [],
    } as unknown as import('../../../services/architectureProjects').Project;
    const withContext = { ...settings, globalContext: ['Toda API usa OAuth 2.0 con mTLS'] } as Settings;

    await proposeDiagramModification({ artifact: source, instruction: 'renombra la API', project }, withContext);

    const [request] = ai.proposeEdit.mock.calls[0];
    expect(request.context).toContain('La API de consulta expone sólo lectura');
    expect(request.context).toContain('OAuth 2.0 con mTLS');
    expect(request.context).toContain('Nombrar la base como «Pólizas»');
    expect(request.context).toContain('<<<CONTENIDO_EXTERNO');
  });

  it('una cancelación no es un fallo', async () => {
    ai.proposeEdit.mockResolvedValue({ ok: false, patch: null, preview: null, reason: '' });
    const outcome = await proposeDiagramModification({ artifact: artifact(), instruction: 'x' }, settings);
    expect(outcome.kind).toBe('cancelled');
  });

  it('un rechazo trae su motivo y lo que no se pudo aplicar', async () => {
    const patch: DiagramPatch = { id: 'dp', source: 'ai', operations: [{ op: 'remove-node', nodeId: 'fantasma' }] };
    const preview = applySemanticPatch(baseIR(), patch);
    ai.proposeEdit.mockResolvedValue({ ok: false, patch, preview, reason: 'Ninguna operación es aplicable.' });
    const outcome = await proposeDiagramModification({ artifact: artifact(), instruction: 'x' }, settings);
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'Ninguna operación es aplicable.' });
    if (outcome.kind === 'refused') expect(outcome.rejected[0].code).toBe('unknown-node');
  });
});

describe('planDiagramModification', () => {
  it('versiona el cambio conservando posiciones y regenerando el Mermaid', () => {
    const source = artifact();
    const plan = planDiagramModification({ artifact: source, proposal: proposalFor(source, renamePatch()) });

    expect(plan.kind).toBe('version');
    if (plan.kind !== 'version') return;
    const api = plan.draft.ir!.nodes.find((n) => n.id === 'api');
    expect(api?.label).toBe('API Gateway');
    expect(api?.position).toEqual({ x: 300, y: 40 });
    expect(plan.draft.versionGroupId).toBe('a1');
    expect(plan.draft.content).toContain('API Gateway');
    expect(plan.summary).toHaveLength(1);
  });

  it('la versión lleva su nota: qué se pidió, por qué y qué hizo el motor', () => {
    const source = artifact();
    const plan = planDiagramModification({ artifact: source, proposal: proposalFor(source, renamePatch()), now: () => '2026-09-28T12:00:00.000Z' });
    if (plan.kind !== 'version') throw new Error(plan.kind);
    expect(plan.draft.changeNote).toEqual({
      kind: 'diagram-patch',
      basedOnVersion: 2,
      instruction: 'renombra la API',
      rationale: 'Renombrar la API',
      changes: plan.summary,
      at: '2026-09-28T12:00:00.000Z',
    });
  });

  it('descarta la revisión de calidad, que describía el diagrama anterior', () => {
    const source = artifact();
    const plan = planDiagramModification({ artifact: source, proposal: proposalFor(source, renamePatch()) });
    if (plan.kind !== 'version') throw new Error(plan.kind);
    expect(plan.draft.ir!.metadata?.qualityReview).toBeUndefined();
    expect(plan.draft.ir!.metadata?.layoutMode).toBe('manual');
  });

  it('no reescribe el texto de un C4, que no se regenera desde el IR', () => {
    const source = artifact({ type: 'mermaid-c4-container', content: 'C4Container\n  title X' });
    const plan = planDiagramModification({ artifact: source, proposal: proposalFor(source, renamePatch()) });
    if (plan.kind !== 'version') throw new Error(plan.kind);
    expect(plan.draft.content).toBe('C4Container\n  title X');
  });

  it('aplica sobre el IR actual: un nodo movido después de proponer se queda donde se movió', () => {
    const proposal = proposalFor(artifact(), renamePatch());
    const moved = baseIR();
    moved.nodes[1].position = { x: 320, y: 200 };
    const plan = planDiagramModification({ artifact: artifact({ ir: moved }), proposal });
    if (plan.kind !== 'version') throw new Error(plan.kind);
    expect(plan.draft.ir!.nodes.find((n) => n.id === 'api')?.position).toEqual({ x: 320, y: 200 });
  });

  it('se niega si el diagrama cambió y la vista previa ya no describe el cambio', () => {
    const proposal = proposalFor(artifact(), renamePatch());
    const withoutApi = baseIR();
    withoutApi.nodes = withoutApi.nodes.filter((n) => n.id !== 'api');
    withoutApi.edges = [];
    expect(planDiagramModification({ artifact: artifact({ ir: withoutApi }), proposal }).kind).toBe('stale');
  });

  it('se niega si la propuesta es de otro artefacto', () => {
    const proposal = proposalFor(artifact(), renamePatch());
    expect(planDiagramModification({ artifact: artifact({ id: 'otro' }), proposal }).kind).toBe('stale');
  });
});

describe('withDiagramContent', () => {
  // El IR del fixture tiene ids cliente/api/db y etiquetas Cliente/API/Base de datos.
  const rewritten = 'graph LR\n  cliente[Cliente] -->|llama| api[API Gateway]\n  api -->|lee| db[Base de datos]';

  it('el defecto: guardar sólo el texto dejaba el lienzo dibujando el diagrama anterior', () => {
    const stale = { ...artifact(), content: rewritten };
    const drawn = resolveRenderableDiagram(stale, { audience: 'technical' });
    expect(drawn.ir?.nodes.some((n) => n.label === 'API Gateway')).toBe(false);
  });

  it('con el IR reconciliado, el lienzo dibuja el cambio', () => {
    const source = artifact();
    const updates = withDiagramContent(source, rewritten);
    const drawn = resolveRenderableDiagram({ ...source, ...updates }, { audience: 'technical' });

    expect(updates.content).toBe(rewritten);
    expect(drawn.ir?.nodes.some((n) => n.label === 'API Gateway')).toBe(true);
    expect(updates.ir?.nodes.find((n) => n.id === 'api')?.position).toEqual({ x: 300, y: 40 });
    expect(updates.ir?.metadata?.qualityReview).toBeUndefined();
  });

  it('un texto equivalente no reescribe el IR', () => {
    const same = 'graph LR\n  api[API] -->|lee| db[Base de datos]\n  cliente[Cliente] -->|llama| api';
    expect(withDiagramContent(artifact(), same)).toEqual({ content: same });
  });

  it('un texto que no es un diagrama se guarda como antes, sin tocar el IR', () => {
    expect(withDiagramContent(artifact(), 'esto no es mermaid')).toEqual({ content: 'esto no es mermaid' });
  });

  it('un documento, o un diagrama sin IR guardado, sólo lleva el texto', () => {
    expect(withDiagramContent(artifact({ representation: 'document', type: 'markdown' }), '# x')).toEqual({ content: '# x' });
    expect(withDiagramContent(artifact({ ir: undefined }), rewritten)).toEqual({ content: rewritten });
  });
});
