/**
 * Qué se le dice a quien estaba generando un artefacto cuando la generación
 * falla (F4-05).
 *
 * `pages/Workspace.tsx` importaba la capa de IA sólo para esto: clasificar el
 * error, elegir un titular por categoría y decidir si se puede reintentar y
 * con qué gravedad se informa. Son reglas de producto sobre un fallo, no de
 * pintar, y viven aquí para poderse probar sin montar el Workspace.
 */

import { AIServiceError, classifyAIError } from '../../ai';

export interface GenerationFailureReport {
  readonly category: string;
  readonly status?: number;
  /** El mensaje técnico, para el registro y el detalle desplegable. */
  readonly message: string;
  /** Lo que se le dice a la persona, sin jerga del proveedor. */
  readonly userMessage: string;
  readonly headline: string;
  /** Una línea con categoría, estado y mensaje, para el detalle técnico. */
  readonly technicalDetail: string;
  readonly retryable: boolean;
  /** Autenticación y petición inválida no mejoran reintentando: son errores. */
  readonly severity: 'error' | 'warning';
}

const HEADLINES: Record<string, string> = {
  overloaded: 'Modelo saturado',
  'rate-limit': 'Límite alcanzado',
  timeout: 'Tiempo agotado',
  auth: 'Autenticación fallida',
  network: 'Sin conexión',
};

export const describeGenerationFailure = (error: unknown): GenerationFailureReport => {
  const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
  return {
    category: friendly.category,
    status: friendly.status,
    message: friendly.message,
    userMessage: friendly.userMessage,
    headline: HEADLINES[friendly.category] ?? 'Error en la generación',
    technicalDetail: `category=${friendly.category}; status=${friendly.status ?? 'n/a'}; message=${friendly.message}`,
    retryable: friendly.retryable,
    severity: friendly.category === 'auth' || friendly.category === 'invalid-request' ? 'error' : 'warning',
  };
};
