# Add Artifact Type

Scaffold a new `ArtifactType` end-to-end across `types.ts`, `constants.ts`, `services/geminiService.ts`, `components/ArtifactCanvas.tsx`, and `components/ProjectHub.tsx`. Use when the user asks to "add a new artifact type", "support a new diagram/document type", or similar.

## Usage

Describe the new artifact type (e.g. "add a Threat Model artifact type", "support a Risk Register"). If details are unclear, ask: name, content shape (Markdown / Mermaid / ReactFlow JSON / Kanban board), which category it belongs to, and whether it needs AI generation.

## Process

1. **Read the current artifact pipeline** before editing:
   - `types.ts` (root) — find the existing `ArtifactType` union and the `Artifact` interface.
   - `constants.ts` — find `ARTIFACT_TEMPLATES` and note the shape of an entry.
   - `services/geminiService.ts` — read two existing generation functions to match style, return type and streaming pattern.
   - `components/ArtifactCanvas.tsx` — locate the rendering `switch` on `ArtifactType`.
   - `components/ProjectHub.tsx` — locate the icon / label `switch`.

2. **Extend the type union**
   - Append the new literal to the `ArtifactType` union in `types.ts`.
   - If the artifact carries non-standard payload, extend the `Artifact` interface or introduce a discriminated variant — never inline a new shape in a component.

3. **Register the template**
   - Add a new key under `ARTIFACT_TEMPLATES` in `constants.ts` with: default title, empty-state content, category/tag, and icon key. Match the field order used by sibling entries.

4. **Add the Gemini generator** (only if AI-backed)
   - Export a new async function named `generate<ArtifactType>` in `services/geminiService.ts`.
   - Reuse the shared streaming helper, retry/backoff, and 180 s timeout — do not re-implement them.
   - Read `settings.aiConfig.model` rather than hardcoding a model name.
   - Output contract must match what `ArtifactCanvas.tsx` expects for that variant (Markdown / Mermaid / ReactFlow JSON).

5. **Wire the UI**
   - Handle the new case in the rendering `switch` inside `ArtifactCanvas.tsx` (Board / Canvas / Split).
   - Add the icon + label branch in `ProjectHub.tsx`.
   - If an icon is missing, append it to `components/Icons.tsx` (do not rewrite existing icons).

6. **Verify**
   - `npm run lint` — must be clean.
   - Manually open the app, create an artifact of the new type, and confirm it renders + (if AI) generates.
   - If tests exist for artifact creation, add a case for the new type — delegate the test authoring to the `test-author` agent.

## Checklist (paste into the PR description)

- [ ] `types.ts` — `ArtifactType` union updated.
- [ ] `constants.ts` — `ARTIFACT_TEMPLATES` entry added.
- [ ] `services/geminiService.ts` — generator function added (if AI).
- [ ] `components/ArtifactCanvas.tsx` — render switch handles new type.
- [ ] `components/ProjectHub.tsx` — icon/label switch handles new type.
- [ ] `components/Icons.tsx` — icon appended (if needed).
- [ ] `npm run lint` passes.
- [ ] Smoke-tested in the dev server.

## Rules

- Never bypass the service layer — AI calls stay in `services/geminiService.ts`.
- Never introduce a new state-management library.
- Do not duplicate template strings between `constants.ts` and components — single source of truth is `constants.ts`.
