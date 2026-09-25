import React from 'react';
import { Alert, Button, PageSkeleton } from '../ui';

interface EngagementRoomFallbackProps {
  /** The Office cannot yet tell whether the engagement exists. */
  resolving: boolean;
  onBack: () => void;
}

/**
 * What the engagement room shows when it has no engagement to show (F6-04).
 *
 * «I don't know yet» and «it does not exist» are different answers. The room
 * used to give both in one sentence — «no existe o todavía no se ha cargado» —
 * while loading, and an E2E journey read the load as «already signed» and
 * skipped the signature. Now it shows the load until the Office has resolved
 * (`OfficeContext.isResolving`), and only then says the engagement is not there.
 */
export const EngagementRoomFallback: React.FC<EngagementRoomFallbackProps> = ({ resolving, onBack }) => (
  <div className="min-h-[100dvh] px-4 py-6 md:pl-20 md:pr-8">
    {resolving ? (
      <div className="mx-auto max-w-5xl">
        <PageSkeleton label="Cargando el entregable" tiles={4} panels={2} />
      </div>
    ) : (
      <div className="mx-auto max-w-3xl">
        <Alert tone="warning" title="Entregable no encontrado">
          El entregable que buscas no existe, o no tienes acceso a él.
        </Alert>
        <Button className="mt-4" variant="secondary" onClick={onBack}>
          Volver al panel de la Oficina
        </Button>
      </div>
    )}
  </div>
);
