/**
 * Las identidades del agregado Iniciativa y de sus entidades internas.
 *
 * Vivían en el repositorio, y por eso un panel de React importaba un fichero de
 * infraestructura sólo para acuñar el id de un indicador (F3-05). Acuñar un id
 * es una regla del modelo —qué prefijo lleva cada cosa—, no de su persistencia.
 */

import { newPrefixedId } from '../../../lib/ids';

export const newInitiativeId = (): string => newPrefixedId('init');
export const newOutcomeId = (): string => newPrefixedId('out');
export const newKpiId = (): string => newPrefixedId('kpi');
export const newRiskId = (): string => newPrefixedId('risk');
export const newStakeholderId = (): string => newPrefixedId('sth');
export const newDocumentId = (): string => newPrefixedId('doc');
export const newMilestoneId = (): string => newPrefixedId('ms');

/** Si un texto tiene forma de id de iniciativa. No comprueba que exista. */
export const isInitiativeId = (value: unknown): value is string =>
  typeof value === 'string' && /^init[_-][A-Za-z0-9_-]+$/.test(value);
