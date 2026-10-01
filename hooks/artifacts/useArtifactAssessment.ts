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
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import type { DiagramIR } from '../../lib/diagram';
import { useArtifactContextPorts } from '../useArtifactContextPorts';
import { useArtifactModelCalls } from './useArtifactModelCalls';
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
import { assessC4LevelCoherence, withC4Coherence } from '../../services/artifacts/application/c4LevelCoherence';

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

  // Plan de diagramas 4.2: la coherencia con los niveles C4 enlazados entra
  // en el informe que se muestra, después del preflight: avisa, no bloquea.
  const c4Coherence = useMemo(
    () => assessC4LevelCoherence(artifact, project.artifacts),
    [artifact, project.artifacts],
  );
  const reportedQuality = useMemo(() => withC4Coherence(qualityReport, c4Coherence), [qualityReport, c4Coherence]);

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

  // Initiative, conversation and deliverables, read when the request starts (7.3d).
  const loadContextPorts = useArtifactContextPorts(project);
  const modelCalls = useArtifactModelCalls(project, settings);
  const suggestionContext = useMemo(
    () => async () => buildSuggestionContext({ artifact, project, quality: reportedQuality, settings, ports: await loadContextPorts() }),
    [artifact, project, reportedQuality, settings, loadContextPorts],
  );

  return {
    qualityReport: reportedQuality,
    preflightReport,
    presentationCompileResult,
    presentationModel: presentationCompileResult.model,
    activeExportView,
    exportFormatOptions,
    artifactQualitySnapshot,
    buildSuggestionContext: suggestionContext,
    /** The canvas's model calls, with the same context ports the suggestions read (7.3d). */
    modelCalls,
    compilationFreshness: assessCompilationFreshness(artifact),
  };
}
