/**
 * Qué se le puede pedir a un encargo, quién lo escribe y qué pasa si no se
 * escribe.
 *
 * Esto vivía dentro de `context/OfficeContext.tsx`, mezclado con el
 * `AbortController`, el `setState` y las importaciones diferidas. Era el sitio
 * equivocado por la razón de siempre —un fichero cuyo trabajo es renderizar no
 * debería decidir la política de una oficina de arquitectura— y también por una
 * concreta y comprobable: la única forma de ejercitar «qué pasa si la escritura
 * falla» era montar un proveedor de React, y por eso nadie la ejercitaba. Las
 * seis operaciones devolvían `ok: true` pasara lo que pasara.
 *
 * Aquí no hay React ni SDK. Todo entra por dos puertos:
 *
 *  - `EngagementWritePort` — cómo se escribe. Lo implementa el repositorio.
 *  - `CharterRefinementPort` — cómo se le pide al modelo que mejore un charter.
 *    Opcional: sin él queda el plan determinista, que es un plan ejecutable
 *    completo. Un modelo no disponible degrada la calidad del plan, nunca su
 *    existencia.
 *
 * `onDraft` es el tercero y es distinto: no es infraestructura sino la
 * actualización optimista. La escritura puede tardar y el trabajo ya está
 * hecho; enseñarlo antes de confirmarlo es correcto **si** después se dice la
 * verdad sobre si se confirmó. Esa segunda mitad es la que faltaba.
 */

import type { PersistenceResult, PersistenceStatus } from '../../persistence';
import {
  applyCharterRefinement,
  buildCharterRefinementPrompt,
  planCharterDeterministic,
} from '../OfficeEngagementPlanner';
import {
  approveCharter as approveCharterRule,
  attachGateAssessment,
  decideEngagement as decideEngagementRule,
} from '../OfficeArbService';
import { evaluateOfficeQualityGates } from '../officeQualityGates';
import { createOfficeEngagement } from '../officeEngagementFactory';
import type {
  OfficeActor,
  OfficeArbDecision,
  OfficeArbVerdict,
  OfficeCharter,
  OfficeEngagement,
  OfficeEngagementPriority,
} from '../OfficeTypes';

/** Un proyecto, con lo poco que estas operaciones necesitan saber de él. */
export interface EngagementProjectRef {
  readonly id: string;
  readonly initiativeIds?: string[];
  readonly linkedBusinessProjects?: string[];
}

export interface EngagementWritePort {
  save(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>>;
  remove(
    projectId: string,
    engagementId: string,
    expectedRevision: number,
  ): Promise<PersistenceResult<void>>;
  /**
   * Firma la decisión del comité y transiciona el encargo, atómicamente.
   *
   * Eran dos escrituras y el orden importaba. Ninguna ordenación las arreglaba
   * del todo —sólo una transacción elimina el estado intermedio— y una
   * transacción entre dos tablas no se escribe desde el navegador. Ver ADR-102.
   */
  decide(
    engagement: OfficeEngagement,
    decision: OfficeArbDecision,
  ): Promise<PersistenceResult<OfficeEngagement>>;
}

/** Pedirle al modelo un charter mejor. Devuelve el texto crudo; puede fallar. */
export type CharterRefinementPort = (prompt: string) => Promise<string>;

export interface EngagementOperationDeps {
  readonly writes: EngagementWritePort;
  /** Se llama con el estado a mostrar antes de confirmarlo. */
  readonly onDraft?: (engagement: OfficeEngagement) => void;
}

export interface OfficeOperationResult {
  ok: boolean;
  engagement?: OfficeEngagement;
  reason?: string;
  /**
   * Cómo terminó la escritura, cuando la operación hizo alguna.
   *
   * Existe porque «no se pudo guardar» y «las reglas dijeron que no» piden
   * cosas distintas de quien lo lee: lo primero se reintenta o se recarga, lo
   * segundo no se reintenta nunca. Ausente significa que no se llegó a
   * escribir — la operación se rechazó antes.
   */
  persistence?: PersistenceStatus;
}

/**
 * Por qué una escritura no confirmada no es un éxito, dicho una sola vez.
 *
 * El mensaje nombra la acción que quien lo lee puede tomar, no el código de
 * PostgreSQL: un conflicto se recarga, un permiso no se reintenta, y sin red el
 * trabajo quedó en el espejo local.
 */
export const describePersistenceFailure = (
  result: PersistenceResult<unknown>,
  engagement: OfficeEngagement,
): OfficeOperationResult => ({
  ok: false,
  engagement,
  persistence: result.status,
  reason: result.status === 'conflict'
    ? 'Otra sesión modificó este encargo. Recarga antes de volver a intentarlo.'
    : result.status === 'permission-denied'
      ? 'Tu rol no permite guardar este cambio.'
      : result.status === 'offline'
        ? 'Sin conexión: el cambio quedó sólo en este dispositivo.'
        : result.message ?? 'No se pudo guardar el cambio.',
});

/**
 * Muestra, escribe, y se queda con lo que devolvió el servidor.
 *
 * Lo último no es detalle: lo enviado lleva el testigo de revisión anterior, y
 * la Oficina escribe en cada transición, así que quedarse con él convierte la
 * siguiente escritura en un conflicto garantizado.
 */
const persist = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
): Promise<PersistenceResult<OfficeEngagement>> => {
  deps.onDraft?.(engagement);
  const result = await deps.writes.save(engagement);
  if (result.success && result.data) deps.onDraft?.(result.data);
  return result;
};

