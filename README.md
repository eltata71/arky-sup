<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ab76e713-22ac-4d60-a0af-20a6e2a711d1

## Run Locally

**Prerequisites:**  Node.js 18+

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `VITE_GEMINI_API_KEY` (required for AI)
   - `VITE_FIREBASE_*` (required for auth + persistence)
   - `VITE_LUCID_API_KEY` (optional, enables real Lucidchart embed/share/export)
   - `VITE_DIAGRAM_PIPELINE` (optional, `canonical` or `ai`; defaults to `canonical`)
   - `VITE_ENABLE_DEV_LOGIN` (optional, **dev only** — enables the developer bypass button)
   - `VITE_ALLOW_FIRST_USER_SUPERADMIN` (optional, prod only — opt-in to "first-user becomes superadmin" bootstrap)
3. Run the app: `npm run dev`
4. Run tests: `npm test` (watch) or `npm run test:ci`

## Quality scripts

| Script              | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `npm run typecheck` | `tsc --noEmit` — strict-ish TypeScript validation       |
| `npm run lint`      | ESLint 9 (flat config) — security/correctness errors    |
| `npm run lint:fix`  | Auto-fix what ESLint can                                |
| `npm run test:ci`   | Run the Vitest suite once                               |
| `npm run quality`   | typecheck + lint + tests in one go (CI gate)            |
| `npm run build`     | Production build via Vite                               |

## Hardening notes

This repo ships dedicated documentation for the recent hardening work:

- `docs/technical-debt-audit.md` — prioritized audit + remaining debt.
- `docs/security-hardening.md` — auth bypass changes + REQUIRED Firebase
  Security Rules / Custom Claims server-side configuration.
- `docs/artifact-generation-hardening.md` — optimistic-update rollback,
  concurrency control, runtime validation and "no blank screen" strategy.

Read these before exposing the app to production users.

## Diagram pipeline

As of April 2026 Arky 10 ships a deterministic diagram pipeline:
Mermaid → DiagramIR → ReactFlow / Excalidraw / Lucid. The LLM is only used
to generate the *content* (IR or Mermaid) — layout and rendering no longer
require a network round-trip. Set `VITE_DIAGRAM_PIPELINE=ai` if you need to
fall back to the legacy AI-assisted renderer for debugging.

## Lucidchart

Users can paste their own Lucid API token from the key icon in the
Lucidchart viewer. A global token (`VITE_LUCID_API_KEY`) can also be
supplied for all users. Without a token the viewer degrades gracefully to
the "Copy Mermaid" flow.
