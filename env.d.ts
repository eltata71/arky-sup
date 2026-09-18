/// <reference types="vite/client" />

interface ImportMetaEnv {

  readonly VITE_GEMINI_PROXY_URL?: string;
  readonly VITE_AI_PROXY_URL?: string;
  /**
   * `'true'` makes the AI proxy mandatory: a proxy failure raises a typed,
   * observable error instead of falling back to a direct browser call with
   * the operator's key. Unset/anything else keeps the permissive default.
   */
  readonly VITE_AI_STRICT_PROXY?: string;
  readonly VITE_OPENROUTER_API_KEY?: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID: string;
  /** CI/local integration only; guarded to loopback + demo-arky-e2e. */
  readonly VITE_FIREBASE_USE_EMULATORS?: string;
  /**
   * Selección de backend por contexto (transición Supabase, F3.2).
   *
   * `VITE_BACKEND` fija el valor global y `VITE_BACKEND_<CONTEXTO>` lo anula
   * para un corte vertical concreto (`VITE_BACKEND_SETTINGS`,
   * `VITE_BACKEND_BUSINESSINITIATIVES`, `VITE_BACKEND_LEARNING`…). Un valor
   * desconocido cae a `firebase`, que es el proveedor que hoy atiende: un
   * error de escritura no debe cambiar dónde se guardan los datos.
   *
   * Los overrides por contexto son dinámicos por diseño, así que se declaran
   * con una firma de índice en vez de enumerarlos: el contexto lo decide el
   * corte, no este fichero.
   */
  readonly VITE_BACKEND?: string;
  readonly [backendOverride: `VITE_BACKEND_${string}`]: string | undefined;
  /** Proyecto Supabase del PoC. Nunca la clave `service_role`. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Lista separada por comas de correos habilitados en el piloto Supabase. */
  readonly VITE_SUPABASE_PILOT_EMAILS?: string;
  readonly VITE_ARTIFACT_REFINEMENT_ENABLED?: string;
  readonly VITE_ARTIFACT_REFINEMENT_AI_ENABLED?: string;
  readonly VITE_ARTIFACT_REFINEMENT_MAX_PASSES?: string;
  readonly VITE_STRUCTURED_ARTIFACT_BRIEF_ENABLED?: string;
  readonly VITE_AI_BRIEF_EXTRACTION_ENABLED?: string;
  readonly VITE_TOP3_ARTIFACT_RECOMMENDATIONS_ENABLED?: string;
  readonly VITE_PRESENTATION_COMPILER_ENABLED?: string;
  readonly VITE_PUBLICATION_VIEW_ENABLED?: string;
  readonly VITE_PRESENTATION_EXPORT_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
