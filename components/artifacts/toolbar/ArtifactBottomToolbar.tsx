import React from 'react';
import { motion } from 'motion/react';
import { Dropdown, type DropdownItem, type DropdownSection } from '../../ui/Dropdown';
import {
  CheckBadgeIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  PresentationChartBarIcon,
  SparklesIcon,
} from '../../Icons';
import { useUiText } from '../../../hooks/useUiText';
import { useCanvasActionCommands } from '../../../hooks/artifacts/useCanvasActionCommands';
import { buildCanvasActions, type CanvasAction, type CanvasActionInputs } from './canvasActions';
import {
  CANVAS_ACTION_PLACEMENT,
  CANVAS_INTENTS,
  CANVAS_SHORTCUTS,
  ariaShortcutFor,
  type CanvasActionSection,
  type CanvasIntent,
} from './canvasIntents';

export type ArtifactBottomToolbarProps = CanvasActionInputs;

const INTENT_ICON: Record<Exclude<CanvasIntent, 'detail'>, React.ReactNode> = {
  review: <CheckBadgeIcon className="h-4 w-4" />,
  improve: <SparklesIcon className="h-4 w-4" />,
  share: <PresentationChartBarIcon className="h-4 w-4" />,
};

/** Section order inside a menu; `main` carries no heading. */
const SECTION_ORDER: CanvasActionSection[] = ['main', 'ai', 'derive', 'view', 'audience', 'openIn'];

const shortcutBadge = (action: CanvasAction): React.ReactNode => {
  const shortcut = CANVAS_SHORTCUTS[action.id];
  return shortcut ? <kbd className="font-sans text-[10px] text-gray-400">{shortcut.label}</kbd> : undefined;
};

const toItem = (action: CanvasAction, t: (key: string, replacements?: Record<string, string>) => string, traceErrors: number): DropdownItem => ({
  id: action.id,
  icon: action.icon,
  label: t(action.label),
  description: action.id === 'trace' && traceErrors > 0
    ? t('uiDynamic.traceErrors', { count: String(traceErrors) })
    : action.description ? t(action.description) : undefined,
  disabled: action.disabled,
  active: action.active,
  onClick: action.run,
  trailing: shortcutBadge(action),
});

const buttonBase = 'inline-flex items-center gap-1.5 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white';

/**
 * Floating bottom toolbar of the canvas, organised by intent (12.5):
 * **Revisar · Mejorar · Compartir**. Each intent is a split button — its
 * primary action runs in one click (and has a shortcut), the chevron opens
 * the rest of that intent. «Detalle técnico» holds the generation trace and
 * the diagnostic report, for whoever needs them. Every action is also in ⌘K.
 * The inventory is `canvasIntents.ts`; this file only draws it.
 */
export const ArtifactBottomToolbar: React.FC<ArtifactBottomToolbarProps> = (props) => {
  const t = useUiText();
  const actions = buildCanvasActions(props);
  useCanvasActionCommands(actions);

  const byIntent: Record<CanvasIntent, CanvasAction[]> = { review: [], improve: [], share: [], detail: [] };
  for (const action of actions) byIntent[CANVAS_ACTION_PLACEMENT[action.id].intent].push(action);

  const sectionsFor = (intent: CanvasIntent): DropdownSection[] => SECTION_ORDER
    .map((section) => ({
      label: section === 'main' ? undefined : t(`canvas.section.${section}`),
      items: byIntent[intent].filter((action) => CANVAS_ACTION_PLACEMENT[action.id].section === section).map(action => toItem(action, t, props.traceErrors)),
    }))
    .filter((section) => section.items.length > 0);

  const detailAlert = props.hasObservabilityAlert || props.traceErrors > 0;

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-40 -translate-x-1/2">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        role="toolbar"
        aria-label={t('canvas.toolbar')}
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-gray-200/60 bg-white/90 p-1.5 shadow-2xl backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-900/90"
      >
        {CANVAS_INTENTS.map(({ intent, primary }) => {
          const main = byIntent[intent].find((action) => action.id === primary);
          const intentLabel = t(`canvas.intent.${intent}`);
          return (
            <div key={intent} role="group" aria-label={intentLabel} className="flex items-stretch overflow-hidden rounded-xl">
              {main && (
                <button
                  type="button"
                  onClick={main.run}
                  disabled={main.disabled}
                  aria-pressed={main.active === undefined ? undefined : main.active}
                  aria-keyshortcuts={ariaShortcutFor(main.id)}
                  aria-label={`${intentLabel}: ${t(main.label)}`}
                  className={`${buttonBase} rounded-l-xl pl-2.5 pr-2 ${main.active ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200' : ''}`}
                >
                  {INTENT_ICON[intent]}
                  <span aria-hidden="true">{intentLabel}</span>
                </button>
              )}
              <Dropdown
                align="center"
                width="md"
                aria-label={intentLabel}
                sections={sectionsFor(intent)}
                trigger={({ open, toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    aria-label={t('canvas.more', { intent: intentLabel })}
                    className={`${buttonBase} h-full rounded-r-xl px-1.5`}
                  >
                    <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                )}
              />
            </div>
          );
        })}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <Dropdown
          align="right"
          width="md"
          aria-label={t('canvas.intent.detail')}
          sections={sectionsFor('detail')}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-label={props.traceErrors > 0 ? t('canvas.detailErrors', { count: String(props.traceErrors) }) : t('canvas.intent.detail')}
              className={`${buttonBase} relative rounded-xl px-2`}
            >
              <Cog6ToothIcon className="h-4 w-4" />
              {detailAlert && <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />}
            </button>
          )}
        />
      </motion.div>
    </div>
  );
};

export default ArtifactBottomToolbar;
