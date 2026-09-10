/**
 * `npm run build` with the placeholder `VITE_*` values the build needs, and
 * with them confined to the build.
 *
 * The build is fail-closed on runtime config: without `VITE_FIREBASE_API_KEY`
 * and friends it refuses to compile. So anyone running the local gate has to
 * export those, and `npm run quality` chains the tests and the build in one
 * shell — which means the exports reach the tests too. `VITE_AI_STRICT_PROXY`
 * then switches on proxy enforcement inside the suite and twenty specs about
 * the direct-provider fallback fail, on a tree where nothing is wrong.
 *
 * CI never had this problem because it scopes the placeholders to the Build
 * step's own `env:` block. This script is that scoping, for the one command
 * that runs both. CLAUDE.md says green locally means green in CI; this is what
 * makes the claim true for the environment as well as for the steps.
 *
 * A value already present in the environment always wins: a developer building
 * against a real project must not silently get `ci-project`.
 */

import { spawn } from 'node:child_process';

const PLACEHOLDERS = {
    VITE_AI_PROXY_URL: '/api/ai',
    VITE_AI_STRICT_PROXY: 'true',
    VITE_FIREBASE_API_KEY: 'ci-placeholder',
    VITE_FIREBASE_AUTH_DOMAIN: 'ci.example.com',
    VITE_FIREBASE_PROJECT_ID: 'ci-project',
    VITE_FIREBASE_STORAGE_BUCKET: 'ci.example.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
    VITE_FIREBASE_APP_ID: '1:0:web:ci',
    VITE_FIREBASE_MEASUREMENT_ID: 'G-CI',
};

const env = { ...process.env };
for (const [key, value] of Object.entries(PLACEHOLDERS)) {
    if (env[key] === undefined || env[key] === '') env[key] = value;
}

const child = spawn('npx', ['vite', 'build'], { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
    console.error('[build] no se pudo lanzar vite:', error.message);
    process.exit(1);
});
