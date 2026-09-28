import React, { Suspense } from 'react';
import { lazyWithRetry } from '../../routing/lazyWithRetry';
import type { DiagramDetailLinksPanelBodyProps } from './DiagramDetailLinksPanelBody';

export type DiagramDetailLinksPanelProps = DiagramDetailLinksPanelBodyProps;

// Como «Modificar diagrama»: el lienzo lo monta siempre y la ruta Workspace
// está en su techo de bundle, así que el cuerpo se descarga al abrirlo.
const DiagramDetailLinksPanelBody = lazyWithRetry(() => import('./DiagramDetailLinksPanelBody'), { chunkName: 'DiagramDetailLinksPanel' });

/** «Niveles C4» (plan de diagramas, 4.1). Cerrado no cuesta nada. */
export const DiagramDetailLinksPanel: React.FC<DiagramDetailLinksPanelProps> = (props) => {
  if (!props.isOpen) return null;
  return (
    <Suspense fallback={null}>
      <DiagramDetailLinksPanelBody {...props} />
    </Suspense>
  );
};

export default DiagramDetailLinksPanel;
