/**
 * La cadena de derivación del lienzo, con sus fronteras de memoización.
 *
 * `ArtifactCanvas` calculaba aquí dentro —entre su estado y su JSX— el informe
 * de calidad, el preflight, la presentación compilada, los formatos de
 * exportación y la foto de exportabilidad, importando de cinco módulos de
 * servicio para hacerlo. Las *decisiones* se han ido a
 * `services/artifacts/application/artifactAssessment.ts`, donde se pueden
 * probar sin montar un lienzo; lo que queda aquí es lo único que necesita
 * React: cuándo recalcular cada cosa.
 *
 * Las dependencias de cada `useMemo` son deliberadamente las mismas que tenía
 * el componente. Colapsarlas en una sola habría sido más corto y peor:
 * `analyzeDiagramQuality` es lo más caro que hace esta pantalla y no puede
 * recalcularse cada vez que alguien cambia de pestaña.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Artifact, Project, Settings } from '../../types';
import type { DiagramIR } from '../../lib/diagram';
import {
  assessCompilationFreshness,
  assessDiagramQuality,
  assessExportFormats,
  assessExportability,
  assessPreflight,
  buildSuggestionContext,
  compilePresentation,
  resolveExportView,
  type CanvasLayoutSnapshot,
} from '../../services/artifacts/application/artifactAssessment';

export interface UseArtifactAssessmentInput {
  artifact: Artifact;
  project: Project;
  settings: Settings;
  audience: string;
  viewMode: string;
  /** Lo que el resolvedor produjo: el IR y su informe de calidad sólo-IR. */
  renderable: { ir?: DiagramIR | null; quality?: unknown };
  /** Lo que ReactFlow midió, o `null` mientras no haya pintado. */
  layoutSnapshot: CanvasLayoutSnapshot | null;
}

export function useArtifactAssessment(input: UseArtifactAssessmentInput) {
  const { artifact, project, settings, audience, viewMode, renderable, layoutSnapshot } = input;

  /**
   * `lastPreflightReady` es una realimentación: el preflight de la vuelta
   * anterior alimenta las señales de runtime de la siguiente. Vive aquí porque
   * es estado de esta derivación y de nada más.
   */
  const [lastPreflightReady, setLastPreflightReady] = useState<boolean | undefined>(undefined);

  const qualityReport = useMemo(
    () => assessDiagramQuality({
      artifact,
      ir: renderable.ir,
      layout: layoutSnapshot,
      fallback: renderable.quality as never,
      lastPreflightReady,
    }),
    [artifact, renderable.ir, renderable.quality, layoutSnapshot, lastPreflightReady],
  );

  const preflightReport = useMemo(
    () => assessPreflight(renderable.ir, qualityReport),
    [renderable.ir, qualityReport],
  );

  useEffect(() => {
    if (!preflightReport) return;
    setLastPreflightReady(preflightReport.ready);
  }, [preflightReport]);

  const presentationCompileResult = useMemo(
    () => compilePresentation(artifact, audience, viewMode),
    [artifact, audience, viewMode],
  );

  const activeExportView = resolveExportView(viewMode);

  const exportFormatOptions = useMemo(
    () => assessExportFormats(artifact, activeExportView, preflightReport),
    [artifact, activeExportView, preflightReport],
  );

  const artifactQualitySnapshot = useMemo(
    () => assessExportability(artifact, activeExportView),
    [artifact, activeExportView],
  );

  const suggestionContext = useMemo(
    () => () => buildSuggestionContext({ artifact, project, quality: qualityReport, settings }),
    [artifact, project, qualityReport, settings],
  );

  return {
    qualityReport,
    preflightReport,
    presentationCompileResult,
    presentationModel: presentationCompileResult.model,
    activeExportView,
    exportFormatOptions,
    artifactQualitySnapshot,
    buildSuggestionContext: suggestionContext,
    compilationFreshness: assessCompilationFreshness(artifact),
  };
}
