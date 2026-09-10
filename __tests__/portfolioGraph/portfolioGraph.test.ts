import { describe, expect, it } from 'vitest';
import {
  codesForInitiativeIds,
  pathTo,
  relatedTo,
  resolvePortfolioGraph,
  searchPortfolio,
} from '../../services/portfolioGraph';
import { buildInitiative, type BusinessInitiative } from '../../services/businessInitiatives';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/OfficeTypes';
import type { Artifact, Project } from '../../types';

const NOW = '2026-08-27T12:00:00.000Z';

const initiative = (code: string, title: string, overrides: Partial<BusinessInitiative> = {}) => ({
  ...buildInitiative({ title, need: 'Necesidad', code }, 'user-1', [], NOW),
  ...overrides,
});

const artifact = (id: string, name: string, group = id): Artifact => ({
  id, name, versionGroupId: group, version: 1,
} as Artifact);

const project = (overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project => ({
  description: '', projectContext: [], artifacts: [], createdAt: NOW, updatedAt: NOW, ...overrides,
});

const task = (overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id'>): OfficeTask => ({
  engagementId: 'e1', kind: 'produce-artifact', title: overrides.id, objective: '',
  assigneeId: 'felipe', dependsOn: [], acceptanceCriteria: [], attempts: 1, maxAttempts: 2,
  status: 'completed', ...overrides,
});

const engagement = (
  overrides: Partial<OfficeEngagement> & Pick<OfficeEngagement, 'id' | 'projectId'>,
): OfficeEngagement => ({
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: overrides.id, brief: 'b',
  initiativeIds: [], businessProjectIds: [],
  priority: 'medium', status: 'in-progress',
  charter: {
    kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [],
    regulatoryDrivers: [], deliverables: [], participantIds: [],
    coordinatorId: 'lucia', consolidatorId: 'alejandro',
    provenance: 'deterministic', proposedAt: NOW,
  },
  tasks: [], arbDecisions: [], budget: { ...DEFAULT_OFFICE_BUDGET }, auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR, createdAt: NOW, updatedAt: NOW,
  ...overrides,
});

