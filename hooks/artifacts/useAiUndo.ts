import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Artifact } from '../../lib/artifacts';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useAriaAnnouncer } from '../useAriaAnnouncer';
import {
  aiUndoStore,
  createAiUndoEntry,
  planAiUndo,
  type AiUndoEntry,
} from '../../services/artifacts/application/aiUndo';

const projectIdOf = (artifact: Artifact, projects: readonly { id: string; artifacts: readonly Artifact[] }[]): string =>
  projects.find((project) => project.artifacts.some((candidate) => candidate.id === artifact.id))?.id ?? '';

const UNDO_TOAST_MS = 10_000;

export interface OfferAiUndoInput {
  readonly projectId: string;
  readonly label: string;
  readonly steps: AiUndoEntry['steps'];
  readonly onUndone?: AiUndoEntry['onUndone'];
}

/**
 * «Deshacer» para todo cambio de la IA (10.4). La regla es
 * `services/artifacts/application/aiUndo`; aquí sólo vive cuándo ofrecerlo,
 * el aviso y el anuncio para lectores de pantalla.
 */
export function useAiUndo() {
  const { projects, restoreArtifactVersion } = useAppContext();
  const { addToast } = useToast();
  const { announce } = useAriaAnnouncer();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const entry = useSyncExternalStore(aiUndoStore.subscribe, aiUndoStore.get);

  const undoEntry = useCallback((target: AiUndoEntry): boolean => {
    const project = projectsRef.current.find((candidate) => candidate.id === target.projectId);
    const plan = planAiUndo(target, project?.artifacts ?? []);
    if (plan.kind !== 'restore') {
      addToast(plan.reason, 'warning');
      announce(plan.reason, 'assertive');
      aiUndoStore.clear(target.id);
      return false;
    }
    const restored = plan.drafts.map((draft) => restoreArtifactVersion(target.projectId, draft));
    aiUndoStore.clear(target.id);
    target.onUndone?.(restored);
    const message = `Deshecho: ${target.label}. La versión anterior vuelve como versión nueva.`;
    addToast(message, 'info');
    announce(message);
    return true;
  }, [addToast, announce, restoreArtifactVersion]);

  /** Registra el cambio como el último deshacible y avisa con un botón. */
  const offerUndo = useCallback((input: OfferAiUndoInput, message: string) => {
    const created = createAiUndoEntry(input);
    aiUndoStore.set(created);
    addToast(message, 'success', {
      durationMs: UNDO_TOAST_MS,
      action: { label: 'Deshacer', onClick: () => { undoEntry(created); } },
    });
    return created;
  }, [addToast, undoEntry]);

  /** El caso común: una versión nueva sobre un artefacto, y la pantalla pasa a mostrarla o a mostrar la restaurada. */
  const offerVersionUndo = useCallback((
    before: Artifact, produced: Artifact | { id: string }, label: string, message: string,
    show?: (artifactId: string) => void,
  ) => offerUndo({
    projectId: projectIdOf(before, projectsRef.current),
    label,
    steps: [{ before, producedId: produced.id }],
    onUndone: ([restored]) => show?.(restored.id),
  }, message), [offerUndo]);

  const undoLast = useCallback((): boolean => {
    const last = aiUndoStore.get();
    if (!last) {
      announce('No hay ningún cambio de la IA que deshacer.');
      return false;
    }
    return undoEntry(last);
  }, [announce, undoEntry]);

  return { offerUndo, offerVersionUndo, undoLast, canUndo: entry !== null, lastLabel: entry?.label ?? null };
}

/** Atajo global Mod+Alt+Z: no choca con Ctrl+Z del lienzo ni con Mod+Shift+Z de rehacer. */
export function useAiUndoShortcut(): void {
  const { undoLast } = useAiUndo();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return;
      if (event.code !== 'KeyZ') return;
      event.preventDefault();
      undoLast();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLast]);
}

