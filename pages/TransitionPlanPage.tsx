import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useTransitionPlan } from '../hooks/useTransitionPlan';
import { useTransitionPlanExport } from '../hooks/useTransitionPlanExport';
import { GapTable } from '../components/transitionPlan/GapTable';
import { RoadmapTimeline } from '../components/transitionPlan/RoadmapTimeline';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { TYPE } from '../lib/designTokens';
import { PRODUCT_NAME } from '../lib/eaTerminology';
import { newPrefixedId } from '../lib/ids';

const TransitionPlanPage: React.FC = () => {
  const { t } = useAppContext();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [plateauName, setPlateauName] = useState('');
  const [rejected, setRejected] = useState(false);
  const plan = useTransitionPlan(projectId);
  const projectName = plan.projects.find((p) => p.id === projectId)?.name ?? '';
  const exporter = useTransitionPlanExport(projectName, plan.gaps, plan.roadmap, t);

  const run = (command: Parameters<typeof plan.run>[0]) => setRejected(!plan.run(command));

  return (
    <div className="min-h-[100dvh] px-4 py-6 pb-24 md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <Card tone="gradient">
          <p className={TYPE.labelAccent}>{PRODUCT_NAME}</p>
          <h1 className={TYPE.pageTitle}>{t('tp.title')}</h1>
          <p className={TYPE.body}>{t('tp.subtitle')}</p>
        </Card>

        <label className="block text-sm">
          <span className="mr-2">{t('tp.project')}</span>
          <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)} className="rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-600">
            <option value="">{t('tp.project.choose')}</option>
            {plan.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        {!projectId && <EmptyState title={t('tp.empty.title')} description={t('tp.empty.desc')} />}
        {projectId && plan.isLoading && <PageSkeleton label={t('tp.loading')} header={false} panels={2} />}
        {projectId && plan.failed && <EmptyState title={t('tp.error.title')} description={t('tp.error.desc')} />}
        {projectId && !plan.hasTracking && !plan.isLoading && <EmptyState title={t('tp.notracking.title')} description={t('tp.notracking.desc')} />}

        {projectId && plan.hasTracking && !plan.isLoading && !plan.failed && (
          <>
            <Card>
              <h2 className={TYPE.sectionTitle}>{t('tp.elements')}</h2>
              <div className="flex flex-wrap gap-2 py-2">
                <select aria-label={t('tp.baseline.add')} value={baselineId} onChange={(e) => setBaselineId(e.target.value)} className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600">
                  <option value="">{t('tp.baseline.add')}</option>
                  {plan.inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <Button size="sm" disabled={!baselineId} onClick={() => { run({ type: 'add-baseline', itemId: baselineId }); setBaselineId(''); }}>{t('tp.baseline.button')}</Button>
                <select aria-label={t('tp.target.add')} value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600">
                  <option value="">{t('tp.target.add')}</option>
                  {plan.inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <Button size="sm" disabled={!targetId} onClick={() => { run({ type: 'add-target', itemId: targetId }); setTargetId(''); }}>{t('tp.target.button')}</Button>
              </div>
              <GapTable gaps={plan.gaps} t={t} />
            </Card>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className={TYPE.sectionTitle}>{t('tp.roadmap')}</h2>
                <Button size="sm" variant="secondary" disabled={exporter.busy} onClick={() => void exporter.exportPptx()}>{t('cap.export.pptx')}</Button>
              </div>
              <div className="flex flex-wrap gap-2 py-2">
                <input aria-label={t('tp.plateau.name')} value={plateauName} onChange={(e) => setPlateauName(e.target.value)} placeholder={t('tp.plateau.name')} className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-600" />
                <Button size="sm" disabled={!plateauName.trim()} onClick={() => { run({ type: 'add-plateau', id: newPrefixedId('plat'), name: plateauName.trim() }); setPlateauName(''); }}>{t('tp.plateau.add')}</Button>
              </div>
              <RoadmapTimeline
                roadmap={plan.roadmap}
                milestones={plan.milestones}
                t={t}
                onMove={(plateauId, toIndex) => run({ type: 'move-plateau', plateauId, toIndex })}
                onLink={(plateauId, milestoneId) => run({ type: 'link-plateau-milestone', plateauId, milestoneId })}
                onRemove={(plateauId) => run({ type: 'remove-plateau', plateauId })}
              />
            </Card>

            <div role="status" aria-live="polite" className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
              {rejected && <p>{t('tp.rejected')}</p>}
              {plan.gaps.issues.length > 0 && <p>{t('tp.issues.items', { n: String(plan.gaps.issues.length) })}</p>}
              {plan.roadmap.issues.length > 0 && <p>{t('tp.issues.roadmap', { n: String(plan.roadmap.issues.length) })}</p>}
              {exporter.failed && <p>{t('cap.export.failed')}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TransitionPlanPage;
