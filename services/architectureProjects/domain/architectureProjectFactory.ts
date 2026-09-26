/**
 * The only way to build a Proyecto de Arquitectura.
 *
 * `CLAUDE.md` states the rule plainly: the parent levels are mandatory at
 * creation, and an attention that exists even momentarily without an initiative
 * is the `orphan-attention` the portfolio graph reports. The rule was real; its
 * enforcement was not. `AppContext.addProject` declared
 * `Partial<Pick<Project, 'initiativeIds'>>` and filled the gap with `[]`, so
 * the only thing standing between the product and an orphan was
 * `components/attentions/AttentionInitiativeGate.tsx` — a React component.
 *
 * That worked because there were exactly two callers and both went through the
 * gate. The third one anybody writes — from the agent, a bulk import, a
 * template — would have created orphans in silence, and the system would have
 * *reported* them (`portfolioResolver.ts`) instead of having *refused* them.
 *
 * An invariant that lives outside the aggregate is not an invariant; it is a
 * convention of one screen. So it lives here, the factory is the only
 * constructor, and a caller that omits the initiative gets a typed refusal it
 * has to handle rather than a project that looks fine.
 */

import { newPrefixedId } from '../../../lib/ids';
import { createMemoryEntry } from '../../memory';
import type { MemoryEntry } from '../../../types';
import type { Project, ProjectRoot } from './ArchitectureProjectTypes';
import { toProjectView } from './projectDocumentMapper';

/** Why a project could not be created. One case today; the shape is the point. */
export type ArchitectureProjectRejection =
  | {
      readonly reason: 'initiative-required';
      /** Ready to show. The caller decides where. */
      readonly message: string;
    }
  | {
      readonly reason: 'name-required';
      readonly message: string;
    };

/**
 * The verdict. A string discriminant rather than a boolean `ok`: this
 * repository compiles without `strictNullChecks` for most of its tree, and a
 * boolean literal does not narrow reliably there — the compiler kept offering
 * the whole union inside `if (!result.ok)`. `outcome` narrows, and reads better
 * at the call site besides.
 */
export type CreateArchitectureProjectResult =
  | { readonly outcome: 'created'; readonly project: ProjectRoot }
  | { readonly outcome: 'rejected'; readonly rejection: ArchitectureProjectRejection };

export interface CreateArchitectureProjectInput {
  readonly name: string;
  readonly description?: string;
  readonly projectContext?: readonly string[];
  /**
   * The initiatives this attention responds to. **Required, and non-empty.**
   *
   * Not `initiativeIds?: string[]`: an optional field with a `?? []` fallback
   * is how the rule was lost the first time. A caller that does not have an
   * initiative has to say so and be refused.
   */
  readonly initiativeIds: readonly string[];
  /** The `NEG-YYYY-NNN` codes of those same initiatives — a derived mirror. */
  readonly linkedBusinessProjects?: readonly string[];
  /** Who is creating it, for the structured metadata on captured notes. */
  readonly author?: { readonly authorId: string | null; readonly authorName: string | null };
  /** Seam for tests and for a caller that assigns its own id. */
  readonly id?: string;
  /** Seam for tests. Defaults to now. */
  readonly now?: () => string;
}

const NO_AUTHOR = { authorId: null, authorName: null };

const cleanEntries = (values: readonly string[] | undefined): string[] =>
  (values ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

/**
 * Build a Proyecto de Arquitectura, or refuse to.
 *
 * Returns a result rather than throwing: an omitted initiative is a normal
 * outcome the UI has to render, not an exceptional one, and a `throw` here
 * would push every caller into a `try`/`catch` that most would write as an
 * empty one.
 */
export function createArchitectureProject(
  input: CreateArchitectureProjectInput,
): CreateArchitectureProjectResult {
  const name = input.name?.trim() ?? '';
  if (!name) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'name-required',
        message: 'Una atención necesita un nombre para poder identificarla.',
      },
    };
  }

  const initiativeIds = [...new Set(cleanEntries(input.initiativeIds))];
  if (initiativeIds.length === 0) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'initiative-required',
        message:
          'Una atención siempre responde a una iniciativa de negocio. Vincula al menos una antes de crearla.',
      },
    };
  }

  const now = input.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const author = input.author ?? NO_AUTHOR;

  const description = input.description?.trim() ?? '';
  const projectContext = cleanEntries(input.projectContext);

  // What the project knew at the moment it was opened: the description first,
  // then every context note, each stamped with when and by whom.
  const initialCapture = [
    ...(description ? [`Descripción inicial del proyecto: ${description}`] : []),
    ...projectContext,
  ];

  const stamp = (text: string): MemoryEntry => createMemoryEntry(text, author);

  return {
    outcome: 'created',
    project: {
      id: input.id ?? newPrefixedId('proj'),
      name,
      description,
      projectContext,
      initiativeIds,
      linkedBusinessProjects: [...new Set(cleanEntries(input.linkedBusinessProjects))],
      projectContextEntries: projectContext.length > 0 ? projectContext.map(stamp) : undefined,
      initialCapture: initialCapture.length > 0 ? initialCapture : undefined,
      initialCaptureEntries: initialCapture.length > 0 ? initialCapture.map(stamp) : undefined,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

/**
 * La primera vista de un proyecto recién creado: sin artefactos, y sabiéndolo
 * (F4-04).
 *
 * La fábrica construye la **raíz**; esto es lo que la pantalla muestra de ella
 * mientras la escritura viaja. Vive aquí, al lado de donde nace el proyecto,
 * para que el proveedor del arranque la obtenga sin entrar por otro fichero.
 */
export const newProjectView = (root: ProjectRoot): Project =>
  toProjectView(root, [], { artifactsLoaded: true, artifactIndex: [] }, 0);
