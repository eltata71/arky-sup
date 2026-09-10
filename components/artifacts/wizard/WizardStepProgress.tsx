import React from 'react';
import { CheckCircleIcon } from '../../Icons';
import { cn } from '../../ui/cn';

export type WizardStepNumber = 1 | 2 | 3 | 4 | 5;

export interface WizardStepDescriptor {
  number: WizardStepNumber;
  /** Short label displayed inside the chip. */
  label: string;
  /** Full accessible name, used for `aria-label` (defaults to "<n> · <label>"). */
  accessibleLabel?: string;
}

interface WizardStepProgressProps {
  steps: WizardStepDescriptor[];
  currentStep: WizardStepNumber;
  /** Steps the user already completed — render with a check mark. */
  completedSteps?: WizardStepNumber[];
  /** Steps that are reachable (clickable).  Defaults to currentStep + completedSteps. */
  navigableSteps?: WizardStepNumber[];
  onNavigate?: (step: WizardStepNumber) => void;
  className?: string;
}

/**
 * Compact, accessible 5-step progress indicator for the artifact wizard.
 *
 * Renders an ordered list of step chips with `aria-current="step"` on the
 * active step, a checkmark on completed steps and a low-contrast style on
 * upcoming ones.  Clicking a navigable step calls `onNavigate`.
 */
export const WizardStepProgress: React.FC<WizardStepProgressProps> = ({
  steps,
  currentStep,
  completedSteps = [],
  navigableSteps,
  onNavigate,
  className,
}) => {
  const completedSet = new Set(completedSteps);
  const reachableSet = new Set(navigableSteps ?? [...completedSet, currentStep]);

  return (
    <nav aria-label="Progreso del asistente" className={cn('w-full', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {steps.map((step, index) => {
          const isCurrent = step.number === currentStep;
          const isCompleted = completedSet.has(step.number);
          const isReachable = reachableSet.has(step.number);
          const ariaLabel = step.accessibleLabel ?? `${step.number} · ${step.label}`;
          const baseClasses = cn(
            'inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950',
            isCurrent && 'bg-primary-600 text-white shadow-sm',
            !isCurrent && isCompleted && 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60',
            !isCurrent && !isCompleted && isReachable && 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
            !isCurrent && !isCompleted && !isReachable && 'bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500',
            !isReachable && 'cursor-not-allowed',
          );
          const Chip: React.ReactElement = (
            <span className="inline-flex items-center gap-1.5">
              {isCompleted ? (
                <CheckCircleIcon className="h-3.5 w-3.5" />
              ) : (
                <span aria-hidden className={cn('inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold', isCurrent ? 'bg-white/20 text-white' : 'bg-white/70 text-gray-600 dark:bg-gray-700 dark:text-gray-200')}>{step.number}</span>
              )}
              <span>{step.label}</span>
            </span>
          );
          return (
            <li key={step.number} className="flex items-center">
              {onNavigate && isReachable ? (
                <button
                  type="button"
                  onClick={() => onNavigate(step.number)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={ariaLabel}
                  className={baseClasses}
                >
                  {Chip}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={ariaLabel}
                  className={baseClasses}
                  role="status"
                >
                  {Chip}
                </span>
              )}
              {index < steps.length - 1 && (
                <span aria-hidden className="mx-1 hidden h-px w-4 bg-gray-200 dark:bg-gray-700 sm:inline-block" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default WizardStepProgress;
