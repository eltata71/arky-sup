import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Artifact } from '../../lib/artifacts';

export interface UseArtifactEditingResult {
  isEditMode: boolean;
  editedContent: string;
  setEditedContent: Dispatch<SetStateAction<string>>;
  /** Enter edit mode, seeding the editor with the current artifact content. */
  enterEditMode: () => void;
  exitEditMode: () => void;
  /** Toggle edit mode; re-seeds the editor when entering. */
  toggleEditMode: () => void;
}

/**
 * Owns the raw-content editing state for the artifact canvas: the edit-mode
 * flag plus the working copy of the artifact content. Re-seeds the working
 * copy whenever the active artifact (or its content) changes.
 */
export const useArtifactEditing = (artifact: Artifact): UseArtifactEditingResult => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState(artifact.content);

  useEffect(() => {
    setEditedContent(artifact.content);
  }, [artifact.id, artifact.content]);

  const enterEditMode = useCallback(() => {
    setEditedContent(artifact.content);
    setIsEditMode(true);
  }, [artifact.content]);

  const exitEditMode = useCallback(() => setIsEditMode(false), []);

  const toggleEditMode = useCallback(() => {
    setIsEditMode((prev) => {
      if (!prev) setEditedContent(artifact.content);
      return !prev;
    });
  }, [artifact.content]);

  return { isEditMode, editedContent, setEditedContent, enterEditMode, exitEditMode, toggleEditMode };
};
