import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { validateProductionRuntimeConfig } from './lib/runtimeConfig';

/**
 * Resolve the npm package name for a module id inside `node_modules`.
 * Handles scoped packages (`@scope/name`) and pnpm-style nested paths.
 */
function packageNameOf(id: string): string {
  const afterNodeModules = id.split('node_modules/').pop() ?? '';
  const segments = afterNodeModules.split('/');
  if (segments[0]?.startsWith('@')) {
    return `${segments[0]}/${segments[1] ?? ''}`;
  }
  return segments[0] ?? '';
}

/**
 * Split heavy, eagerly-loaded vendor dependencies into dedicated chunks.
 *
 * Goal: stop shipping 2 MB+ monolith chunks (`main`, `Workspace`). Large
 * single chunks are the main trigger of iPad/Safari chunk-load failures and
 * memory pressure. Splitting them yields smaller, independently-cacheable,
 * parallel-downloadable files.
 *
 * IMPORTANT: packages used by both boot and lazy routes must not share a
 * manual chunk. Dagre is needed by boot-path artifact validation, while the
 * ReactFlow runtime belongs to the lazy Workspace canvas; grouping both as
 * `vendor-graph` made Rollup preload ReactFlow for every visitor. Everything
 * else returns `undefined` so Rollup's default lazy boundaries are preserved.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  const pkg = packageNameOf(id);

  if (pkg === 'firebase' || pkg.startsWith('@firebase')) return 'vendor-firebase';
  if (pkg === 'reactflow' || pkg.startsWith('@reactflow')) return 'vendor-reactflow';
  if (pkg === 'dagre' || pkg.startsWith('@dagrejs')) return 'vendor-dagre';
  if (
    pkg === 'react' ||
    pkg === 'react-dom' ||
    pkg === 'scheduler' ||
    pkg === 'react-router' ||
    pkg === 'react-router-dom'
  ) {
    return 'vendor-react';
  }
  if (pkg === 'motion' || pkg === 'framer-motion') return 'vendor-motion';
  if (pkg === '@excalidraw/excalidraw') return 'vendor-excalidraw';

  return undefined;
}

/**
 * Coverage floors.
 *
 * Set from a measurement, not from an aspiration: a threshold above the real
 * figure fails every build until someone lowers it, and a threshold far below
 * it never catches anything. These sit just under the measured values so
 * ordinary noise does not fail CI, and a genuine regression does.
 *
 * The per-path floors are higher because those modules decide who may do what,
 * what reaches the DOM, and whether a provider key leaves the browser. A
 * regression there is not the same kind of event as a regression in a chart
 * component.
 */
const THRESHOLDS = {
  // Measured 2026-08-30 over the `include` list below: 62.18 / 53.69 / 54.45 / 63.90.
  // Raise these as the gaps named in `docs/plan-consolidacion-tecnica-2026-08-30.md`
  // close; never lower one to make a build pass.
  statements: 61,
  branches: 52,
  functions: 53,
  lines: 63,

  // Authorization. `lib/authz` is the single definition of who may do what,
  // transcribed independently by 131 specs and compared cell by cell against
  // `firestore.rules`. Anything less than complete here means a cell of that
  // matrix is asserted by nobody.
  'lib/authz/**': { statements: 100, branches: 95, functions: 100, lines: 100 },

  // Everything that reaches the DOM as HTML.
  'lib/richText/**': { statements: 90, branches: 85, functions: 95, lines: 95 },

  // The decision about whether a provider key may leave the browser.
  'services/ai/aiProxy*.ts': { statements: 90, branches: 85, functions: 90, lines: 95 },
  'services/ai/byokConsent.ts': { statements: 80, branches: 80, functions: 90, lines: 85 },

  // The guards that keep a write inside Firestore's document limit.
  'lib/artifactPersistenceGuards.ts': { statements: 90, branches: 80, functions: 95, lines: 90 },

  // Security primitives and id generation, already held to stricter lint rules.
  'lib/security.ts': { statements: 85, branches: 75, functions: 100, lines: 95 },
  'lib/ids.ts': { statements: 90, branches: 75, functions: 100, lines: 90 },

  // Persistence: what the user is told when a write fails, and what happens to
  // the data when it does. The glob follows the module — `services/persistence.ts`
  // became `services/persistence/`, and a per-path threshold whose glob no
  // longer matches anything stops applying without failing, which is the
  // quietest way to lose a gate.
  'services/persistence/**': { statements: 75, branches: 72, functions: 85, lines: 76 },
};

