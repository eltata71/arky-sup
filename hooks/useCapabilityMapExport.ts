/**
 * Exports the capability map being looked at: a PNG of the heat map and a PPTX
 * summary. Lazy code, so it may enter the export barrel; the screen only calls
 * this hook, which keeps its service fan-out at two.
 */

import { useCallback, useState } from 'react';
import { describeLayerValue } from '../components/capabilityMap/CapabilityHeatmap';
import { drawCapabilityPng } from '../components/capabilityMap/capabilityPng';
import { buildCapabilityExportRows, type CapabilityLayer, type CapabilityMap } from '../services/enterpriseRepository';
import { downloadFile, exportTableDeckAsPptx, pngFile } from '../services/export';

type Translate = (key: string, vars?: Record<string, string>) => string;

export interface UseCapabilityMapExportResult {
  readonly exportPng: () => Promise<void>;
  readonly exportPptx: () => Promise<void>;
  readonly busy: boolean;
  readonly failed: boolean;
}

export const useCapabilityMapExport = (
  map: CapabilityMap | null,
  layer: CapabilityLayer,
  t: Translate,
): UseCapabilityMapExportResult => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async (job: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await job();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const rowsFor = useCallback(
    () => (map ? buildCapabilityExportRows(map, layer, (l, v) => describeLayerValue(l, v, t)) : []),
    [map, layer, t],
  );
  const layerName = t(`cap.layer.${layer}`);
  const title = `${t('cap.title')} · ${layerName}`;

  const exportPng = useCallback(
    () =>
      run(async () => {
        const blob = await drawCapabilityPng(rowsFor(), title, t('cap.export.subtitle'));
        if (!blob) throw new Error('png');
        downloadFile(pngFile(blob, `${t('cap.title')}-${layer}`));
      }),
    [run, rowsFor, title, t, layer],
  );

  const exportPptx = useCallback(
    () =>
      run(async () => {
        if (!map) return;
        const rows = rowsFor();
        const uncovered = map.uncoveredIds.length;
        const file = await exportTableDeckAsPptx(
          {
            title,
            subtitle: t('cap.export.subtitle'),
            kpis: [
              { label: t('cap.export.total'), value: String(map.total) },
              { label: t('cap.export.uncovered'), value: String(uncovered) },
            ],
            tableTitle: t('cap.export.table'),
            headers: [t('cap.export.col.capability'), t('cap.export.col.level'), layerName, t('cap.export.col.apps'), t('cap.export.col.initiatives')],
            rows: rows.map((r) => [r.name, `L${r.level}`, r.value, r.applications.join(', ') || '—', String(r.initiativeCount)]),
            callout: uncovered > 0 ? { title: t('cap.export.uncoveredTitle'), body: t('cap.uncovered', { n: String(uncovered) }) } : undefined,
          },
          `${t('cap.title')}-${layer}`,
        );
        downloadFile(file);
      }),
    [run, map, rowsFor, title, t, layer, layerName],
  );

  return { exportPng, exportPptx, busy, failed };
};
