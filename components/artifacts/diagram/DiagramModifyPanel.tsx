import React, { Suspense } from 'react';
import { lazyWithRetry } from '../../routing/lazyWithRetry';
import type { DiagramModifyPanelBodyProps } from './DiagramModifyPanelBody';

export type DiagramModifyPanelProps = DiagramModifyPanelBodyProps;

// El panel se descarga al abrirlo: el lienzo lo monta siempre, y la ruta
// Workspace está en su techo de bundle (plan de diagramas, 1.4).
const DiagramModifyPanelBody = lazyWithRetry(() => import('./DiagramModifyPanelBody'), { chunkName: 'DiagramModifyPanel' });

/** «Modificar diagrama». Cerrado no cuesta nada: ni descarga ni estado. */
export const DiagramModifyPanel: React.FC<DiagramModifyPanelProps> = (props) => {
  if (!props.isOpen) return null;
  return (
    <Suspense fallback={null}>
      <DiagramModifyPanelBody {...props} />
    </Suspense>
  );
};

export default DiagramModifyPanel;
