# Refresh CLAUDE.md

Audit `CLAUDE.md` against the real state of the repository and propose a diff. Use periodically or when the codebase has drifted from the documentation. Idempotent: after a successful refresh, re-running should produce no changes.

## Usage

Run the skill with no arguments. Optionally scope to a section name (e.g. "refresh the Repository Layout section only").

## Process

1. **Snapshot the real repo:**
   ```
   !ls -1 /home/user/arkypro-1.0/*.ts /home/user/arkypro-1.0/*.tsx 2>/dev/null
   !ls -1 /home/user/arkypro-1.0/pages/ /home/user/arkypro-1.0/pages/LMS/ /home/user/arkypro-1.0/components/ /home/user/arkypro-1.0/context/ /home/user/arkypro-1.0/services/ /home/user/arkypro-1.0/hooks/ /home/user/arkypro-1.0/types/ 2>/dev/null
   !wc -l /home/user/arkypro-1.0/context/AppContext.tsx /home/user/arkypro-1.0/components/Icons.tsx /home/user/arkypro-1.0/constants.ts
   !cat /home/user/arkypro-1.0/package.json
   !cat /home/user/arkypro-1.0/vite.config.ts
   ```

2. **Diff against CLAUDE.md — specifically check:**
   - **Repository Layout tree** — every file listed exists; every real file is listed (walk `pages/`, `components/`, `context/`, `services/`, `hooks/`, `types/`, and the root `.ts`/`.tsx`).
   - **State Management table** — every `*Context.tsx` present has a row.
   - **Development Commands block** — every script in `package.json` that a contributor would run is listed (exclude one-off `.cjs` helpers).
   - **Environment Variables** — the described vite/env behaviour matches the real `vite.config.ts` (no phantom `define` blocks).
   - **Known Issues** — any claim like "no tests", "no Vitest", "no CI" should be checked against `package.json` devDeps and `.github/workflows/`.
   - **Line-count claims** — if any file is described as "~N k lines", confirm the order of magnitude with `wc -l`.
   - **AI Assistant Resources** — every skill file in `.claude/skills/` and every agent in `.claude/settings.json` appears in the table; nothing stale.

3. **Propose edits** as a list:
   ```
   Section: <name>
   Change: <concise description>
   Old: <snippet>
   New: <snippet>
   ```
   Group edits by section so the user can approve per-section.

4. **Apply with `Edit`** once the user approves. Use surgical replacements — never rewrite the whole file.

5. **Verify idempotency** — re-run step 1 and confirm no further diff.

## Rules

- Never invent a file, script, or behaviour. Every statement in CLAUDE.md must be traceable to a real file or command.
- Do not remove warnings that still apply (e.g. `ReviewArchitectureModal.tsx` is empty) — confirm by `wc -l` before trimming.
- Keep the existing section order and heading levels; only edit content.
- Do not remove the "AI Assistant Resources" section; keep it in sync with `.claude/settings.json` and `.claude/skills/`.
