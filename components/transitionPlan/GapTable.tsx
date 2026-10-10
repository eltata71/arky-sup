import React from 'react';
import type { GapAnalysis } from '../../services/enterpriseRepository';

type Translate = (key: string, vars?: Record<string, string>) => string;

interface GapTableProps {
  readonly gaps: GapAnalysis;
  readonly t: Translate;
}

export const GapTable: React.FC<GapTableProps> = ({ gaps, t }) => (
  <table className="w-full text-left text-sm">
    <caption className="sr-only">{t('tp.gaps.caption')}</caption>
    <thead>
      <tr className="text-gray-600 dark:text-gray-300">
        <th scope="col" className="py-1 pr-3">{t('tp.export.col.element')}</th>
        <th scope="col" className="py-1 pr-3">{t('tp.export.col.action')}</th>
        <th scope="col" className="py-1">{t('tp.gaps.changes')}</th>
      </tr>
    </thead>
    <tbody>
      {gaps.entries.map((e) => (
        <tr key={e.itemId} className="border-t border-gray-200 dark:border-gray-700">
          <td className="py-1 pr-3">{e.item.name}</td>
          <td className="py-1 pr-3">{t(`tp.action.${e.action}`)}</td>
          <td className="py-1">{e.changes.map((c) => t(`tp.change.${c}`)).join(', ') || '—'}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
