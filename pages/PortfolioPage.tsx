import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useApplicationPortfolio } from '../hooks/useApplicationPortfolio';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TYPE } from '../lib/designTokens';
import { PRODUCT_NAME } from '../lib/eaTerminology';
import type { FitScore, InventoryCommand, RadarRing, TimeQuadrant } from '../services/enterpriseRepository';

type View = 'time' | 'radar';
const QUADRANTS: readonly TimeQuadrant[] = ['invest', 'migrate', 'tolerate', 'eliminate'];
const RINGS = ['adopt', 'trial', 'assess', 'hold'] as const;
const SCORES = [1, 2, 3, 4, 5] as const;

const selectClass =
  'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

interface ScoreSelectProps {
  readonly label: string;
  readonly value: number | null;
  readonly empty: string;
  readonly onChange: (score: FitScore | null) => void;
}

const ScoreSelect: React.FC<ScoreSelectProps> = ({ label, value, empty, onChange }) => (
  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
    <span>{label}</span>
    <select
      className={selectClass}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : (Number(e.target.value) as FitScore))}
    >
      <option value="">{empty}</option>
      {SCORES.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  </label>
);

const PortfolioPage: React.FC = () => {
  const { t } = useAppContext();
  const { addToast } = useToast();
  const { portfolio, radar, isLoading, failed, run } = useApplicationPortfolio();
  const [view, setView] = useState<View>('time');

  const send = async (itemId: string, command: InventoryCommand) => {
    const outcome = await run(itemId, command);
    if (outcome === 'failed' || outcome === 'rejected') addToast(t('pf.saveFailed'), 'error');
  };

  const empty = portfolio && radar && portfolio.entries.length === 0 && radar.entries.length === 0;

  return (
    <div className="min-h-[100dvh] px-4 py-6 pb-24 md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <Card tone="gradient">
          <p className={TYPE.labelAccent}>{PRODUCT_NAME}</p>
          <h1 className={TYPE.pageTitle}>{t('pf.title')}</h1>
          <p className={TYPE.body}>{t('pf.subtitle')}</p>
        </Card>

        {isLoading && <PageSkeleton label={t('pf.loading')} header={false} panels={2} />}
        {failed && <EmptyState title={t('pf.error.title')} description={t('pf.error.desc')} />}
        {empty && <EmptyState title={t('pf.empty.title')} description={t('pf.empty.desc')} />}

        {portfolio && radar && !empty && (
          <>
            <SegmentedControl
              aria-label={t('pf.view.label')}
              value={view}
              onChange={setView}
              options={[
                { value: 'time', label: t('pf.view.time') },
                { value: 'radar', label: t('pf.view.radar') },
              ]}
            />

            {view === 'time' && (
              <section className="space-y-4" aria-label={t('pf.view.time')}>
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  {t('pf.time.summary', { n: String(portfolio.assessedCount), total: String(portfolio.entries.length) })}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {QUADRANTS.map((q) => (
                    <Card key={q}>
                      <h2 className={TYPE.sectionTitle}>{t(`pf.quadrant.${q}`)} ({portfolio.byQuadrant[q].length})</h2>
                      <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">{t(`pf.quadrant.${q}.hint`)}</p>
                      <ul className="space-y-2">
                        {portfolio.byQuadrant[q].map((e) => (
                          <li key={e.item.id} className="text-sm text-gray-900 dark:text-gray-100">
                            {e.item.name}
                            <span className="ml-2 text-xs text-gray-600 dark:text-gray-300">
                              {t('pf.fit.functional')} {e.functionalFit} · {t('pf.fit.technical')} {e.technicalFit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
                <Card>
                  <h2 className={TYPE.sectionTitle}>{t('pf.score.title')}</h2>
                  <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">{t('pf.score.hint')}</p>
                  <ul className="space-y-2">
                    {portfolio.entries.map((e) => (
                      <li key={e.item.id} className="flex flex-wrap items-center gap-3 text-sm text-gray-900 dark:text-gray-100">
                        <span className="min-w-[10rem] font-medium">{e.item.name}</span>
                        <ScoreSelect
                          label={t('pf.fit.functional')}
                          value={e.functionalFit}
                          empty={t('pf.unassessed')}
                          onChange={(score) => void send(e.item.id, { type: 'set-application-functional-fit', score })}
                        />
                        <ScoreSelect
                          label={t('pf.fit.technical')}
                          value={e.technicalFit}
                          empty={t('pf.unassessed')}
                          onChange={(score) => void send(e.item.id, { type: 'set-application-technical-fit', score })}
                        />
                        <span className="text-xs">{e.quadrant ? t(`pf.quadrant.${e.quadrant}`) : t('pf.unassessed')}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}

            {view === 'radar' && (
              <section className="space-y-4" aria-label={t('pf.view.radar')}>
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  {t('pf.radar.summary', { n: String(radar.standardsCount) })}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {RINGS.map((r) => (
                    <Card key={r}>
                      <h2 className={TYPE.sectionTitle}>{t(`pf.ring.${r}`)} ({radar.byRing[r].length})</h2>
                      <ul className="mt-2 space-y-1">
                        {radar.byRing[r].map((e) => (
                          <li key={e.item.id} className="text-sm text-gray-900 dark:text-gray-100">{e.item.name}</li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
                <Card>
                  <h2 className={TYPE.sectionTitle}>{t('pf.radar.classify')}</h2>
                  <ul className="mt-2 space-y-2">
                    {radar.entries.map((e) => (
                      <li key={e.item.id} className="space-y-1 text-sm text-gray-900 dark:text-gray-100">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="min-w-[10rem] font-medium">{e.item.name}</span>
                          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                            <span>{t('pf.radar.ring')}</span>
                            <select
                              className={selectClass}
                              value={e.ring ?? ''}
                              onChange={(ev) =>
                                void send(e.item.id, {
                                  type: 'set-technology-ring',
                                  ring: ev.target.value === '' ? null : (ev.target.value as RadarRing),
                                })
                              }
                            >
                              <option value="">{t('pf.unassessed')}</option>
                              {RINGS.map((r) => (
                                <option key={r} value={r}>{t(`pf.ring.${r}`)}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {e.standards.length > 0 && (
                          <ul className="ml-4 list-disc text-xs text-gray-600 dark:text-gray-300">
                            {e.standards.map((s) => (
                              <li key={s.id}>{t('pf.radar.standard', { statement: s.statement })}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PortfolioPage;
