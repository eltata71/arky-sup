/**
 * The canvas toolbar organised by what the person came to do (12.5).
 *
 * The bar used to group its 26 actions by *where they live in the code* —
 * Navegación, Presentación, Edición, Calidad e IA, Observabilidad,
 * Configuración — so «present this to the committee» meant knowing it sat
 * under Presentación and «is it any good?» under Calidad e IA, while the
 * generation trace stood in the main bar beside them. Three intents replace
 * the six groups: **Revisar · Mejorar · Compartir**. Each has one primary
 * action, one click away and with a shortcut; the rest sit behind it. The
 * observability that only advanced users read moves to «Detalle técnico».
 *
 * This file is the inventory: every action, its intent and its section. The
 * toolbar renders it and the command palette (⌘K) registers it, so the bar
 * and the palette cannot disagree about where an action is.
 */

export type CanvasIntent = 'review' | 'improve' | 'share' | 'detail';

export type CanvasActionId =
  | 'quality-panel' | 'zoom-in' | 'zoom-out' | 'fit' | 'center' | 'fullscreen' | 'minimap'
  | 'aud-exec' | 'aud-tech' | 'aud-ops' | 'speech'
  | 'view-markdown' | 'view-fable' | 'view-excalidraw' | 'view-lucidchart'
  | 'suggestions' | 'edit' | 'save-diagram' | 'edit-story' | 'auto-improve' | 'world-class' | 'convert' | 'tests'
  | 'present' | 'brief' | 'publication'
  | 'trace' | 'copy-report';

/** Where an action sits inside its intent's menu. */
export type CanvasActionSection = 'main' | 'view' | 'audience' | 'openIn' | 'ai' | 'derive';

export interface CanvasActionPlacement {
  intent: CanvasIntent;
  section: CanvasActionSection;
}

export const CANVAS_ACTION_PLACEMENT: Record<CanvasActionId, CanvasActionPlacement> = {
  'quality-panel': { intent: 'review', section: 'main' },
  speech: { intent: 'review', section: 'main' },
  'zoom-in': { intent: 'review', section: 'view' },
  'zoom-out': { intent: 'review', section: 'view' },
  fit: { intent: 'review', section: 'view' },
  center: { intent: 'review', section: 'view' },
  fullscreen: { intent: 'review', section: 'view' },
  minimap: { intent: 'review', section: 'view' },
  'aud-exec': { intent: 'review', section: 'audience' },
  'aud-tech': { intent: 'review', section: 'audience' },
  'aud-ops': { intent: 'review', section: 'audience' },
  'view-markdown': { intent: 'review', section: 'openIn' },
  'view-fable': { intent: 'review', section: 'openIn' },
  'view-excalidraw': { intent: 'review', section: 'openIn' },
  'view-lucidchart': { intent: 'review', section: 'openIn' },
  suggestions: { intent: 'improve', section: 'ai' },
  'world-class': { intent: 'improve', section: 'ai' },
  'auto-improve': { intent: 'improve', section: 'ai' },
  edit: { intent: 'improve', section: 'main' },
  'save-diagram': { intent: 'improve', section: 'main' },
  'edit-story': { intent: 'improve', section: 'main' },
  convert: { intent: 'improve', section: 'derive' },
  tests: { intent: 'improve', section: 'derive' },
  present: { intent: 'share', section: 'main' },
  brief: { intent: 'share', section: 'main' },
  publication: { intent: 'share', section: 'main' },
  trace: { intent: 'detail', section: 'main' },
  'copy-report': { intent: 'detail', section: 'main' },
};

/** The order the three intents appear in the bar, and their one-click action. */
export const CANVAS_INTENTS: readonly { intent: Exclude<CanvasIntent, 'detail'>; primary: CanvasActionId }[] = [
  { intent: 'review', primary: 'quality-panel' },
  { intent: 'improve', primary: 'suggestions' },
  { intent: 'share', primary: 'present' },
];

/**
 * Shortcuts for the actions people reach for most. `Alt+Shift` and the
 * physical key (`event.code`): a single letter would type into the editor,
 * `⌘` is the browser's, and on a Mac `Alt` alone turns R into ®.
 */
export const CANVAS_SHORTCUTS: Partial<Record<CanvasActionId, { code: string; label: string }>> = {
  'quality-panel': { code: 'KeyR', label: '⌥⇧R' },
  suggestions: { code: 'KeyM', label: '⌥⇧M' },
  present: { code: 'KeyP', label: '⌥⇧P' },
  edit: { code: 'KeyE', label: '⌥⇧E' },
  trace: { code: 'KeyD', label: '⌥⇧D' },
};

/** `aria-keyshortcuts` wants the platform-neutral spelling. */
export const ariaShortcutFor = (id: CanvasActionId): string | undefined => {
  const shortcut = CANVAS_SHORTCUTS[id];
  return shortcut ? `Alt+Shift+${shortcut.code.replace('Key', '')}` : undefined;
};

export interface ShortcutEventLike {
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** The action a key press asks for, or `null` when it is not one of ours. */
export const actionForShortcut = (event: ShortcutEventLike): CanvasActionId | null => {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  const match = (Object.entries(CANVAS_SHORTCUTS) as [CanvasActionId, { code: string }][])
    .find(([, shortcut]) => shortcut.code === event.code);
  return match ? match[0] : null;
};
