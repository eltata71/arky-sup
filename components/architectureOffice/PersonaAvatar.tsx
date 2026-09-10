/**
 * The face of a specialist.
 *
 * Thirteen personas is more than a reader can hold as a list of names, so each
 * one gets a stable colour and a domain glyph. Both are derived from the
 * persona id, never from a random seed, so Elena looks the same on the board,
 * in the charter and in the workload panel — recognition is the whole point.
 */

import React from 'react';
import { cn } from '../ui/cn';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from '../../services/architectureOffice/officeAgentPersonas';
import { personaIcon } from './officeUiIcons';

/**
 * Six tinted surfaces, all of them holding their contrast in both themes.
 * Written out in full because Tailwind only sees literal class strings.
 */
const PERSONA_SURFACES: readonly string[] = Object.freeze([
  'bg-primary-100 text-primary-700 ring-primary-200 dark:bg-primary-900/50 dark:text-primary-200 dark:ring-primary-800',
  'bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-900/50 dark:text-sky-200 dark:ring-sky-800',
  'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-200 dark:ring-emerald-800',
  'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/50 dark:text-amber-200 dark:ring-amber-800',
  'bg-ai-100 text-ai-700 ring-ai-200 dark:bg-ai-900/50 dark:text-ai-200 dark:ring-ai-800',
  'bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-900/50 dark:text-teal-200 dark:ring-teal-800',
]);

/** Stable index from the persona id — same persona, same colour, every render. */
const surfaceFor = (personaId: string): string => {
  let hash = 0;
  for (let index = 0; index < personaId.length; index += 1) {
    hash = (hash * 31 + personaId.charCodeAt(index)) % 100_000;
  }
  return PERSONA_SURFACES[hash % PERSONA_SURFACES.length];
};

const SIZES = {
  xs: 'h-6 w-6 rounded-lg',
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
} as const;

const GLYPH_SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
} as const;

export interface PersonaAvatarProps {
  personaId: OfficeAgentId;
  size?: keyof typeof SIZES;
  /**
   * Set when the alias is already written next to the avatar. Without it the
   * avatar carries its own screen-reader label, which would otherwise read the
   * name twice — and would make the name ambiguous to a test or a user
   * searching the page for it.
   */
  decorative?: boolean;
  className?: string;
}

export const PersonaAvatar: React.FC<PersonaAvatarProps> = ({
  personaId,
  size = 'sm',
  decorative = false,
  className,
}) => {
  const persona = OFFICE_AGENT_PERSONAS[personaId];
  const Icon = personaIcon(personaId);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center ring-1',
        SIZES[size],
        surfaceFor(personaId),
        className,
      )}
    >
      <Icon className={GLYPH_SIZES[size]} aria-hidden strokeWidth={2} />
      {/*
        * The `title` that used to sit on this span became the accessible
        * *description*, so a non-decorative avatar was announced as its own
        * name and then again as "alias — role". The role is available as text
        * wherever it matters; here the name alone is what a reader needs.
        */}
      {!decorative && <span className="sr-only">{persona?.alias ?? personaId}</span>}
    </span>
  );
};

/** Avatar + name, the compact form used inside task cards and charters. */
export const PersonaChip: React.FC<{
  personaId: OfficeAgentId;
  /** Prefix such as "Revisa" or "Produce". */
  prefix?: string;
  className?: string;
}> = ({ personaId, prefix, className }) => {
  const persona = OFFICE_AGENT_PERSONAS[personaId];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white py-0.5 pl-0.5 pr-2 dark:border-gray-800 dark:bg-gray-900',
        className,
      )}
    >
      <PersonaAvatar personaId={personaId} size="xs" decorative />
      <span className="text-2xs font-medium text-gray-700 dark:text-gray-200">
        {prefix ? `${prefix} ` : ''}{persona?.alias ?? personaId}
      </span>
    </span>
  );
};

export default PersonaAvatar;