const confirmed = (
  result: PersistenceResult<OfficeEngagement>,
  fallback: OfficeEngagement,
): OfficeOperationResult => (
  result.success
    ? { ok: true, engagement: result.data ?? fallback, persistence: result.status }
    : describePersistenceFailure(result, fallback)
);

/* ── Intake ──────────────────────────────────────────────────────────────── */

export interface CreateEngagementCommand {
  projectId: string;
  title: string;
  brief: string;
  initiativeIds?: string[];
  businessProjectIds?: string[];
  priority?: OfficeEngagementPriority;
  dueAt?: string;
  maxDeliverables?: number;
  /** Salta el refinamiento por IA (pruebas y modo sin conexión). */
  deterministicOnly?: boolean;
}

export const createEngagementOperation = async (
  deps: EngagementOperationDeps & { readonly refineCharter?: CharterRefinementPort },
  project: EngagementProjectRef,
  command: CreateEngagementCommand,
  actor: OfficeActor,
): Promise<OfficeOperationResult> => {
  const scaffold = planCharterDeterministic({
    title: command.title,
    brief: command.brief,
    maxDeliverables: command.maxDeliverables,
  });

  let charter: OfficeCharter = scaffold;
  if (!command.deterministicOnly && deps.refineCharter) {
    try {
      const raw = await deps.refineCharter(
        buildCharterRefinementPrompt({ title: command.title, brief: command.brief }, scaffold),
      );
      charter = applyCharterRefinement(scaffold, raw).charter;
    } catch {
      // El charter determinista es un plan completo y ejecutable.
    }
  }

  const created = createOfficeEngagement({
    projectId: command.projectId,
    title: command.title,
    brief: command.brief,
    // El entregable hereda las iniciativas de su atención salvo que la intake
    // las haya estrechado. Qué pasa si no queda ninguna lo decide la fábrica.
    initiativeIds: command.initiativeIds ?? project.initiativeIds ?? [],
    businessProjectIds: command.businessProjectIds ?? project.linkedBusinessProjects ?? [],
    charter,
    priority: command.priority,
    dueAt: command.dueAt,
    createdBy: actor,
  });
  if (created.outcome === 'rejected') {
    return { ok: false, reason: created.rejection.message };
  }

  return confirmed(await persist(deps, created.engagement), created.engagement);
};

/* ── Gobernanza ──────────────────────────────────────────────────────────── */

export const approveCharterOperation = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  actor: OfficeActor,
): Promise<OfficeOperationResult> => {
  const result = approveCharterRule(engagement, actor);
  if (!result.ok) return { ok: false, reason: result.reason };
  // Una aprobación que no se guardó no es una aprobación: el paso siguiente es
  // ejecutar, y ejecutar sobre un charter que el servidor no tiene aprobado es
  // justo lo que la regla de gobierno impide.
  return confirmed(await persist(deps, result.engagement), result.engagement);
};

