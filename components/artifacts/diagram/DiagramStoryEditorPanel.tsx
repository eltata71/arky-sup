import React, { Suspense } from 'react';
import { lazyWithRetry } from '../../routing/lazyWithRetry';
import type { DiagramStoryEditorPanelBodyProps } from './DiagramStoryEditorPanelBody';

export type DiagramStoryEditorPanelProps = DiagramStoryEditorPanelBodyProps;

// Como los otros paneles del lienzo: el cuerpo se descarga al abrirlo.
const DiagramStoryEditorPanelBody = lazyWithRetry(() => import('./DiagramStoryEditorPanelBody'), { chunkName: 'DiagramStoryEditorPanel' });

/** «Editar historia» (plan de diagramas, 4.3). Cerrado no cuesta nada. */
export const DiagramStoryEditorPanel: React.FC<DiagramStoryEditorPanelProps> = (props) => {
  if (!props.isOpen) return null;
  return (
    <Suspense fallback={null}>
      <DiagramStoryEditorPanelBody {...props} />
    </Suspense>
  );
};

export default DiagramStoryEditorPanel;
