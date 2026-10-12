/**
 * Las dos variables que el producto necesita para tener backend.
 *
 * Hasta F9 la suite no las necesitaba: `executeRemoteWrite` comprobaba
 * `isFirebaseAvailable`, y una prueba que doblaba el SDK de Firestore pasaba
 * esa guarda sin decir nada. Con Supabase la comprobación mira el entorno —que
 * es lo correcto, porque es donde vive la configuración— y sin esto **todas**
 * las escrituras de la suite fallarían con «no configurado», que es un modo de
 * fallo real pero no el que cada prueba quiere ejercitar.
 *
 * Los valores son marcadores deliberadamente reconocibles: ningún test habla
 * con la red, y si alguno lo intentara, el host no resuelve. Son los mismos que
 * usa el build de CI, por la misma razón.
 *
 * Un test que **sí** quiera el caso sin configurar lo pone él mismo, como hace
 * `__tests__/services/authService.test.ts`.
 */
const env = import.meta.env as unknown as Record<string, string>;
env.VITE_SUPABASE_URL ||= 'https://ci-placeholder.supabase.co';
env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'ci-placeholder';

/*
 * El español de producción arranca con un núcleo y completa por ruta (14.6).
 * Las pruebas renderizan pantallas sueltas sin pasar por `lazyWithRetry`, así
 * que parten del diccionario completo, que es lo que ven tras la carga en reposo.
 */
import { es } from './lib/i18n/locales/es';
import { mergeSpanish } from './lib/i18n/spanishStore';
mergeSpanish(es);

export {};
