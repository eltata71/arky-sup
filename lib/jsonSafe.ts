/**
 * Dos utilidades que la persistencia necesita y que ya no llevan el nombre de
 * un proveedor.
 *
 * Venían de `lib/firestoreData.ts` y `lib/artifactPersistenceGuards.ts`, que
 * hacían mucho más: recortaban artefactos para caber en el límite de 1 MiB por
 * documento, preparaban actualizaciones parciales frente a sobrescrituras, y
 * declaraban qué campos eran podables. Todo eso era **de Firestore**: una fila
 * `jsonb` de PostgreSQL admite tres órdenes de magnitud más, así que el
 * artefacto se guarda entero y la poda silenciosa —pérdida de datos que sólo se
 * descubría cuando un diagrama se abría vacío— desapareció con el proveedor.
 *
 * Lo que sí sobrevive es lo que no dependía de él:
 *
 *  - `stripUndefined`, porque `JSON.stringify` borra las claves `undefined` de
 *    los objetos y las convierte en `null` dentro de los arrays: dos
 *    comportamientos distintos para el mismo valor ausente, y la diferencia
 *    aparece al leer de vuelta.
 *  - `estimateBytes`, porque el historial de chat sí tiene un tope —el suyo,
 *    de producto: una conversación sin límite es una que nadie puede releer— y
 *    necesita saber cuánto ocupa antes de compactar.
 */

/** El tamaño en bytes de la forma JSON de un valor. `0` si no es serializable. */
export const estimateBytes = (value: unknown): number => {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? new TextEncoder().encode(json).length : 0;
  } catch {
    return 0;
  }
};

/**
 * Quita las claves con valor `undefined`, recursivamente.
 *
 * `Date` se deja intacto a propósito: quien lo guarda quiere una fecha, y
 * recorrerlo como objeto lo convertiría en `{}`.
 */
export const stripUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined)
      .map((entry) => stripUndefined(entry)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = stripUndefined(entry);
    }
    return out as T;
  }
  return value;
};
