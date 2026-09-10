/**
 * Search across the four levels, over the resolved graph.
 *
 * Every result carries its **path**, so a hit reads as a location rather than
 * a name: "Visión de la Arquitectura" under one attention is visibly a
 * different thing from the same name under another. Selecting one navigates
 * by id, so the caller never has to re-match a string to find what was picked.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Badge, Input, cn } from '../ui';
import { ChevronRight, Search } from 'lucide-react';
import { HIERARCHY_ICONS } from '../architectureOffice/officeUiIcons';
import { EA_LEVELS } from '../../lib/eaTerminology';
import { searchPortfolio } from '../../services/portfolioGraph';
import type {
  PortfolioGraph,
  PortfolioLevel,
  PortfolioSearchHit,
} from '../../services/portfolioGraph';

export interface PortfolioSearchBoxProps {
  graph: PortfolioGraph;
  onSelect: (hit: PortfolioSearchHit) => void;
  placeholder?: string;
  className?: string;
}

const LEVEL_ICON: Readonly<Record<PortfolioLevel, keyof typeof HIERARCHY_ICONS>> = Object.freeze({
  initiative: 'program',
  attention: 'project',
  deliverable: 'engagement',
  artifact: 'artifact',
});

const LEVEL_LABEL: Readonly<Record<PortfolioLevel, string>> = Object.freeze({
  initiative: EA_LEVELS.initiative.short,
  attention: EA_LEVELS.engagementProject.short,
  deliverable: EA_LEVELS.deliverable.short,
  artifact: EA_LEVELS.artifact.singular,
});

const MATCH_LABEL = Object.freeze({
  name: '',
  code: 'por código',
  content: 'por contenido',
});

export const PortfolioSearchBox: React.FC<PortfolioSearchBoxProps> = ({
  graph,
  onSelect,
  placeholder = 'Buscar en iniciativas, proyectos, entregables y artefactos',
  className,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchPortfolio(graph, query), [graph, query]);

  const select = useCallback((hit: PortfolioSearchHit) => {
    onSelect(hit);
    setQuery('');
  }, [onSelect]);

  const listId = 'portfolio-search-results';
  const searching = query.trim().length >= 2;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={searching && hits.length > 0}
          aria-controls={listId}
          autoComplete="off"
          className="pl-8"
        />
      </div>

      {searching && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Resultados del portafolio"
          className="max-h-80 space-y-1 overflow-y-auto"
        >
          {hits.length === 0 ? (
            <li className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              Nada coincide con «{query.trim()}» en ningún nivel del portafolio.
            </li>
          ) : (
            hits.map((hit) => {
              const Icon = HIERARCHY_ICONS[LEVEL_ICON[hit.level]];
              return (
                <li key={`${hit.level}-${hit.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => select(hit)}
                    className="flex w-full items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-800 dark:hover:border-primary-700 dark:hover:bg-primary-950/30"
                  >
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      <Icon className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {hit.name}
                        </span>
                        <Badge tone="gray" size="xs" outline>{LEVEL_LABEL[hit.level]}</Badge>
                        {MATCH_LABEL[hit.matchedOn] && (
                          <span className="text-2xs text-gray-400 dark:text-gray-500">
                            {MATCH_LABEL[hit.matchedOn]}
                          </span>
                        )}
                      </span>
                      {/* The path is what disambiguates two records with the
                          same name at different places in the hierarchy. */}
                      {hit.trail.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-0.5 text-2xs text-gray-500 dark:text-gray-400">
                          {hit.trail.map((step, index) => (
                            <React.Fragment key={`${hit.id}-${index}`}>
                              {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-gray-300 dark:text-gray-700" aria-hidden />}
                              <span className="truncate">{step}</span>
                            </React.Fragment>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};

export default PortfolioSearchBox;