/**
 * What neither project should pick up.
 *
 * `e2e/` holds Playwright specs: they need a real browser and run through
 * `npm run e2e`. Collecting them here would fail on the first import.
 */
const SHARED_EXCLUDE = ['node_modules', 'dist', '.idea', '.git', '.cache', 'e2e/**'];

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    const loaded = loadEnv(mode, process.cwd(), '');
    const merged: Record<string, string | undefined> = { ...loaded, ...process.env, MODE: mode };
    if (merged.VITE_DISABLE_RUNTIME_CONFIG_GATE === 'true') {
      console.warn(
        '[runtime-config] Production configuration gate DISABLED by VITE_DISABLE_RUNTIME_CONFIG_GATE=true. '
        + 'Unsafe settings (public provider keys, missing proxy/Firebase boundaries) will NOT fail this build.',
      );
    } else {
      const issues = validateProductionRuntimeConfig(merged);
      if (issues.length > 0) {
        const details = issues.map(({ variable, message }) => `  - ${variable}: ${message}`).join('\n');
        throw new Error(`Production configuration gate failed:\n${details}`);
      }
    }
  }

  return ({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  test: {
    globals: false,
    // Los tests de rasterizacion (mermaid -> DOM) y de fallback a Gemini
    // tardan >5s en entornos jsdom. Un timeout global de 20s evita falsos
    // positivos por "timeout" mientras la maquina esta bajo carga.
    testTimeout: 20000,

    /**
     * Two projects, because the environment was the suite's dominant cost.
     *
     * Measured before this split: `environment` accumulated 212.9 s across
     * workers against 50.6 s of actual test execution — building a DOM cost
     * 4.2 times what running the assertions cost. The cause was that
     * `environment: 'jsdom'` was declared for all 371 files, and about 270 of
     * them never touch a DOM: they are services, parsers, validators and pure
     * TypeScript reducers. On CI that single step was 8 m 49 s of an 11 m 13 s
     * job.
     *
     * The rule is deliberately simple, so nobody has to come here to look it
     * up:
     *
     *   - A test that **renders** is a `.test.tsx` file. It runs in jsdom,
     *     with jest-dom and Testing Library's `cleanup()`.
     *   - A test that **does not render** is a `.test.ts` file and runs in
     *     Node. If it still needs a DOM (localStorage, DOMPurify, a `Blob`),
     *     it says so in its own header with `// @vitest-environment jsdom` —
     *     which is where the person reading that file will look.
     *
     * `environmentMatchGlobs` no longer exists in Vitest 4; `projects` is its
     * successor, and it is also the only mechanism that can separate the
     * `setupFiles` — which is half the saving, because the old global setup
     * imported React and Testing Library into every one of the 371 files.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.dom.ts'],
          include: ['**/*.test.tsx'],
          exclude: SHARED_EXCLUDE,
          testTimeout: 20000,
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./vitest.setup.node.ts'],
          include: ['**/*.test.ts'],
          exclude: SHARED_EXCLUDE,
          testTimeout: 20000,
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      // Measured over the productive tree, explicitly. Without `include` the
      // figure drifts with whatever the suite happened to import, which makes
      // a threshold meaningless: it can pass because coverage fell *and* the
      // denominator fell with it.
      include: [
        'api/**/*.ts',
        'components/**/*.{ts,tsx}',
        'context/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'pages/**/*.{ts,tsx}',
        'services/**/*.{ts,tsx}',
        'utils/**/*.{ts,tsx}',
        'types.ts',
        'constants.ts',
        'utils.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        // Type-only modules have no statements to cover; counting them as
        // uncovered would depress the figure without telling anyone anything.
        '**/*.d.ts',
      ],
      // The thresholds measure the whole suite, so they only mean something on
      // the merged report. A shard runs a quarter of the test files and
      // therefore covers a quarter of the lines: enforced there they would
      // fail every time, and a gate that always fails is a gate people learn
      // to ignore. CI disables them per shard and enforces them on the merge.
      thresholds: process.env.VITEST_SKIP_THRESHOLDS === '1' ? undefined : THRESHOLDS,
    },
  },
  });
});
