// ESLint 9 flat config.
//
// This config is intentionally pragmatic: the codebase has ~5k-line legacy
// service files and turning every rule on at "error" would produce thousands
// of pre-existing violations. Rules are tiered:
//
//   * `error` — security-critical or correctness-critical rules. Must pass.
//   * `warn`  — code-quality rules that surface debt without breaking CI.
//   * `off`   — rules that fight historical patterns (e.g. `any` in
//               geminiService); enable per-file once those modules are split.
//
// Run with: `npm run lint:js` (or `npm run quality` for the full bundle).

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // Build configuration read by PostCSS/Tailwind from the root. The
      // eleven legacy scaffolding scripts that used to need this exemption are
      // gone; `scripts/checkOrphanScripts.mjs` keeps them from returning, and
      // everything in `scripts/` is linted like the rest of the repository.
      'tailwind.config.cjs',
      'postcss.config.cjs',
      // Vendored types or auto-generated files.
      'env.d.ts',
      // F0 diagnostic evidence: frozen local probes/fixtures, not shipped code.
      // (f04-local-probes.cjs uses sandboxed require/Node globals by design.)
      'docs/fase-0/evidencias/**',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  /**
   * Build/maintenance scripts run under Node, not in a browser. Without this
   * block the base config's browser globals leave `process` and `console`
   * undefined, and `no-undef` reports the whole file.
   */
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // ----- Security / correctness — non-negotiable ------------------------
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-debugger': 'error',
      // `confirm()` is used intentionally in danger-zone flows — keep as warn
      // until those flows are migrated to the design-system ConfirmDialog.
      'no-alert': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-expressions': 'warn',
      'no-misleading-character-class': 'warn',
      'no-useless-assignment': 'warn',

      // ----- Quality nudges (warn so CI stays green during cleanup) --------
      '@typescript-eslint/no-explicit-any': 'off', // re-enable per-file when geminiService is split
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': ['warn', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-binary-expression': 'warn',
      'no-prototype-builtins': 'off',
      'no-async-promise-executor': 'warn',
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'off',
    },
  },

  {
    // Tests get a slightly looser ruleset because vi.fn / vi.mock generate
    // unused parameters and `any`-typed shapes by design.
    files: ['__tests__/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // Newly-authored modules are held to a tighter standard.
    files: ['lib/security.ts', 'lib/ids.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },

  {
    // ----- Model independence: two boundaries, one rule ------------------
    //
    // Reaching for `@google/genai` outside a Gemini adapter is how the product
    // became coupled to one vendor: a schema described with Google's `Type`
    // enum is a schema no other provider can honour, and the degradation is
    // invisible because the call still succeeds.
    //
    // Reaching for the engine (`services/geminiService`) outside `services/ai`
    // is how the canonical layer became ornamental: the façades existed and
    // every call site went around them. It also pulled a 600 kB module into
    // whichever chunk did the importing, which is how the entry bundle reached
    // 2.7 MB.
    //
    // Both restrictions live in one rule declaration on purpose. ESLint flat
    // config replaces a rule's options rather than merging them, so declaring
    // them in two blocks would silently disable whichever came first for any
    // file both blocks matched. The exemptions are expressed as relaxations
    // below instead.
    files: ['**/*.{ts,tsx}'],
    ignores: ['__tests__/**', 'api/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@google/genai',
          message:
            'Describe la salida con `AIJsonSchema` de services/ai/schema. Cada proveedor traduce el esquema en su propia frontera; importar el SDK aquí vuelve a atar el dominio a un solo modelo.',
        }],
        patterns: [{
          group: ['**/services/geminiService', '**/geminiService'],
          message:
            'Importa la fachada de dominio desde `services/ai` (artifactGenerationService, assistantService, diagramGenerationService, learningService, documentGenerationService, recommendationService) o `aiGateway` si compones tu propio prompt. El motor es un detalle interno de services/ai.',
        }],
      }],
    },
  },

  {
    /**
     * The UI layers do not talk to an SDK.
     *
     * `no-restricted-imports` above covers the model SDK and the legacy engine
     * but never mentioned Firebase, so `AuthContext` importing fifteen symbols
     * from `firebase/auth` broke no rule — it broke a convention, which is the
     * kind of thing that survives review indefinitely. Firestore was already
     * behind `firestoreService`; Auth is now behind `services/authService`,
     * and this makes both mechanical.
     *
     * Scoped to the presentation layers on purpose: `services/` is where the
     * adapters live, and `firebase.ts` is the app bootstrap.
     */
    files: ['components/**/*.{ts,tsx}', 'pages/**/*.{ts,tsx}', 'context/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@google/genai',
          message:
            'Describe la salida con `AIJsonSchema` de services/ai/schema. El SDK vive en su adaptador.',
        }],
        patterns: [
          {
            group: ['firebase/auth', 'firebase/firestore', 'firebase/app'],
            message:
              'La UI no habla con un SDK. Usa `services/authService` para autenticación y `services/firestoreService` para datos: así las reglas de sesión se pueden probar sin montar un árbol de React.',
          },
          {
            group: ['**/services/geminiService', '**/geminiService'],
            message:
              'Importa la fachada de dominio desde `services/ai` o `aiGateway` si compones tu propio prompt.',
          },
        ],
      }],
    },
  },

  {
    /**
     * The Firestore SDK lives where persistence lives, and nowhere else.
     *
     * The same holds for `firebase/auth`, behind `services/authService`.
     *
     * `CLAUDE.md` said all Firestore access went through `firestoreService`,
     * `trainingService` and `userService`. It did not: the review repository
     * was a fourth way in, and nothing would have stopped a fifth. The cost of
     * a fifth is not style — each one invents its own answer to "what happens
     * when the write does not land", and one of them answered `console.warn`.
     *
     * So the list is here rather than in prose. A new context that needs to
     * persist something writes a repository over `services/persistence`; if it
     * genuinely needs the SDK, adding itself to this list is a review decision
     * someone has to make on purpose.
     */
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '__tests__/**',
      'api/**',
      'firebase.ts',
      'services/persistence/**',
      'services/identity/**',
      'services/learning/**',
      // El adaptador de cada contexto. Antes de la Ola 2 esta lista decía
      // `services/firestoreService.ts` y nada más, porque un único fichero de
      // 1 379 líneas guardaba siete contextos. Al repartirlo, cada uno tiene el
      // suyo — y la lista sigue siendo explícita a propósito: un patrón como
      // `services/**/*Repository.ts` dejaría entrar al SDK en cualquier fichero
      // nuevo que acertara con el nombre, que es justo lo que esta regla existe
      // para no permitir.
      'services/agent/AgentActionRepository.ts',
      'services/architectureOffice/OfficeAgentProfileRepository.ts',
      'services/architectureOffice/OfficeEngagementRepository.ts',
      'services/architectureProjects/projectDocumentMapper.ts',
      'services/architectureProjects/projectReads.ts',
      'services/architectureProjects/projectWrites.ts',
      'services/artifacts/artifactPersistence.ts',
      'services/businessInitiatives/BusinessInitiativeRepository.ts',
      'services/chat/ChatHistoryRepository.ts',
      'services/review/firestoreArtifactReviewRepository.ts',
      'services/settings/SettingsRepository.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@google/genai',
          message:
            'Describe la salida con `AIJsonSchema` de services/ai/schema. El SDK vive en su adaptador.',
        }],
        patterns: [
          {
            group: ['firebase/firestore', 'firebase/auth'],
            message:
              'El SDK vive en su adaptador: la persistencia entra por un repositorio de contexto sobre `services/persistence`, y la sesión por `services/identity`. Cuatro caminos distintos al SDK es como el Centro de Formación acabó degradando a localStorage con un console.warn sin decírselo a nadie.',
          },
          {
            group: ['**/services/geminiService', '**/geminiService'],
            message:
              'Importa la fachada de dominio desde `services/ai` o `aiGateway` si compones tu propio prompt.',
          },
          {
            /**
             * A screen must not reach into a provider's adapter.
             *
             * `SettingsPage` imported `providers/openrouter/openRouterModels`
             * directly to list models. Nothing was broken by it, which is the
             * point: no rule existed, and a file was simply the shortest path —
             * the same shortest path that tied the product to one vendor the
             * first time. Ask `listModelsForProvider` instead; adding a
             * provider is then a case in a façade, not an edit to a screen.
             */
            group: ['**/services/ai/providers/**'],
            message:
              'La UI no conoce adaptadores de proveedor. Pregunta a una fachada de `services/ai` (por ejemplo `listModelsForProvider`); el adaptador es un detalle de esa capa.',
          },
        ],
      }],
    },
  },

  {
    /**
     * The public API of `services/ai` does not resolve to the engine.
     *
     * This is the narrow half of the rule below: inside `services/ai` the
     * engine is a legitimate internal dependency — a façade delegating to it is
     * the whole strangler pattern — but the *barrel* is the layer's published
     * surface. While it re-exported `AIServiceError`, `classifyAIError` and the
     * deterministic fallbacks straight out of `services/geminiService`, seven
     * screens were catching the monolith's symbols through the door built to
     * hide it, and nothing said so.
     *
     * If a symbol belongs in the public API, give it a home in this layer
     * (`./errors`, `./core`, `./generation`) or in `lib/artifacts` when it is a
     * contract with no behaviour. Re-exporting the engine is not a home.
     */
    files: ['services/ai/index.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/services/geminiService', '**/geminiService', '../geminiService'],
          message:
            'El barril es la API pública de la capa: no puede reexportar el motor. Dale casa al símbolo en `services/ai/errors`, `services/ai/core` o `services/ai/generation`, o en `lib/artifacts` si es un contrato sin comportamiento.',
        }],
      }],
    },
  },

  {
    // Inside `services/ai` the engine is a legitimate internal dependency —
    // that is precisely what the façades wrap. The SDK restriction still holds.
    files: ['services/ai/**/*.{ts,tsx}'],
    ignores: ['services/ai/index.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@google/genai',
          message:
            'Sólo el adaptador de Gemini habla con el SDK. Usa `AIJsonSchema` de services/ai/schema.',
        }],
      }],
    },
  },

  {
    // The Gemini adapter and the legacy client factory are where the SDK is
    // meant to live; the engine is the module the rule protects. The list is
    // expected to shrink: `services/aiProvider.ts` loses its exemption when
    // client construction moves fully behind the provider layer.
    files: [
      'services/ai/providers/gemini/**/*.ts',
      'services/geminiService.ts',
      'services/aiProvider.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
