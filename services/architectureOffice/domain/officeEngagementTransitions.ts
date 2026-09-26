/**
 * Qué se le puede pedir a un encargo, y cuándo.
 *
 * El patrón de referencia es `services/review/reviewTransitions.ts`: funciones
 * puras del estado a un veredicto, probables sin montar nada. Estas reglas
 * vivían dentro de `useCallback`s en `context/OfficeContext.tsx`, mezcladas con
 * el `AbortController` y el `setState`, así que la única forma de comprobar que
 * «el charter debe aprobarse antes de ejecutar» era renderizar un proveedor de
 * React y simular un clic.
 *
 * La regla de gobierno que sostienen es la que da sentido a la Oficina: **nadie
 * ejecuta un encargo que no se ha aprobado.** Un charter es lo que un revisor
 * firma; ejecutarlo antes convierte la aprobación en un trámite posterior a los
 * hechos.
 */

import type { OfficeActor, OfficeAuditAction, OfficeEngagement } from './OfficeTypes';
import { withAuditEntry } from './officeEngagementRecord';

/** Por qué un encargo no puede ejecutarse ahora. */
export type OfficeRunRefusal =
  | { readonly reason: 'charter-not-approved'; readonly message: string }
  | { readonly reason: 'already-running'; readonly message: string };

export type OfficeRunVerdict =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'refused'; readonly refusal: OfficeRunRefusal };

/**
 * ¿Puede correr este encargo?
 *
 * `isRunning` lo aporta el llamador porque «ya se está ejecutando» es un hecho
 * de esta sesión del navegador —un `AbortController` vivo—, no del agregado.
 * El dominio decide la regla; el contexto sabe si su propio runner está ocupado.
 */
export const canRunEngagement = (
  engagement: OfficeEngagement,
  isRunning: boolean,
): OfficeRunVerdict => {
  if (engagement.charter.approvedAt === undefined) {
    return {
      outcome: 'refused',
      refusal: {
        reason: 'charter-not-approved',
        message: 'El charter debe aprobarse antes de ejecutar el encargo.',
      },
    };
  }
  if (isRunning) {
    return {
      outcome: 'refused',
      refusal: { reason: 'already-running', message: 'El encargo ya se está ejecutando.' },
    };
  }
  return { outcome: 'allowed' };
};

/** ¿Está el charter aprobado? La pregunta que más veces se hace sobre un encargo. */
export const isCharterApproved = (engagement: OfficeEngagement): boolean =>
  engagement.charter.approvedAt !== undefined;

/* ── El estado y su rastro, en una sola operación ─────────────────────────── */
/**
 * Cambia el estado de un encargo **dejando escrito por qué**.
 *
 * Hasta ahora eran dos pasos que resultaban estar juntos:
 *
 * ```ts
 * engagement = { ...engagement, status: 'blocked' };
 * engagement = withAuditEntry(engagement, 'engagement-blocked', '…');
 * ```
 *
 * Dos pasos adyacentes no son lo mismo que uno. Una transición que se olvide
 * del segundo produce un cambio de estado sin rastro, y el rastro de auditoría
 * es precisamente lo que una Oficina de Arquitectura tiene que poder enseñar:
 * quién movió el encargo, cuándo y con qué motivo. Ya pasaba en el arranque del
 * runner —`{ ...initial, status: 'in-progress' }` cambiaba el estado y el
 * `run-started` llegaba dos líneas después, por separado—.
 *
 * Aquí el hecho de dominio **es** consecuencia del cambio de estado, no una
 * llamada que haya que recordar. `__tests__/services/aggregates/` comprueba que
 * ningún estado se mueve sin su entrada.
 */
export const transitionEngagement = (
  engagement: OfficeEngagement,
  status: OfficeEngagement['status'],
  action: OfficeAuditAction,
  details: string,
  options: { actor?: OfficeActor; taskId?: string; before?: string; after?: string } = {},
): OfficeEngagement => withAuditEntry({ ...engagement, status }, action, details, {
  ...options,
  before: options.before ?? engagement.status,
  after: options.after ?? status,
});
