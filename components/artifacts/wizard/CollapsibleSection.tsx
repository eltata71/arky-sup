import React, { useId, useState } from 'react';
import { ChevronDownIcon } from '../../Icons';
import { cn } from '../../ui/cn';

interface CollapsibleSectionProps {
  /** Closed-state label (shown when collapsed). */
  label: string;
  /** Open-state label (shown when expanded). Falls back to "Ocultar …". */
  openLabel?: string;
  /** Optional icon rendered to the left of the label. */
  icon?: React.ReactNode;
  /** Optional helper text shown below the trigger when expanded. */
  hint?: string;
  /** Start expanded (defaults to collapsed — divulgación progresiva). */
  defaultOpen?: boolean;
  /** Controlled open state (overrides internal state). */
  open?: boolean;
  /** Optional handler to control the open state. */
  onOpenChange?: (open: boolean) => void;
  /** Tone of the trigger — primary (link), subtle (gray) or neutral. */
  tone?: 'primary' | 'subtle' | 'neutral';
  /** Extra classes for the wrapper. */
  className?: string;
  children: React.ReactNode;
}

const toneTriggerStyles: Record<NonNullable<CollapsibleSectionProps['tone']>, string> = {
  primary: 'text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200',
  subtle: 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white',
  neutral: 'text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white',
};

/**
 * Reusable disclosure for progressive disclosure — used to hide technical
 * diagnostics, advanced options and scoring breakdowns behind a single
 * accessible toggle.  Renders an ARIA-correct disclosure with
 * `aria-expanded` / `aria-controls`.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  label,
  openLabel,
  icon,
  hint,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  tone = 'primary',
  className,
  children,
}) => {
  const contentId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = typeof controlledOpen === 'boolean';
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const resolvedLabel = isOpen ? openLabel ?? `Ocultar ${label.toLowerCase()}` : label;

  return (
    <div className={cn('mt-2', className)}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className={cn(
          'inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold transition',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          toneTriggerStyles[tone],
        )}
      >
        {icon}
        <span>{resolvedLabel}</span>
        <ChevronDownIcon className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {hint && isOpen && (
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>
      )}
      <div
        id={contentId}
        hidden={!isOpen}
        className={cn(!isOpen && 'sr-only')}
      >
        {isOpen && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
};

export default CollapsibleSection;
