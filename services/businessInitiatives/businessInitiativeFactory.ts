/**
 * La única forma de construir una Iniciativa de Negocio.
 *
 * `buildInitiative` ya existía en el repositorio, pero era sólo la mitad: las
 * reglas que deciden si una iniciativa puede existir —tiene título, describe
 * una necesidad— vivían en `context/InitiativeContext.tsx`, encima del
 * constructor y fuera de su alcance. Un segundo llamador —el agente, una
 * importación masiva, una plantilla— habría creado iniciativas sin necesidad de
 * negocio en silencio.
 *
 * Y ésa es exactamente la que no puede faltar. Una iniciativa **es** la razón
 * por la que existe todo lo que cuelga de ella: si no dice qué necesidad
 * cubre, las atenciones que la sirven no pueden explicar para qué se hicieron,
 * que es la pregunta que se hace en un comité de seguimiento.
 *
 * `buildInitiative` se queda como el ensamblador de campos —colecciones vacías
 * en vez de ausentes, para que todo consumidor pueda recorrerlas sin guarda— y
 * esta fábrica es la puerta.
 */

import { buildInitiative, type CreateInitiativeInput } from './BusinessInitiativeRepository';
import type { BusinessInitiative } from './BusinessInitiativeTypes';

/** Por qué no se pudo crear la iniciativa. */
export type BusinessInitiativeRejection =
  | { readonly reason: 'title-required'; readonly message: string }
  | { readonly reason: 'need-required'; readonly message: string }
  | { readonly reason: 'owner-required'; readonly message: string };

export type CreateBusinessInitiativeResult =
  | { readonly outcome: 'created'; readonly initiative: BusinessInitiative }
  | { readonly outcome: 'rejected'; readonly rejection: BusinessInitiativeRejection };

export interface CreateBusinessInitiativeParams {
  readonly input: CreateInitiativeInput;
  /** De quién es. `firestore.rules` autoriza contra este campo. */
  readonly userId: string;
  /** Los códigos ya en uso, para asignar el siguiente `NEG-YYYY-NNN`. */
  readonly existingCodes: readonly string[];
  /** Costura para pruebas. Por defecto, ahora. */
  readonly now?: string;
}

/**
 * Construye una Iniciativa de Negocio, o se niega.
 *
 * Devuelve un resultado en vez de lanzar, por la misma razón que las otras dos
 * fábricas: que falte la necesidad es un desenlace que la interfaz pinta, no
 * una excepción.
 */
export function createBusinessInitiative(
  params: CreateBusinessInitiativeParams,
): CreateBusinessInitiativeResult {
  const title = params.input.title?.trim() ?? '';
  if (!title) {
    return {
      outcome: 'rejected',
      rejection: { reason: 'title-required', message: 'La iniciativa necesita un título.' },
    };
  }

  const need = params.input.need?.trim() ?? '';
  if (!need) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'need-required',
        message: 'Describe la necesidad de negocio. Es la razón por la que existirá todo lo que cuelgue de esta iniciativa.',
      },
    };
  }

  // Sin dueño la regla de Firestore no puede autorizar ni una lectura, así que
  // la iniciativa existiría en memoria y en ningún sitio más.
  if (!params.userId?.trim()) {
    return {
      outcome: 'rejected',
      rejection: {
        reason: 'owner-required',
        message: 'No se puede crear una iniciativa sin una sesión iniciada.',
      },
    };
  }

  return {
    outcome: 'created',
    initiative: buildInitiative(
      { ...params.input, title, need },
      params.userId,
      params.existingCodes,
      params.now ?? new Date().toISOString(),
    ),
  };
}
