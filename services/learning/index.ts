/**
 * `services/learning` — el Centro de Formación como contexto propio.
 *
 * `trainingService` estaba suelto en la raíz de `services/` y es el único
 * camino a las colecciones del LMS: `courses`, `users/{uid}/lms_progress`,
 * `lms_context` y `lms_notes`. Nunca se cruzan entre sí.
 *
 * Es el contexto que da nombre a la regla del SDK. Antes de que existiera
 * `services/persistence`, este servicio degradaba a `localStorage` con un
 * `console.warn` y no se lo decía a nadie; hoy devuelve un `PersistenceResult`
 * como cualquier otra escritura, y por eso `TrainingWriteResult` es un alias y
 * no un tipo nuevo.
 *
 * La *generación* de contenido del LMS no vive aquí: fue el primer vertical de
 * la migración por estrangulamiento y está en `services/ai/generation/learning`,
 * detrás de `learningService`. Este módulo persiste; aquél genera.
 */
export {
  createSupabaseLearningRepository,
  sanitizeLearningForRemote,
  type SupabaseLearningClientLike,
  type SupabaseLearningRepository,
} from './SupabaseLearningRepository';
export { trainingService, type TrainingWriteResult } from './trainingService';
