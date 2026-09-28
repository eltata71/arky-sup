import React from 'react';
import type { Artifact } from '../../../lib/artifacts';
import { DiagramModifyPanel } from './DiagramModifyPanel';
import { DiagramDetailLinksPanel } from './DiagramDetailLinksPanel';
import { DiagramStoryEditorPanel } from './DiagramStoryEditorPanel';

export type DiagramPanelId = 'modify' | 'levels' | 'story';

export interface DiagramPanelsProps {
  open: DiagramPanelId | null;
  onClose: () => void;
  projectId: string;
  artifact: Artifact;
  projectArtifacts: readonly Artifact[];
  /** Abre otra versión u otro artefacto en el lienzo. */
  onOpenArtifact: (artifactId: string) => void;
}

/**
 * Los paneles que cambian un diagrama sin regenerarlo —«Modificar», «Niveles
 * C4» y «Editar historia»—, uno abierto a la vez. Todos crean una versión
 * nueva y el lienzo pasa a mostrarla. Cada cuerpo se descarga al abrirse.
 */
export const DiagramPanels: React.FC<DiagramPanelsProps> = ({ open, onClose, projectId, artifact, projectArtifacts, onOpenArtifact }) => (
  <>
    <DiagramModifyPanel isOpen={open === 'modify'} onClose={onClose} projectId={projectId} artifact={artifact} onVersionCreated={onOpenArtifact} />
    <DiagramDetailLinksPanel
      isOpen={open === 'levels'}
      onClose={onClose}
      projectId={projectId}
      artifact={artifact}
      projectArtifacts={projectArtifacts}
      onVersionCreated={onOpenArtifact}
      onOpenArtifact={(id) => { onClose(); onOpenArtifact(id); }}
    />
    <DiagramStoryEditorPanel isOpen={open === 'story'} onClose={onClose} projectId={projectId} artifact={artifact} onVersionCreated={onOpenArtifact} />
  </>
);
