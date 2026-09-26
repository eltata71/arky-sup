/**
 * Lo que se le puede hacer a un Proyecto de Arquitectura, con nombre (F6-03,
 * corte 2b).
 *
 * Hasta aquí había una sola operación: `updateProject(id, patch)`, con un
 * `Partial<Project>` que cualquier pantalla podía rellenar como quisiera. Doce
 * llamadas escribían parches libres, y nada impedía que una dejara un proyecto
 * **sin iniciativa**: la regla P-02 la aplicaba la fábrica al crear y el
 * servidor al guardar, pero entre las dos, la pantalla. Con un parche no hay
 * sitio donde poner una regla, porque no se sabe qué se quiso hacer.
 *
 * Cada comando dice qué se quiso hacer, y `applyProjectCommand` decide si se
 * puede y qué cambia. Devuelve un rechazo tipado —nunca lanza— o los cambios a
 * guardar. Si el comando no cambia nada, lo dice (`changed: false`) en vez de
 * escribir una revisión nueva por nada.
 *
 * Es el patrón de Iniciativas (`applyInitiativeCommand`, F3-05). Puro: sin
 * E/S, sin React, y con el reloj por parámetro.
 *
 * Lo que **no** es un comando sobre la raíz: el grafo de conocimiento. Es una
 * proyección derivada con su propia tabla, revisión y ruta de escritura
 * (`saveProjectGraph`). Guardarlo reescribía la raíz del proyecto y movía su
 * revisión sin que el proyecto cambiara.
 */
import type { MemoryEntry } from '../../../types';
import type { PublicationPackage } from '../../publicationPipeline';
import { toInitiativeCodes } from '../../../lib/eaTerminology';
import type { ProjectAttentionTracking, ProjectRoot } from './ArchitectureProjectTypes';
import { normalizeAttentionTracking } from './projectRuntimeValidation';

/** Las tres memorias de un proyecto, cada una con su lista de entradas. */
export type ProjectMemoryArea = 'projectContext' | 'agentMemory' | 'initialCapture';

export type ProjectCommand =
  | { readonly kind: 'rename'; readonly name: string }
  | { readonly kind: 'describe'; readonly description: string }
  | { readonly kind: 'add-context-entry'; readonly entry: string }
  | { readonly kind: 'remove-context-entry'; readonly entry: string }
  | {
    readonly kind: 'replace-memory';
    readonly area: ProjectMemoryArea;
    readonly texts: readonly string[];
    readonly entries?: readonly MemoryEntry[];
  }
  | { readonly kind: 'update-tracking'; readonly tracking: ProjectAttentionTracking }
  | { readonly kind: 'link-initiatives'; readonly initiativeIds: readonly string[]; readonly codes?: readonly string[] }
  | { readonly kind: 'set-publication-packages'; readonly packages: readonly PublicationPackage[] };

export type ProjectCommandKind = ProjectCommand['kind'];

export interface ProjectCommandRejection {
  readonly reason: 'empty-name' | 'empty-context-entry' | 'no-initiative' | 'invalid-tracking';
  readonly message: string;
}

/** Los campos de la raíz que un comando puede cambiar. Ni la identidad ni la revisión. */
export type ProjectRootChanges = Partial<Omit<ProjectRoot, 'id' | 'createdAt' | 'revision'>>;

export type ProjectCommandResult =
  | { readonly ok: true; readonly changed: boolean; readonly changes: ProjectRootChanges }
  | { readonly ok: false; readonly rejection: ProjectCommandRejection };

const reject = (reason: ProjectCommandRejection['reason'], message: string): ProjectCommandResult =>
  ({ ok: false, rejection: { reason, message } });

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const MEMORY_ENTRIES_FIELD = {
  projectContext: 'projectContextEntries',
  agentMemory: 'agentMemoryEntries',
  initialCapture: 'initialCaptureEntries',
} as const satisfies Record<ProjectMemoryArea, keyof ProjectRoot>;

