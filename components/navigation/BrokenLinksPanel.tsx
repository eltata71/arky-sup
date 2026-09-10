/**
 * What does not resolve.
 *
 * The alternative implementation — filtering unresolved references out — makes
 * a dashboard that always looks healthy while quietly losing work: an attention
 * whose initiative was deleted simply stops appearing. This panel is the other
 * choice. It costs a card on the screen and it is the difference between a
 * portfolio you can trust and one that merely looks tidy.
 *
 * Hidden entirely when there is nothing wrong: an empty "no problems" card is
 * furniture.
 */

import React from 'react';
import { Badge, Button, Card, CardTitle, cn } from '../ui';
import { Link2Off } from 'lucide-react';
import { EA_LEVELS } from '../../lib/eaTerminology';
import type { LinkIssue, PortfolioLevel } from '../../services/portfolioGraph';

export interface BrokenLinksPanelProps {
  issues: LinkIssue[];
  /** Opens the record that carries the broken reference, so it can be fixed. */
  onOpen?: (issue: LinkIssue) => void;
  className?: string;
}

const LEVEL_LABEL: Readonly<Record<PortfolioLevel, string>> = Object.freeze({
  initiative: EA_LEVELS.initiative.short,
  attention: EA_LEVELS.engagementProject.short,
  deliverable: EA_LEVELS.deliverable.short,
  artifact: EA_LEVELS.artifact.singular,
});

/** Broken beats merely unlinked: a dangling id lost information, an orphan never had it. */
const TONE: Readonly<Record<LinkIssue['kind'], 'danger' | 'warning'>> = Object.freeze({
  'dangling-initiative': 'danger',
  'dangling-attention': 'danger',
  'unresolved-code': 'warning',
  'orphan-attention': 'warning',
});

const KIND_LABEL: Readonly<Record<LinkIssue['kind'], string>> = Object.freeze({
  'dangling-initiative': 'Iniciativa eliminada',
  'dangling-attention': 'Proyecto eliminado',
  'unresolved-code': 'Código sin iniciativa',
  'orphan-attention': 'Sin iniciativa',
});

export const BrokenLinksPanel: React.FC<BrokenLinksPanelProps> = ({
  issues,
  onOpen,
  className,
}) => {
  if (issues.length === 0) return null;

  const broken = issues.filter((issue) => TONE[issue.kind] === 'danger').length;

  return (
    <Card className={cn('space-y-3 border-amber-200 dark:border-amber-900/60', className)}>
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          <Link2Off className="h-4 w-4" aria-hidden strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle>Vínculos que no resuelven</CardTitle>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {broken > 0
              ? `${broken} referencia(s) rota(s) y ${issues.length - broken} aviso(s). El trabajo sigue aquí; lo que falta es la relación.`
              : `${issues.length} aviso(s). Nada se ha perdido, pero la cadena está incompleta.`}
          </p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {issues.map((issue, index) => (
          <li
            key={`${issue.kind}-${issue.sourceId}-${issue.reference ?? index}`}
            className="flex flex-wrap items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-800"
          >
            <Badge tone={TONE[issue.kind]} size="xs">{KIND_LABEL[issue.kind]}</Badge>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-200">
                {issue.message}
              </p>
              <p className="mt-0.5 text-2xs text-gray-400 dark:text-gray-500">
                {LEVEL_LABEL[issue.level]}
                {issue.reference && ` · referencia ${issue.reference}`}
              </p>
            </div>
            {onOpen && (
              <Button variant="ghost" size="xs" onClick={() => onOpen(issue)}>
                Abrir
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default BrokenLinksPanel;
