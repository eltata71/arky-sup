/**
 * An attention always belongs to an initiative.
 *
 * `CLAUDE.md` has said so since the hierarchy was written, and until now the
 * only thing enforcing it was `AttentionInitiativeGate.tsx`. That held because
 * there were exactly two callers and both went through the gate — the rule was
 * one `addProject` call away from being lost, and losing it is silent: the
 * portfolio graph *reports* `orphan-attention` rather than refusing it, so the
 * damage shows up as a data-quality finding weeks later.
 *
 * These are the assertions that make the rule unavoidable rather than
 * conventional. The interesting one is the last block: not "the factory
 * rejects" but "there is no other way in".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createArchitectureProject, newProjectView } from '../../services/architectureProjects';
import { toProjectDocument } from '../../services/architectureProjects/projectDocumentMapper';

const validInput = {
  name: 'Modernización de siniestros',
  description: 'Reemplazar el core de siniestros de salud',
  initiativeIds: ['ini-1'],
};

describe('an attention cannot be created without an initiative', () => {
  it('refuses an empty list', () => {
    const result = createArchitectureProject({ ...validInput, initiativeIds: [] });

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') throw new Error('unreachable');
    expect(result.rejection.reason).toBe('initiative-required');
    // The message is what the user reads, so it says what to do.
    expect(result.rejection.message).toContain('iniciativa');
  });

  it('refuses a list of blanks, which is an empty list with extra steps', () => {
    const result = createArchitectureProject({ ...validInput, initiativeIds: ['', '   '] });

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') throw new Error('unreachable');
    expect(result.rejection.reason).toBe('initiative-required');
  });

  it('refuses a project with no name', () => {
    const result = createArchitectureProject({ ...validInput, name: '   ' });

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') throw new Error('unreachable');
    expect(result.rejection.reason).toBe('name-required');
  });

  it('creates one when the initiative is there', () => {
    const result = createArchitectureProject(validInput);

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project.initiativeIds).toEqual(['ini-1']);
    expect(result.project.id).toMatch(/^proj_/);
  });
});

describe('the root carries no artifacts (F4-04, ADR-106 §6)', () => {
  it('builds a root, never a read model', () => {
    const result = createArchitectureProject(validInput);
    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project).not.toHaveProperty('artifacts');
    expect(result.project).not.toHaveProperty('artifactIndex');
    expect(result.project).not.toHaveProperty('artifactCount');
  });

  it('turns a new root into a loaded, empty view', () => {
    const result = createArchitectureProject(validInput);
    if (result.outcome !== 'created') throw new Error('unreachable');
    const view = newProjectView(result.project);
    expect(view.artifacts).toEqual([]);
    expect(view.artifactsLoaded).toBe(true);
    expect(view.artifactIndex).toEqual([]);
    expect(view.artifactCount).toBe(0);
    expect(view.id).toBe(result.project.id);
  });

  it('never writes the derived fields, even when handed a full view', () => {
    const result = createArchitectureProject(validInput);
    if (result.outcome !== 'created') throw new Error('unreachable');
    const view = { ...newProjectView(result.project), revision: 7 };
    const document = toProjectDocument(view) as unknown as Record<string, unknown>;
    for (const derived of ['artifacts', 'artifactIndex', 'artifactCount', 'artifactsLoaded', 'revision', 'architectureKnowledgeGraph']) {
      expect(document).not.toHaveProperty(derived);
    }
    expect(document.name).toBe(validInput.name);
  });
});

describe('what the factory builds', () => {
  it('deduplicates the links, so a picker that fires twice does not double them', () => {
    const result = createArchitectureProject({
      ...validInput,
      initiativeIds: ['ini-1', 'ini-1', 'ini-2'],
      linkedBusinessProjects: ['NEG-2026-001', 'NEG-2026-001'],
    });

    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project.initiativeIds).toEqual(['ini-1', 'ini-2']);
    expect(result.project.linkedBusinessProjects).toEqual(['NEG-2026-001']);
  });

  it('captures the description and the context notes as the initial capture', () => {
    const result = createArchitectureProject({
      ...validInput,
      projectContext: ['Regulación local exige retención de 7 años', '  '],
    });

    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project.initialCapture).toEqual([
      'Descripción inicial del proyecto: Reemplazar el core de siniestros de salud',
      'Regulación local exige retención de 7 años',
    ]);
    // Blank entries are dropped rather than stamped with author and date.
    expect(result.project.projectContext).toEqual(['Regulación local exige retención de 7 años']);
  });

  it('stamps every captured note with who wrote it', () => {
    const result = createArchitectureProject({
      ...validInput,
      projectContext: ['Una nota'],
      author: { authorId: 'u-1', authorName: 'Ana' },
    });

    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project.projectContextEntries?.[0]).toMatchObject({ authorId: 'u-1', authorName: 'Ana' });
  });

  it('leaves the optional collections undefined rather than empty', () => {
    // An empty array and "nothing was captured" are different facts, and
    // Firestore stores the difference.
    const result = createArchitectureProject({ name: 'Sin notas', initiativeIds: ['ini-1'] });

    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project.initialCapture).toBeUndefined();
    expect(result.project.projectContextEntries).toBeUndefined();
  });

  it('opens with createdAt equal to updatedAt', () => {
    const result = createArchitectureProject({ ...validInput, now: () => '2026-09-02T00:00:00.000Z' });

    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.project.createdAt).toBe('2026-09-02T00:00:00.000Z');
    expect(result.project.updatedAt).toBe(result.project.createdAt);
  });
});

/**
 * Where project creation actually lives. `AppContext.tsx` is composition only
 * since Wave 4: the writes are in `useProjectsState` and the published surface
 * is `appContextTypes`. These constants exist so the next move re-points one
 * line instead of leaving the guard reading an empty file and passing.
 */
const PROJECT_WRITES = 'context/app/useProjectsState.ts';
const CONTEXT_SURFACE = 'context/app/appContextTypes.ts';

describe('the factory is the only way in', () => {
  // The rule is worth nothing if a second construction site appears. These
  // read the source rather than the behaviour, because that is where the
  // regression would be: someone assembling a `Project` literal by hand.

  it('the projects hook builds no project of its own', () => {
    const source = readFileSync(PROJECT_WRITES, 'utf8');
    expect(source).toContain('createArchitectureProject');
    // The old inline construction, which is what this replaced.
    expect(source).not.toMatch(/const newProject:\s*Project\s*=\s*\{/);
  });

  it('the context exposes the verdict, not a project', () => {
    const source = readFileSync(CONTEXT_SURFACE, 'utf8');
    expect(source).toContain('addProject: (input: CreateArchitectureProjectInput) => CreateArchitectureProjectResult;');
  });

  it('nothing fills the initiative in on the way to creating a project', () => {
    // Scoped to the hook that creates projects. Reading a
    // legacy project's `initiativeIds ?? []` elsewhere is correct — the field
    // is genuinely optional on records that predate the link. What must never
    // return is a *default* supplied at creation time.
    const source = readFileSync(PROJECT_WRITES, 'utf8');
    expect(source).not.toContain('initiativeIds ?? []');
    expect(source).not.toContain('initiativeIds || []');
    expect(source).not.toContain("Partial<Pick<Project, 'initiativeIds'");
  });
});