describe('resolvePortfolioGraph — relations are keys', () => {
  const need = initiative('NEG-2026-001', 'Auto aprobación');

  it('links an attention to its initiative by id', () => {
    const graph = resolvePortfolioGraph(
      [need],
      [project({ id: 'p1', name: 'Plataforma', initiativeIds: [need.id] })],
      [],
    );
    expect(graph.initiatives[0].attentions.map((a) => a.id)).toEqual(['p1']);
    expect(graph.attentions[0].initiativeIds).toEqual([need.id]);
    expect(graph.issues).toEqual([]);
  });

  it('migrates a legacy code link in memory, so it keeps working unsaved', () => {
    const graph = resolvePortfolioGraph(
      [need],
      [project({ id: 'p1', name: 'Plataforma', linkedBusinessProjects: ['NEG-2026-001'] })],
      [],
    );
    expect(graph.attentions[0].initiativeIds).toEqual([need.id]);
    expect(graph.initiatives[0].attentions).toHaveLength(1);
    expect(graph.issues).toEqual([]);
  });

  it('lets the id win over a stale code that disagrees with it', () => {
    const other = initiative('NEG-2026-002', 'Otra');
    const graph = resolvePortfolioGraph(
      [need, other],
      [project({
        id: 'p1', name: 'Plataforma',
        initiativeIds: [need.id],
        linkedBusinessProjects: ['NEG-2026-002'],
      })],
      [],
    );
    // The code is a mirror, not a second source of truth.
    expect(graph.attentions[0].initiativeIds).toEqual([need.id]);
  });

  it('reports a dangling id instead of dropping the record', () => {
    const graph = resolvePortfolioGraph(
      [],
      [project({ id: 'p1', name: 'Plataforma', initiativeIds: ['init_borrada'] })],
      [],
    );
    expect(graph.attentions).toHaveLength(1);
    expect(graph.attentions[0].initiativeIds).toEqual([]);
    const issue = graph.issues.find((item) => item.kind === 'dangling-initiative');
    expect(issue?.reference).toBe('init_borrada');
    expect(issue?.sourceName).toBe('Plataforma');
  });

  it('reports a code that matches no registered initiative', () => {
    const graph = resolvePortfolioGraph(
      [need],
      [project({ id: 'p1', name: 'Plataforma', linkedBusinessProjects: ['NEG-2026-099'] })],
      [],
    );
    expect(graph.issues.some((item) => item.kind === 'unresolved-code')).toBe(true);
  });

  it('stays quiet about a stale code when a good id already resolved', () => {
    const graph = resolvePortfolioGraph(
      [need],
      [project({
        id: 'p1', name: 'Plataforma',
        initiativeIds: [need.id],
        linkedBusinessProjects: ['NEG-2026-099'],
      })],
      [],
    );
    expect(graph.issues.filter((item) => item.kind === 'unresolved-code')).toEqual([]);
  });

  it('flags an attention with real work and no initiative behind it', () => {
    const graph = resolvePortfolioGraph(
      [],
      [project({ id: 'p1', name: 'Laboratorio', artifacts: [artifact('a1', 'Visión')] })],
      [],
    );
    expect(graph.unlinkedAttentions.map((a) => a.id)).toEqual(['p1']);
    expect(graph.issues.some((item) => item.kind === 'orphan-attention')).toBe(true);
  });

  it('does not scold an empty project — that is a draft, not an orphan', () => {
    const graph = resolvePortfolioGraph([], [project({ id: 'p1', name: 'Vacío' })], []);
    expect(graph.issues).toEqual([]);
    expect(graph.unlinkedAttentions).toHaveLength(1);
  });

  it('reports a deliverable whose attention was deleted', () => {
    const graph = resolvePortfolioGraph([], [], [engagement({ id: 'e1', projectId: 'fantasma' })]);
    expect(graph.deliverables).toHaveLength(0);
    const issue = graph.issues.find((item) => item.kind === 'dangling-attention');
    expect(issue?.reference).toBe('fantasma');
  });

  it('lets a deliverable inherit its attention initiatives when it states none', () => {
    const graph = resolvePortfolioGraph(
      [need],
      [project({ id: 'p1', name: 'Plataforma', initiativeIds: [need.id] })],
      [engagement({ id: 'e1', projectId: 'p1' })],
    );
    expect(graph.deliverables[0].initiativeIds).toEqual([need.id]);
  });

  it('lets a deliverable narrow to a subset of what its attention answers', () => {
    const other = initiative('NEG-2026-002', 'Otra');
    const graph = resolvePortfolioGraph(
      [need, other],
      [project({ id: 'p1', name: 'Plataforma', initiativeIds: [need.id, other.id] })],
      [engagement({ id: 'e1', projectId: 'p1', initiativeIds: [other.id] })],
    );
    expect(graph.deliverables[0].initiativeIds).toEqual([other.id]);
  });

  it('attaches only the artifacts a task actually produced', () => {
    const graph = resolvePortfolioGraph(
      [need],
      [project({
        id: 'p1', name: 'Plataforma', initiativeIds: [need.id],
        artifacts: [artifact('a1', 'Contexto'), artifact('a2', 'Suelto')],
      })],
      [engagement({
        id: 'e1', projectId: 'p1',
        tasks: [task({ id: 't1', producedArtifactId: 'a1' })],
      })],
    );
    expect(graph.deliverables[0].artifacts.map((a) => a.id)).toEqual(['a1']);
    // The loose one still belongs to the attention.
    expect(graph.attentions[0].artifacts.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('keeps only the latest version of each artifact', () => {
    const graph = resolvePortfolioGraph(
      [],
      [project({
        id: 'p1', name: 'Plataforma',
        artifacts: [
          { ...artifact('a1', 'Visión', 'g1'), version: 1 },
          { ...artifact('a2', 'Visión', 'g1'), version: 3 },
        ] as Artifact[],
      })],
      [],
    );
    expect(graph.attentions[0].artifacts.map((a) => a.id)).toEqual(['a2']);
  });

  it('places one attention under every initiative it answers', () => {
    const other = initiative('NEG-2026-002', 'Otra');
    const graph = resolvePortfolioGraph(
      [need, other],
      [project({ id: 'p1', name: 'Compartida', initiativeIds: [need.id, other.id] })],
      [],
    );
    expect(graph.initiatives[0].attentions).toHaveLength(1);
    expect(graph.initiatives[1].attentions).toHaveLength(1);
  });
});

describe('pathTo', () => {
  const need = initiative('NEG-2026-001', 'Auto aprobación');
  const graph = resolvePortfolioGraph(
    [need],
    [project({
      id: 'p1', name: 'Plataforma', initiativeIds: [need.id],
      artifacts: [artifact('a1', 'Contexto C4')],
    })],
    [engagement({
      id: 'e1', projectId: 'p1', title: 'Diagrama C4',
      tasks: [task({ id: 't1', producedArtifactId: 'a1' })],
    })],
  );

  it('walks up to the root from the deepest level', () => {
    const path = pathTo(graph, 'a1');
    expect(path.initiative?.id).toBe(need.id);
    expect(path.attention?.id).toBe('p1');
    expect(path.deliverable?.id).toBe('e1');
    expect(path.artifact?.id).toBe('a1');
  });

  it('stops where the hierarchy stops', () => {
    expect(pathTo(graph, need.id)).toEqual({ initiative: graph.initiatives[0] });
    expect(pathTo(graph, 'desconocido')).toEqual({});
  });
});

describe('searchPortfolio', () => {
  const need = initiative('NEG-2026-001', 'Modernización de siniestros', {
    driver: 'El core AS/400 limita el lanzamiento de productos.',
  });
  const graph = resolvePortfolioGraph(
    [need],
    [
      project({
        id: 'p1', name: 'Core de Siniestros', initiativeIds: [need.id],
        artifacts: [artifact('a1', 'Visión de la Arquitectura')],
      }),
      project({
        id: 'p2', name: 'Laboratorio',
        artifacts: [artifact('a2', 'Visión de la Arquitectura')],
      }),
    ],
    [engagement({ id: 'e1', projectId: 'p1', title: 'Arquitectura objetivo' })],
  );

  it('ignores a query too short to mean anything', () => {
    expect(searchPortfolio(graph, 'a')).toEqual([]);
  });

  it('matches without accents or case, as people actually type', () => {
    expect(searchPortfolio(graph, 'modernizacion').map((hit) => hit.id)).toContain(need.id);
    expect(searchPortfolio(graph, 'SINIESTROS').length).toBeGreaterThan(0);
  });

  it('finds an initiative by its code and says so', () => {
    const [hit] = searchPortfolio(graph, 'NEG-2026-001');
    expect(hit.id).toBe(need.id);
    expect(hit.matchedOn).toBe('code');
  });

  it('finds an initiative by its driver, and reports the match as content', () => {
    const hit = searchPortfolio(graph, 'AS/400').find((item) => item.level === 'initiative');
    expect(hit?.matchedOn).toBe('content');
  });

  it('disambiguates two artifacts with the same name by their path', () => {
    const hits = searchPortfolio(graph, 'Visión de la Arquitectura');
    expect(hits).toHaveLength(2);
    const trails = hits.map((hit) => hit.trail.join(' › '));
    expect(trails).toContain('Modernización de siniestros › Core de Siniestros');
    expect(trails).toContain('Laboratorio');
  });

  it('never repeats the hit inside its own trail', () => {
    const [hit] = searchPortfolio(graph, 'Core de Siniestros');
    expect(hit.trail).not.toContain(hit.name);
  });

  it('ranks by how early the match starts, before level', () => {
    // "Core de Siniestros" matches at index 8; "Modernización de siniestros"
    // at 15. The earlier match is the more likely intent.
    const hits = searchPortfolio(graph, 'siniestros');
    expect(hits[0].name).toBe('Core de Siniestros');
    expect(hits.map((hit) => hit.level)).toContain('initiative');
  });

  it('breaks a genuine tie in favour of the outer level', () => {
    // Both names start with the needle, so the scores tie on position and the
    // level decides — the initiative contains the attention, so it is the more
    // useful answer.
    const tied = initiative('NEG-2026-050', 'Pagos digitales');
    const tiedGraph = resolvePortfolioGraph(
      [tied],
      [project({ id: 'p9', name: 'Pagos digitales', initiativeIds: [tied.id] })],
      [],
    );
    expect(searchPortfolio(tiedGraph, 'Pagos digitales')[0].level).toBe('initiative');
  });

  it('can be restricted to one level', () => {
    const hits = searchPortfolio(graph, 'Visión', { levels: ['artifact'] });
    expect(hits.every((hit) => hit.level === 'artifact')).toBe(true);
  });
});

describe('relatedTo', () => {
  const need = initiative('NEG-2026-001', 'Auto aprobación');
  const graph = resolvePortfolioGraph(
    [need],
    [project({
      id: 'p1', name: 'Plataforma', initiativeIds: [need.id],
      artifacts: [artifact('a1', 'Contexto')],
    })],
    [engagement({
      id: 'e1', projectId: 'p1',
      tasks: [task({ id: 't1', producedArtifactId: 'a1' })],
    })],
  );

  it('walks down from an initiative', () => {
    expect(relatedTo(graph, need.id).map((node) => node.id)).toEqual(['p1']);
  });

  it('walks both ways from the middle', () => {
    expect(relatedTo(graph, 'p1').map((node) => node.id)).toEqual([need.id, 'e1']);
  });

  it('walks up from an artifact to its deliverable and attention', () => {
    expect(relatedTo(graph, 'a1').map((node) => node.id)).toEqual(['e1', 'p1']);
  });

  it('returns nothing for an id that is not in the graph', () => {
    expect(relatedTo(graph, 'fantasma')).toEqual([]);
  });
});

describe('codesForInitiativeIds', () => {
  it('derives the code mirror from the canonical ids', () => {
    const a = initiative('NEG-2026-001', 'A');
    const b = initiative('NEG-2026-002', 'B');
    expect(codesForInitiativeIds([a.id, b.id], [a, b])).toEqual(['NEG-2026-001', 'NEG-2026-002']);
  });

  it('skips an id with no initiative behind it rather than inventing a code', () => {
    const a = initiative('NEG-2026-001', 'A');
    expect(codesForInitiativeIds([a.id, 'init_fantasma'], [a])).toEqual(['NEG-2026-001']);
  });
});