/** Los cambios de un comando, o su rechazo. Sin fecha: la pone `applyProjectCommand`. */
const decide = (project: ProjectRoot, command: ProjectCommand): ProjectCommandResult => {
  switch (command.kind) {
    case 'rename': {
      const name = command.name.trim();
      if (!name) return reject('empty-name', 'Un proyecto de arquitectura tiene nombre.');
      return { ok: true, changed: name !== project.name, changes: { name } };
    }
    case 'describe': {
      const description = command.description.trim();
      return { ok: true, changed: description !== project.description, changes: { description } };
    }
    case 'add-context-entry': {
      const entry = command.entry.trim();
      if (!entry) return reject('empty-context-entry', 'Una entrada de contexto vacía no dice nada.');
      // Añadirla dos veces no añade información; quitarla quitaría las dos.
      if (project.projectContext.includes(entry)) return { ok: true, changed: false, changes: {} };
      return { ok: true, changed: true, changes: { projectContext: [...project.projectContext, entry] } };
    }
    case 'remove-context-entry': {
      const projectContext = project.projectContext.filter((item) => item !== command.entry);
      return { ok: true, changed: projectContext.length !== project.projectContext.length, changes: { projectContext } };
    }
    case 'replace-memory': {
      const texts = [...command.texts];
      const changes: ProjectRootChanges = { [command.area]: texts };
      if (command.entries) changes[MEMORY_ENTRIES_FIELD[command.area]] = [...command.entries];
      const changed = !same(project[command.area] ?? [], texts)
        || (command.entries !== undefined && !same(project[MEMORY_ENTRIES_FIELD[command.area]] ?? [], command.entries));
      return { ok: true, changed, changes };
    }
    case 'update-tracking': {
      const attention = normalizeAttentionTracking(command.tracking);
      if (!attention) return reject('invalid-tracking', 'El seguimiento no tiene una forma válida.');
      return { ok: true, changed: !same(project.attention, attention), changes: { attention } };
    }
    case 'link-initiatives': {
      // P-02: la regla que la fábrica aplica al crear también se aplica al
      // cambiar los vínculos. Quitar la última iniciativa dejaría un proyecto
      // que no responde a ninguna necesidad — el `orphan-attention` del grafo.
      const initiativeIds = [...new Set(command.initiativeIds.map((id) => id.trim()).filter(Boolean))];
      if (initiativeIds.length === 0) {
        return reject('no-initiative', 'Un proyecto de arquitectura responde al menos a una iniciativa de negocio.');
      }
      const linkedBusinessProjects = toInitiativeCodes(command.codes ?? project.linkedBusinessProjects ?? []);
      const changed = !same(project.initiativeIds ?? [], initiativeIds)
        || !same(project.linkedBusinessProjects ?? [], linkedBusinessProjects);
      return { ok: true, changed, changes: { initiativeIds, linkedBusinessProjects } };
    }
    case 'set-publication-packages': {
      const publicationPackages = [...command.packages];
      return { ok: true, changed: !same(project.publicationPackages ?? [], publicationPackages), changes: { publicationPackages } };
    }
  }
};

/**
 * Aplica un comando a un proyecto. Devuelve los cambios a guardar, con su fecha,
 * o un rechazo tipado. Un comando que no cambia nada devuelve `changed: false` y
 * ningún cambio: no hay nada que escribir.
 */
export function applyProjectCommand(
  project: ProjectRoot,
  command: ProjectCommand,
  options: { readonly now?: string } = {},
): ProjectCommandResult {
  const decision = decide(project, command);
  if (!decision.ok || !decision.changed) return decision.ok ? { ok: true, changed: false, changes: {} } : decision;
  return {
    ok: true,
    changed: true,
    changes: { ...decision.changes, updatedAt: options.now ?? new Date().toISOString() },
  };
}
