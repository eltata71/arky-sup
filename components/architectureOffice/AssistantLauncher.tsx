/**
 * The office, always within reach.
 *
 * The per-screen "Equipo de arquitectura" button lives in the page header, and
 * a header scrolls away — which meant that on the long editing screens, exactly
 * where a user is capturing fields and most wants help, the assistant was
 * several scrolls out of reach. This is a fixed affordance so the answer to
 * "where is the assistant" is the same on every level.
 *
 * It sits above the observability pill (`bottom-4`, `z-[180]`) rather than
 * beside it, so neither covers the other on a phone.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../ui/cn';

export interface AssistantLauncherProps {
  onOpen: () => void;
  /** Named so the button says which record the team would be asked about. */
  label: string;
  className?: string;
}

export const AssistantLauncher: React.FC<AssistantLauncherProps> = ({ onOpen, label, className }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label={label}
    className={cn(
      'fixed bottom-36 right-4 z-[170] inline-flex items-center gap-2 rounded-full px-4 py-2.5',
      'bg-ai-gradient text-white shadow-glow-ai transition-transform hover:scale-[1.03]',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
      'md:bottom-20',
      className,
    )}
  >
    <Sparkles className="h-4 w-4" aria-hidden />
    {/* The word is hidden on narrow screens, where the icon plus the
        accessible name is enough and a label would crowd the viewport. */}
    <span className="hidden text-xs font-bold sm:inline" aria-hidden>Equipo de arquitectura</span>
  </button>
);

export default AssistantLauncher;
