/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
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
