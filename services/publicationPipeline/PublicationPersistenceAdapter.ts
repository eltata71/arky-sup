/**
 * Persistence adapter for publication packages (Task 18).
 *
 * Publication packages persist additively on `Project.publicationPackages`.
 * This adapter owns the (de)serialisation boundary:
 *  - `serialize`   — packages are already plain JSON, so this only sanitises;
 *  - `deserialize` — runs runtime validation, dropping corrupt packages while
 *    preserving every valid one (no destructive migration);
 *  - `read` / `attach` — read packages off a project / attach them back.
 *
 * The strategy is intentionally a single project-document field today, behind
 * helpers that a future Firestore subcollection can adopt without touching
 * callers. Every function is total — it never throws.
 */

/**
 * El registro que lleva los paquetes. Un puerto y no `Project`: el proyecto
 * importa este adaptador para leer sus paquetes, así que éste no puede
 * importarlo de vuelta (F3-07).
 */
export interface PublicationPackageHost {
  publicationPackages?: PublicationPackage[];
}
import { observabilityService } from '../observability';
import { validatePublicationPackages } from './PublicationRuntimeValidation';
import type { PublicationPackage } from './PublicationPipelineTypes';

/** The project-document field publication packages persist on. */
export const PUBLICATION_PACKAGES_PROJECT_FIELD = 'publicationPackages' as const;

/** Path of the future Firestore subcollection (not yet used by the adapter). */
export const getPublicationSubcollectionPath = (projectId: string): string =>
  `projects/${projectId}/publicationPackages`;

/**
 * Serialise packages for persistence. They are already JSON-safe; this pass
 * round-trips them through `JSON` to strip any accidental non-serialisable
 * values (functions, `undefined` holes, cyclic refs) before they hit Firestore.
 */
export const serializePublicationPackages = (
  packages: PublicationPackage[],
): PublicationPackage[] => {
  try {
    return JSON.parse(JSON.stringify(packages)) as PublicationPackage[];
  } catch {
    return [];
  }
};

/**
 * Deserialise + runtime-validate packages read from persistence. Corrupt
 * packages are dropped (with an observability warning); valid ones survive.
 */
export const deserializePublicationPackages = (raw: unknown): PublicationPackage[] => {
  const result = validatePublicationPackages(raw);
  if (result.issues.length > 0) {
    observabilityService.recordWarning({
      source: 'operation',
      title: 'Paquetes de publicación con datos corruptos',
      message: `Se descartaron o repararon ${result.issues.length} problema(s) al cargar paquetes de publicación.`,
      metadata: { issueCount: result.issues.length },
      recoverable: true,
      userVisible: false,
    });
  }
  return result.value ?? [];
};

/** Read the validated publication packages off a project. */
export const readPublicationPackages = (project: PublicationPackageHost): PublicationPackage[] =>
  deserializePublicationPackages(project.publicationPackages);

/** Return a NEW project with the given packages attached (serialised). */
export const attachPublicationPackages = <T extends PublicationPackageHost>(
  project: T,
  packages: PublicationPackage[],
): T => ({
  ...project,
  publicationPackages: serializePublicationPackages(packages),
});

/** Insert or replace a package in a list by id, returning a NEW list. */
export const upsertPublicationPackage = (
  packages: PublicationPackage[],
  pkg: PublicationPackage,
): PublicationPackage[] => {
  const index = packages.findIndex((p) => p.id === pkg.id);
  if (index === -1) return [...packages, pkg];
  const next = [...packages];
  next[index] = pkg;
  return next;
};

/** Remove a package from a list by id, returning a NEW list. */
export const removePublicationPackage = (
  packages: PublicationPackage[],
  packageId: string,
): PublicationPackage[] => packages.filter((p) => p.id !== packageId);

/** Build the additive project-update payload for a package change. */
export const buildPublicationUpdatePayload = (
  packages: PublicationPackage[],
): Required<PublicationPackageHost> => ({
  publicationPackages: serializePublicationPackages(packages),
});
