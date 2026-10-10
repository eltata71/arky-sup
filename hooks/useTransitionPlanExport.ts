/**
 * Exporta la hoja de ruta que se está viendo: brechas en tabla y mesetas en la
 * línea de tiempo nativa del PPTX. Código diferido; la pantalla sólo llama a
 * este hook.
 */

import { useCallback, useState } from 'react';
import type { Roadmap } from '../services/architectureProjects';
import type { GapAnalysis } from '../services/enterpriseRepository';
import { downloadFile, exportRoadmapDeckAsPptx } from '../services/export';

type Translate = (key: string, vars?: Record<string, string>) => string;

export const useTransitionPlanExport = (projectName: string, gaps: GapAnalysis, roadmap: Roadmap, t: Translate) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const exportPptx = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const file = await exportRoadmapDeckAsPptx(
        {
          title: `${t('tp.title')} · ${projectName}`,
          subtitle: t('tp.export.subtitle'),
          gapTitle: t('tp.export.gaps'),
          gapHeaders: [t('tp.export.col.element'), t('tp.export.col.action')],
          gapRows: gaps.entries.filter((e) => e.action !== 'keep').map((e) => [e.item.name, t(`tp.action.${e.action}`)]),
          timelineTitle: t('tp.export.roadmap'),
          steps: roadmap.plateaus.map((r) =>
            `${r.plateau.name} — ${r.arrivesAt ? r.arrivesAt.slice(0, 10) : t('tp.undated')}`,
          ),
        },
        `${t('tp.title')}-${projectName}`,
      );
      downloadFile(file);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [projectName, gaps, roadmap, t]);

  return { exportPptx, busy, failed };
};
