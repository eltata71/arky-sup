import { sanitizeRichTextHtml } from './richText/sanitizeHtml';

/**
 * Security primitives that are not authorization.
 *
 * This module used to carry a *second* role model — its own `AuthRole` union,
 * its own privileged set, its own `parseAuthRole` — alongside the one in
 * `lib/authz`. Two definitions of who may do what is the same defect as the UI
 * and the rules disagreeing, only closer together and therefore harder to see.
 * The role model now lives in `lib/authz` alone; what remains here is the
 * environment-gated dev bypass and HTML sanitisation, neither of which is a
 * question about roles.
 *
 * **These checks are defence-in-depth.** They MUST be re-validated by Firestore
 * Security Rules. See `docs/security-hardening.md`.
 */

/**
 * Returns whether the developer bypass login is allowed in the current
 * runtime. The bypass exists ONLY for local development against a Firebase
 * project that does not yet have Auth wired up.
 *
 * The bypass requires BOTH conditions:
 *   1. `import.meta.env.DEV === true` (Vite dev build)
 *   2. `VITE_ENABLE_DEV_LOGIN === 'true'` (explicit opt-in)
 *
 * Production builds (`vite build`) ALWAYS return `false` regardless of
 * environment variables, so a stray flag in Vercel cannot enable the bypass.
 */
export function isDeveloperLoginAllowed(): boolean {
  // import.meta.env is replaced at build time by Vite; checking PROD === true
  // gives us the strongest guarantee that production bundles never enable it.
  const env = import.meta.env;
  if (env?.PROD === true) return false;
  if (env?.DEV !== true) return false;
  return env?.VITE_ENABLE_DEV_LOGIN === 'true';
}

/**
 * HTML sanitiser for AI-generated Markdown output.
 *
 * This used to be a hand-rolled regex denylist. It was replaced rather than
 * extended: a denylist has to enumerate every way of writing an attack, and
 * this one missed several that reached the app through ordinary paths —
 * nested tag obfuscation (its single pass turned `<scr<script>ipt>` back into
 * `<script>`), `data:text/html`, `vbscript:`, `srcdoc`, `formaction`, and
 * mXSS through `<noscript>`.
 *
 * The export stays so the artifact document pipeline
 * (`hooks/artifacts/useDocumentRendering`) and its specs keep their call site,
 * but the implementation now delegates to `lib/richText`, which is the one
 * sanitiser in the app. Two sanitisers is the same defect as two role models:
 * the weaker one becomes the real policy.
 */
export function sanitizeGeneratedHtml(html: string): string {
  return sanitizeRichTextHtml(html);
}
