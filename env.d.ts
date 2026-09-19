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
  /**
   * Selección de backend por contexto.
   *
   * `VITE_BACKEND` fija el valor global y `VITE_BACKEND_<CONTEXTO>` lo anula
   * para un corte vertical concreto. Tras F9 hay un solo proveedor —Supabase—
   * y un valor desconocido cae a él: un error de escritura en una variable no
   * debe cambiar dónde se guardan los datos.
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
