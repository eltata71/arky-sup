/**
 * La revisión de una iniciativa: el contador optimista de su fila.
 *
 * Es **la versión de la fila**, no el acto de revisar nada —la colisión que
 * registra el lenguaje ubicuo (`04-lenguaje-ubicuo.md`, D-3)—. Ninguna pantalla
 * la muestra: viaja con el registro que se está viendo (F2-10) y la base de
 * datos la compara al guardar o borrar. Por eso vive aquí como un objeto de
 * valor con dos reglas, y no como un `number` que cada llamante interpreta:
 *
 *  1. **Sólo es válida si es un entero positivo.** Cualquier otra cosa —un
 *     documento viejo, un espejo local mal escrito— se lee como «desconocida».
 *  2. **Desconocida no es 1.** Una iniciativa que nunca llegó a la base se
 *     compara con `0`, que la base sólo acepta para crear: una escritura que
 *     no sabe contra qué fila va se rechaza, en vez de pisar a la que ganó.
 */

/** La revisión que se envía para una iniciativa que todavía no existe en la base. */
export const UNSTORED_REVISION = 0;

/** Una revisión leída de donde sea, o `undefined` si no es utilizable. */
export const toInitiativeRevision = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

/** Lo que hay que enviar como revisión esperada al escribir sobre este registro. */
export const expectedRevisionOf = (initiative: { readonly revision?: number }): number =>
  toInitiativeRevision(initiative.revision) ?? UNSTORED_REVISION;