export const evaluateGatesOperation = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  project: Parameters<typeof evaluateOfficeQualityGates>[0],
): Promise<OfficeOperationResult> => {
  const updated = attachGateAssessment(engagement, evaluateOfficeQualityGates(project));
  return confirmed(await persist(deps, updated), updated);
};

/**
 * La decisión del comité.
 *
 * Una sola escritura, y ésa es toda la historia.
 *
 * Eran dos —el registro inmutable y la transición del encargo— sin transacción
 * entre ellas, así que los dos estados intermedios eran posibles. El peor no
 * perdía el dato: lo inventaba. El documento del encargo lleva un espejo
 * `arbDecisions` para leer rápido, y la escritura que guardaba el encargo lo
 * guardaba con él — de modo que si la otra fallaba, la pantalla mostraba una
 * decisión firmada que el registro a prueba de manipulación, el único que una
 * auditoría acepta, no tenía.
 *
 * Poner el registro primero mejoraba el estado intermedio —queda el honesto: la
 * decisión consta y el encargo no ha transicionado— pero no lo eliminaba. Lo
 * elimina `api.decide_engagement`, que hace las dos cosas en una transacción,
 * comprueba en el servidor lo que el navegador no puede garantizar (estado
 * previo, correspondencia entre veredicto y estado nuevo, revisión vigente,
 * firma de la sesión) y **reconstruye el espejo desde el registro** en vez de
 * copiarlo de lo que llegó.
 *
 * Lo que sigue viviendo aquí es la regla de negocio: qué veredicto lleva a qué
 * estado, qué dice la entrada de auditoría, y cuándo una aprobación no procede.
 * Duplicarla en SQL crearía dos definiciones de la misma regla, que es el
 * defecto D-4 otra vez.
 */
export const decideEngagementOperation = async (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  input: { verdict: OfficeArbVerdict; rationale: string; actor: OfficeActor },
): Promise<OfficeOperationResult> => {
  const result = decideEngagementRule(engagement, input);
  if (!result.ok || !result.decision) {
    return { ok: false, reason: result.reason ?? 'La decisión no produjo un veredicto.' };
  }

  deps.onDraft?.(result.engagement);
  const decided = await deps.writes.decide(result.engagement, result.decision);
  if (!decided.success) {
    // No hay nada a medias que deshacer: la transacción no ocurrió. Lo único
    // que hay que deshacer es el optimismo de la pantalla.
    deps.onDraft?.(engagement);
    return {
      ...describePersistenceFailure(decided, engagement),
      reason: decided.status === 'permission-denied'
        ? 'Tu rol no permite firmar decisiones del comité.'
        : decided.status === 'conflict'
          ? 'El encargo cambió mientras decidías. Recarga y vuelve a firmar sobre la versión vigente.'
          : describePersistenceFailure(decided, engagement).reason,
    };
  }

  const confirmedEngagement = decided.data ?? result.engagement;
  deps.onDraft?.(confirmedEngagement);
  return { ok: true, engagement: confirmedEngagement, persistence: decided.status };
};

/**
 * Borrar.
 *
 * `onRestore` existe porque el borrado optimista tiene un modo de fallo propio:
 * un encargo que sigue en la base y ha desaparecido de la pantalla es peor que
 * un borrado que falla, porque lo siguiente que hace quien lo ve es volver a
 * crearlo.
 */
export const deleteEngagementOperation = async (
  deps: EngagementOperationDeps & { readonly onRestore?: (engagement: OfficeEngagement) => void },
  engagement: OfficeEngagement,
): Promise<OfficeOperationResult> => {
  const removed = await deps.writes.remove(
    engagement.projectId,
    engagement.id,
    // La revisión del snapshot que se está viendo, no la de la última lectura.
    engagement.revision ?? 0,
  );
  if (!removed.success) {
    deps.onRestore?.(engagement);
    return describePersistenceFailure(removed, engagement);
  }
  return { ok: true, persistence: removed.status };
};
