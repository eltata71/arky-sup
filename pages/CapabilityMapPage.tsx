import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useCapabilityMap } from '../hooks/useCapabilityMap';
import useReducedMotion from '../hooks/useReducedMotion';
import { CapabilityHeatmap, CapabilityLegend } from '../components/capabilityMap/CapabilityHeatmap';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TYPE } from '../lib/designTokens';
import { PRODUCT_NAME } from '../lib/eaTerminology';
import type { CapabilityLayer } from '../services/enterpriseRepository';

const LAYERS: readonly CapabilityLayer[] = ['maturity', 'investment', 'risk', 'coverage'];

const CapabilityMapPage: React.FC = () => {
  const { t } = useAppContext();
  const { map, isLoading, failed } = useCapabilityMap();
  const reducedMotion = useReducedMotion();
  const [layer, setLayer] = useState<CapabilityLayer>('maturity');

  return (
    <div className="min-h-[100dvh] px-4 py-6 pb-24 md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <Card tone="gradient">
          <p className={TYPE.labelAccent}>{PRODUCT_NAME}</p>
          <h1 className={TYPE.pageTitle}>{t('cap.title')}</h1>
          <p className={TYPE.body}>{t('cap.subtitle')}</p>
        </Card>

        {isLoading && <PageSkeleton label={t('cap.loading')} header={false} panels={2} />}
        {failed && <EmptyState title={t('cap.error.title')} description={t('cap.error.desc')} />}
        {map && map.total === 0 && <EmptyState title={t('cap.empty.title')} description={t('cap.empty.desc')} />}

        {map && map.total > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                aria-label={t('cap.layer.label')}
                value={layer}
                onChange={setLayer}
                options={LAYERS.map((l) => ({ value: l, label: t(`cap.layer.${l}`) }))}
              />
              <CapabilityLegend layer={layer} t={t} />
            </div>
            <CapabilityHeatmap roots={map.roots} layer={layer} t={t} reducedMotion={reducedMotion} />
            <div role="status" aria-live="polite" className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
              {map.uncoveredIds.length > 0 && <p>{t('cap.uncovered', { n: String(map.uncoveredIds.length) })}</p>}
              {map.issues.length > 0 && <p>{t('cap.issues', { n: String(map.issues.length) })}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CapabilityMapPage;
