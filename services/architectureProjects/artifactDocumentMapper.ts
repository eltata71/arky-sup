/**
 * Cómo un `Artifact` se convierte en un documento de Firestore.
 *
 * Vive en `architectureProjects` y no en `services/artifacts` por la frontera
 * del agregado: un artefacto se guarda **dentro** de un proyecto, y es el
 * proyecto quien lo escribe cuando se crea entero. Tenerlo del otro lado hacía
 * que `createProject` importara de `services/artifacts` mientras
 * `services/artifacts` importaba el índice de aquí — un ciclo que el gate de
 * fronteras rechazó, con razón: dos módulos que se importan mutuamente son uno
 * solo con el doble de superficie.
 *
 * `services/artifacts` lo importa desde aquí para escribir un artefacto suelto.
 * La dirección es una.
 *
 * Un artefacto es lo más pesado que guarda este producto —contenido, IR del
 * diagrama, plan de maquetación, trazas— y es el que se acerca al límite de
 * 1 MiB por documento. `prepareArtifactForFirestore` poda campos derivados
 * cuando hace falta, en un orden que empieza por lo que se puede recalcular, y
 * `reportArtifactPruning` **lo dice**: una poda silenciosa es una pérdida de
 * datos que nadie descubre hasta que el diagrama se abre vacío.
 */

import type { Artifact } from '../../types';
import {
  prepareArtifactForFirestore,
  type PrunableArtifactField,
} from '../../lib/artifactPersistenceGuards';
import { observabilityService } from '../observability';

/**
 * Builds the Firestore-ready artifact document.
 *
 * Returns the prepared document and a pruning summary (empty when the
 * artifact comfortably fits inline). Callers that need to react to pruning
 * — e.g. emit observability — can inspect `prunedFields`. May throw
 * `PersistenceValidationError` when the document exceeds Firestore's
 * per-document hard limit even after dropping every ephemeral field.
 */
export const toArtifactDocument = (artifact: Artifact): {
    document: Record<string, unknown>;
    prunedFields: PrunableArtifactField[];
    sizeBytes: number;
} => {
    const prepared = prepareArtifactForFirestore(artifact);
    return { document: prepared.document, prunedFields: prepared.prunedFields, sizeBytes: prepared.sizeBytes };
};

/**
 * Records an observability warning whenever the persistence pipeline had to
 * drop ephemeral fields to keep the document under Firestore's hard limit.
 * The user-visible artifact is untouched (content, IR, narrative survive);
 * only provenance/troubleshooting fields are pruned. Surfacing this signal
 * lets the team see when the app is operating near the limit and plan an
 * external-storage migration with real telemetry.
 */
export const reportArtifactPruning = (params: {
    operationName: string;
    projectId: string;
    artifactId: string;
    prunedFields: PrunableArtifactField[];
    sizeBytes: number;
}): void => {
    if (params.prunedFields.length === 0) return;
    observabilityService.recordWarning({
        source: 'operation',
        title: 'Artefacto recortado antes de persistir',
        message: `Se descartaron campos efímeros (${params.prunedFields.join(', ')}) para mantener el documento bajo el límite de Firestore. El contenido visible del artefacto no se vio afectado.`,
        operationName: params.operationName,
        userVisible: false,
        recoverable: true,
        metadata: {
            projectId: params.projectId,
            artifactId: params.artifactId,
            prunedFields: params.prunedFields.join(','),
            sizeBytes: params.sizeBytes,
        },
    });
};

