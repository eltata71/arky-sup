import React from 'react';
import { Button } from '../ui/Button';
import type { Roadmap } from '../../services/architectureProjects';

type Translate = (key: string, vars?: Record<string, string>) => string;

interface RoadmapTimelineProps {
  readonly roadmap: Roadmap;
  readonly milestones: readonly { readonly id: string; readonly name: string; readonly dueAt: string }[];
  readonly t: Translate;
  readonly onMove: (plateauId: string, toIndex: number) => void;
  readonly onLink: (plateauId: string, milestoneId: string | null) => void;
  readonly onRemove: (plateauId: string) => void;
}

/** Reordenar es con botones (WCAG 2.5.7): ninguna operación depende de arrastrar. */
export const RoadmapTimeline: React.FC<RoadmapTimelineProps> = ({ roadmap, milestones, t, onMove, onLink, onRemove }) => (
  <ol className="space-y-2" aria-label={t('tp.roadmap.label')}>
    {roadmap.plateaus.map((r, index) => (
      <li key={r.plateau.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <span className="font-medium">{r.plateau.name}</span>
        <span className="text-sm text-gray-600 dark:text-gray-300">{r.arrivesAt ? r.arrivesAt.slice(0, 10) : t('tp.undated')}</span>
        <select
          aria-label={t('tp.milestone.link', { name: r.plateau.name })}
          value={r.plateau.milestoneId ?? ''}
          onChange={(e) => onLink(r.plateau.id, e.target.value || null)}
          className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600"
        >
          <option value="">{t('tp.milestone.none')}</option>
          {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <Button size="sm" variant="secondary" disabled={index === 0} onClick={() => onMove(r.plateau.id, index - 1)}>{t('tp.plateau.earlier')}</Button>
        <Button size="sm" variant="secondary" disabled={index === roadmap.plateaus.length - 1} onClick={() => onMove(r.plateau.id, index + 1)}>{t('tp.plateau.later')}</Button>
        <Button size="sm" variant="secondary" onClick={() => onRemove(r.plateau.id)}>{t('tp.plateau.remove')}</Button>
      </li>
    ))}
  </ol>
);
