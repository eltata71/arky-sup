/**
 * The canvas's actions on the keyboard and in the command palette (12.5).
 *
 * The toolbar's inventory (`canvasIntents`) is the single list: the shortcuts
 * fire the same `run` the button does, and ⌘K lists every action under its
 * intent. The palette used to carry its own storytelling copy of five of them
 * with its own handlers — two lists that only agree while someone remembers
 * both.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useOptionalRegisterCommands, type Command } from '../../context/CommandPaletteContext';
import {
  CANVAS_ACTION_PLACEMENT,
  CANVAS_SHORTCUTS,
  actionForShortcut,
  type CanvasActionId,
} from '../../components/artifacts/toolbar/canvasIntents';
import type { CanvasAction } from '../../components/artifacts/toolbar/canvasActions';
import { useUiText } from '../useUiText';

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && typeof el.tagName === 'string' && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

export function useCanvasActionCommands(actions: CanvasAction[]): void {
  const t = useUiText();
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const id = actionForShortcut(event);
      if (!id) return;
      // Leaving edit mode is the one shortcut that has to work from inside the editor.
      if (id !== 'edit' && isTyping(event.target)) return;
      const action = latest.current.find((candidate) => candidate.id === id);
      if (!action || action.disabled) return;
      event.preventDefault();
      action.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The palette compares registrations by identity: rebuild only when what it shows changes.
  const signature = actions.map((a) => `${a.id}|${a.label}|${a.description ?? ''}|${a.disabled ? 1 : 0}|${a.active ? 1 : 0}`).join('\n');
  const commands = useMemo<Command[]>(() => latest.current.map((action) => {
    const intent = CANVAS_ACTION_PLACEMENT[action.id].intent;
    return {
      id: `canvas.${action.id}`,
      section: t('canvas.palette.section', { intent: t(`canvas.intent.${intent}`) }),
      title: action.label,
      subtitle: action.description,
      shortcut: CANVAS_SHORTCUTS[action.id as CanvasActionId]?.label,
      icon: action.icon,
      disabled: action.disabled,
      run: () => latest.current.find((candidate) => candidate.id === action.id)?.run(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the dependency; `latest` is a ref.
  }), [signature, t]);
  useOptionalRegisterCommands(commands);
}
