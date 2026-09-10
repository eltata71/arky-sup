/**
 * Open an attention from the UI, and say why when it cannot be opened.
 *
 * `AppContext.addProject` returns the factory's verdict rather than a
 * `Project`, because an attention without an initiative is refused instead of
 * created as an orphan. Every creation surface needs the same two lines around
 * that, and the whole point of the finding this closes is that there will be a
 * third surface: the agent, a bulk import, a template gallery. One place that
 * knows how a refusal reaches the user is what keeps the third one from
 * inventing its own answer — or from not handling it at all.
 *
 * `components/attentions/AttentionInitiativeGate.tsx` normally makes the
 * refusal unreachable, and should stay: asking for the initiative up front is
 * better UX than refusing afterwards. This is the defence that does not depend
 * on a screen being mounted.
 */
import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type { CreateArchitectureProjectInput, Project } from '../services/architectureProjects';

export type CreateAttention = (input: CreateArchitectureProjectInput) => Project | null;

/**
 * Returns a creator that yields the project, or `null` after telling the user
 * why not. `null` rather than a thrown error: a caller that forgets to check
 * gets a type error at the next property access, which is where the mistake
 * actually is.
 */
export const useCreateAttention = (): CreateAttention => {
  const { addProject } = useAppContext();
  const { addToast } = useToast();

  return useCallback((input: CreateArchitectureProjectInput): Project | null => {
    const created = addProject(input);
    if (created.outcome === 'rejected') {
      addToast(created.rejection.message, 'error');
      return null;
    }
    return created.project;
  }, [addProject, addToast]);
};
