/**
 * The canvas's storytelling entries in the command palette.
 *
 * Extracted from `ArtifactCanvas.tsx`, which the repository's own conventions
 * say to keep under control by adding a hook rather than another block — and
 * which had drifted to 1.226 lines anyway.
 *
 * The commands take their dependencies as parameters instead of reaching into
 * the component's closure. That is the difference that matters: what this
 * needs is a representation, whether an IR exists, and three callbacks, and
 * that was not visible while it sat inside a 1.200-line component.
 */

import { useMemo, type RefObject } from 'react';
import type { Command } from '../../context/CommandPaletteContext';
import type { Artifact } from '../../lib/artifacts';
import type { DiagramAudience } from '../../lib/diagram';
import type { ReactFlowCanvasHandle } from '../../components/ReactFlowCanvas';

export interface CanvasStorytellingCommandsOptions {
    representation: Artifact['representation'];
    /** Storytelling only applies to a diagram that actually parsed into an IR. */
    hasIR: boolean;
    reactFlowRef: RefObject<ReactFlowCanvasHandle | null>;
    /** Open the one-page executive brief. */
    onOpenBrief: () => void;
    onAudienceChange: (audience: DiagramAudience) => void;
}

export function useCanvasStorytellingCommands({
    representation,
    hasIR,
    reactFlowRef,
    onOpenBrief,
    onAudienceChange,
}: CanvasStorytellingCommandsOptions): Command[] {
  return useMemo<Command[]>(() => {
    if (representation === 'document' || !hasIR) return [];
    return [
      {
        id: 'canvas.story.present',
        section: 'Storytelling',
        title: 'Iniciar modo presentación',
        subtitle: 'Recorrido cinematográfico escena por escena',
        shortcut: 'P',
        flavor: 'storytelling',
        run: () => reactFlowRef.current?.startPresentation(),
        keywords: ['presentar', 'story', 'recorrido', 'demo'],
      },
      {
        id: 'canvas.story.brief',
        section: 'Storytelling',
        title: 'Abrir brief ejecutivo',
        subtitle: 'Resumen narrativo en una página',
        flavor: 'storytelling',
        run: () => onOpenBrief(),
        keywords: ['brief', 'one-pager', 'ejecutivo', 'resumen'],
      },
      {
        id: 'canvas.audience.executive',
        section: 'Storytelling · Audiencia',
        title: 'Cambiar a audiencia ejecutiva',
        subtitle: 'Visión simplificada, valor de negocio y KPIs',
        flavor: 'storytelling',
        run: () => onAudienceChange('executive'),
        keywords: ['ejecutivo', 'executive', 'negocio'],
      },
      {
        id: 'canvas.audience.technical',
        section: 'Storytelling · Audiencia',
        title: 'Cambiar a audiencia técnica',
        subtitle: 'Componentes, contratos y tecnologías',
        flavor: 'storytelling',
        run: () => onAudienceChange('technical'),
        keywords: ['tecnico', 'technical'],
      },
      {
        id: 'canvas.audience.operations',
        section: 'Storytelling · Audiencia',
        title: 'Cambiar a audiencia operaciones',
        subtitle: 'Despliegue, observabilidad y runbooks',
        flavor: 'storytelling',
        run: () => onAudienceChange('operations'),
        keywords: ['operaciones', 'operations', 'sre', 'devops'],
      },
    ];
  }, [representation, hasIR, reactFlowRef, onOpenBrief, onAudienceChange]);
}
