import React, { Suspense } from 'react';
import { lazyWithRetry } from '../../routing/lazyWithRetry';
import type { ArtifactExportModalProps } from './ArtifactExportModal';

// El modal de exportación se descarga al abrirlo: el lienzo lo monta siempre y
// la ruta Workspace está en su techo de bundle (plan de diagramas, 3.4).
const ArtifactExportModalBody = lazyWithRetry(() => import('./ArtifactExportModal'), { chunkName: 'ArtifactExportModal' });

/** «Exportar». Cerrado no cuesta nada: ni descarga ni estado. */
const ArtifactExportModalLazy: React.FC<ArtifactExportModalProps> = (props) => {
  if (!props.isOpen) return null;
  return (
    <Suspense fallback={null}>
      <ArtifactExportModalBody {...props} />
    </Suspense>
  );
};

export default ArtifactExportModalLazy;
