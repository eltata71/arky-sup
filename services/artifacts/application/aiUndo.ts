/**
 * Deshacer un cambio de la IA (10.4): una regla pura y un almacén diminuto.
 *
 * Todo cambio de la IA ya es una versión nueva, así que deshacer no borra
 * nada: **crea otra versión con el contenido de la anterior**. Eso mantiene el
 * historial lineal y hace que deshacer también se pueda deshacer.
 *
 * La regla que importa: sólo se deshace mientras la versión que produjo la IA
 * siga siendo la última de su grupo. Si alguien editó después, restaurar la
 * anterior descartaría ese trabajo sin avisar — se informa y no se hace.
 */

import type { Artifact } from '../../../lib/artifacts';

export interface AiUndoStep {
  /** La versión que había antes del cambio de la IA. */
  readonly before: Artifact;
  /** La versión que produjo la IA. */
  readonly producedId: string;
}

export interface AiUndoEntry {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly steps: readonly AiUndoStep[];
  /** Se llama con las versiones nuevas, para que la pantalla pase a mostrarlas. */
  readonly onUndone?: (restored: readonly Artifact[]) => void;
}

export type AiUndoPlan =
  | { readonly kind: 'restore'; readonly drafts: readonly Artifact[] }
  | { readonly kind: 'superseded'; readonly reason: string }
  | { readonly kind: 'missing'; readonly reason: string };

let sequence = 0;

export const createAiUndoEntry = (input: Omit<AiUndoEntry, 'id'>): AiUndoEntry => {
  sequence += 1;
  return { ...input, id: `ai-undo-${sequence}` };
};

export const planAiUndo = (entry: AiUndoEntry, artifacts: readonly Artifact[]): AiUndoPlan => {
  const drafts: Artifact[] = [];
  for (const step of entry.steps) {
    const produced = artifacts.find((artifact) => artifact.id === step.producedId);
    if (!produced) {
      return { kind: 'missing', reason: 'El artefacto ya no existe, no hay nada que deshacer.' };
    }
    const latest = artifacts
      .filter((artifact) => artifact.versionGroupId === produced.versionGroupId)
      .reduce((top, artifact) => (artifact.version > top ? artifact.version : top), 0);
    if (produced.version !== latest) {
      return {
        kind: 'superseded',
        reason: 'Hay cambios posteriores a este: restaura la versión que quieras desde el historial.',
      };
    }
    drafts.push(step.before);
  }
  return drafts.length === 0
    ? { kind: 'missing', reason: 'No hay ningún cambio de la IA que deshacer.' }
    : { kind: 'restore', drafts };
};

export interface AiUndoStore {
  readonly get: () => AiUndoEntry | null;
  readonly set: (entry: AiUndoEntry) => void;
  readonly clear: (id?: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Guarda sólo el último cambio: el atajo global deshace «lo último que hizo la IA». */
export const createAiUndoStore = (): AiUndoStore => {
  let current: AiUndoEntry | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    get: () => current,
    set: (entry) => { current = entry; emit(); },
    clear: (id) => {
      if (current && (id === undefined || current.id === id)) { current = null; emit(); }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
};

export const aiUndoStore: AiUndoStore = createAiUndoStore();
