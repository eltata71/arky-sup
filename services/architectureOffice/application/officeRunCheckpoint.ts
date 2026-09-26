/**
 * El punto de recuperación de una ejecución: guardarlo, y saber si se guardó.
 *
 * El runner escribe en **cada** transición de tarea, porque un encargo se
 * reanuda en vez de reiniciarse y sin esas escrituras una operación de varios
 * minutos se pierde al recargar. Eso convierte «¿llegó la escritura?» en la
 * pregunta más repetida del motor, y durante mucho tiempo la respuesta fue que
 * nadie la hacía: el `save` del runner tenía un `catch {}` vacío y su puerto
 * estaba tipado `Promise<void>`, así que un fallo **sin** excepción —que es la
 * forma normal, un `{ status: 'conflict', success: false }`— era
 * indistinguible del éxito.
 *
 * Vive fuera del runner para que la política quepa en una prueba sin montar un
 * DAG de tareas, y porque la decisión que encapsula es una sola y merece
 * leerse entera: **qué fallos detienen la ejecución y cuáles no.**
 */

import type { PersistenceResult, PersistenceStatus } from '../../persistence';
import type { OfficeEngagement } from '../domain/OfficeTypes';

export interface OfficeRunCheckpoint {
  /**
   * Guarda y devuelve el encargo con el que seguir.
   *
   * Devuelve lo que confirmó el servidor cuando lo hay, no lo que se envió: lo
   * enviado lleva el testigo de revisión anterior, y con una escritura por
   * transición eso convierte la siguiente en un conflicto garantizado.
   */
  save(engagement: OfficeEngagement): Promise<OfficeEngagement>;
  /** El fallo que debe detener la ejecución, o `null`. */
  readonly failure: PersistenceStatus | null;
  /** Qué decirle a quien lanzó la ejecución. */
  readonly message: string;
}

const messageFor = (failure: PersistenceStatus | null): string => (
  failure === 'conflict'
    ? 'Otra sesión modificó este encargo durante la ejecución. Recarga antes de reanudar.'
    : failure === 'permission-denied'
      ? 'Tu rol no permite guardar el avance de este encargo, así que la ejecución se detuvo.'
      : 'No se pudo guardar el avance del encargo, así que la ejecución se detuvo.'
);

export const createRunCheckpoint = (
  persist: (engagement: OfficeEngagement) => Promise<PersistenceResult<OfficeEngagement>>,
  onProgress?: (engagement: OfficeEngagement) => void,
): OfficeRunCheckpoint => {
  let failure: PersistenceStatus | null = null;

  return {
    async save(engagement) {
      let next = engagement;
      try {
        const result = await persist(engagement);
        if (result.success) {
          if (result.data) next = result.data;
          failure = null;
        } else if (result.status !== 'offline') {
          // `offline` es el único que no detiene: el espejo local conserva el
          // encargo y la degradación existe justo para eso. Un conflicto o un
          // permiso sí detienen, y por motivos opuestos — el primero dice que
          // alguien más lo está moviendo, el segundo que este cambio no se va
          // a guardar nunca.
          failure = result.status;
        }
      } catch {
        // Un puerto que lanza incumple su contrato, pero el runner no es el
        // sitio donde arreglarlo: se trata como el fallo que es.
        failure = 'failed';
      }
      try {
        onProgress?.(next);
      } catch {
        /* un hook de UI no puede romper la ejecución */
      }
      return next;
    },
    get failure() { return failure; },
    get message() { return messageFor(failure); },
  };
};
