/**
 * Picks the business initiatives an attention or a deliverable answers.
 *
 * This replaces a text box that asked people to type `NEG-2026-001` from
 * memory. That box could not tell a typo from a real code, could not tell an
 * initiative that exists from one that does not, and produced a link that
 * looked identical either way. The picker can only emit ids of initiatives
 * that exist, which is the whole point of moving the relation onto keys.
 *
 * It still *shows* the code, because the code is what people say out loud in a
 * steering meeting — but the code is now a label on a real record, not the
 * relation itself.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Badge, Input, cn } from '../ui';
import { Check, Link2Off, Search, X } from 'lucide-react';
import { foldOfficeText } from '../../services/architectureOffice/domain/officeShared';
import {
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_STATUS_TONES,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from './initiativeUiLabels';
import type { BusinessInitiative } from '../../services/businessInitiatives/domain';

export interface InitiativePickerProps {
  /** Every initiative the user may link to. */
  initiatives: BusinessInitiative[];
  /** Currently linked ids — the canonical relation. */
  value: string[];
  onChange: (initiativeIds: string[]) => void;
  /**
   * Codes recorded on the record that match no registered initiative. Shown so
   * a broken legacy link is visible and removable rather than silently ignored.
   */
  unresolvedCodes?: string[];
  onDropUnresolvedCode?: (code: string) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export const InitiativePicker: React.FC<InitiativePickerProps> = ({
  initiatives,
  value,
  onChange,
  unresolvedCodes = [],
  onDropUnresolvedCode,
  label = 'Iniciativas de negocio que atiende',
  hint = 'La relación se guarda por llave, no por el código escrito a mano.',
  disabled = false,
  className,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => value
      .map((id) => initiatives.find((initiative) => initiative.id === id))
      .filter((initiative): initiative is BusinessInitiative => Boolean(initiative)),
    [value, initiatives],
  );

  /** Ids in `value` with no initiative behind them — a link that broke. */
  const danglingIds = useMemo(
    () => value.filter((id) => !initiatives.some((initiative) => initiative.id === id)),
    [value, initiatives],
  );

  const matches = useMemo(() => {
    const needle = foldOfficeText(query.trim());
    return initiatives
      .filter((initiative) => !value.includes(initiative.id))
      .filter((initiative) => {
        if (!needle) return true;
        return foldOfficeText(`${initiative.code} ${initiative.title} ${initiative.driver}`)
          .includes(needle);
      })
      .slice(0, 8);
  }, [initiatives, value, query]);

  const add = useCallback((id: string) => {
    onChange([...new Set([...value, id])]);
    setQuery('');
    inputRef.current?.focus();
  }, [value, onChange]);

  const remove = useCallback((id: string) => {
    onChange(value.filter((current) => current !== id));
  }, [value, onChange]);

  const listId = 'initiative-picker-results';

  return (
    <div className={cn('space-y-2', className)}>
      <div>
        <label htmlFor="initiative-picker-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <p className="text-2xs text-gray-500 dark:text-gray-400">{hint}</p>
      </div>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Iniciativas de negocio vinculadas">
          {selected.map((initiative) => (
            <li key={initiative.id}>
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 py-1 pl-2 pr-1 dark:border-primary-800 dark:bg-primary-950/40">
                <span className="font-mono text-2xs font-semibold text-primary-700 dark:text-primary-300">
                  {initiative.code || 'sin código'}
                </span>
                <span className="truncate text-2xs text-gray-700 dark:text-gray-200">
                  {initiative.title}
                </span>
                <button
                  type="button"
                  onClick={() => remove(initiative.id)}
                  disabled={disabled}
                  aria-label={`Quitar ${initiative.title}`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-primary-400 transition-colors hover:bg-primary-100 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 dark:hover:bg-primary-900/60"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* A link that points at a deleted initiative is shown, not hidden: the
          work is still real and someone has to decide what it now answers. */}
      {(danglingIds.length > 0 || unresolvedCodes.length > 0) && (
        <ul className="space-y-1" aria-label="Vínculos rotos">
          {danglingIds.map((id) => (
            <li key={id} className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 dark:bg-red-950/30">
              <Link2Off className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-2xs text-red-700 dark:text-red-300">
                Apunta a una iniciativa eliminada.
              </span>
              <button
                type="button"
                onClick={() => remove(id)}
                disabled={disabled}
                className="shrink-0 rounded px-1.5 text-2xs font-semibold text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-red-300"
              >
                Quitar
              </button>
            </li>
          ))}
          {unresolvedCodes.map((code) => (
            <li key={code} className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30">
              <Link2Off className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-2xs text-amber-700 dark:text-amber-300">
                El código <span className="font-mono font-semibold">{code}</span> no corresponde a
                ninguna iniciativa registrada.
              </span>
              {onDropUnresolvedCode && (
                <button
                  type="button"
                  onClick={() => onDropUnresolvedCode(code)}
                  disabled={disabled}
                  className="shrink-0 rounded px-1.5 text-2xs font-semibold text-amber-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-amber-300"
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
        <Input
          id="initiative-picker-search"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por código, título o driver"
          disabled={disabled}
          className="pl-8"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          autoComplete="off"
        />
      </div>

      {initiatives.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-2xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
          Todavía no hay iniciativas registradas. Crea una para poder enlazar este proyecto con la
          necesidad de negocio que la justifica.
        </p>
      ) : (
        <ul
          id={listId}
          role="listbox"
          aria-label="Iniciativas disponibles"
          className="max-h-56 space-y-1 overflow-y-auto"
        >
          {matches.length === 0 ? (
            <li className="rounded-lg bg-gray-50 px-3 py-2 text-2xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              {query.trim()
                ? 'Ninguna iniciativa coincide con la búsqueda.'
                : 'Todas las iniciativas registradas ya están vinculadas.'}
            </li>
          ) : (
            matches.map((initiative) => (
              <li key={initiative.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add(initiative.id)}
                  disabled={disabled}
                  className="flex w-full items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 dark:border-gray-800 dark:hover:border-primary-700 dark:hover:bg-primary-950/30"
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-700" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-2xs font-semibold text-gray-500 dark:text-gray-400">
                        {initiative.code || 'sin código'}
                      </span>
                      <span className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                        {initiative.title}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={INITIATIVE_STATUS_TONES[initiative.status]} size="xs">
                        {INITIATIVE_STATUS_LABELS[initiative.status]}
                      </Badge>
                      <Badge tone={PRIORITY_TONES[initiative.priority]} size="xs" outline>
                        {PRIORITY_LABELS[initiative.priority]}
                      </Badge>
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default InitiativePicker;
