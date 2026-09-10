# Diagram Module Audit (World-Class Target)

Date: 2026-04-17
Scope reviewed:

- `services/geminiService.ts`
- `components/ArtifactCanvas.tsx`
- `components/ReactFlowCanvas.tsx`
- `components/CustomNode.tsx`
- `components/CustomEdge.tsx`
- `components/ExcalidrawViewer.tsx`
- `components/LucidchartViewer.tsx`
- `pages/Workspace.tsx`
- `constants.ts`
- `index.html`

## Executive snapshot

The current module already has meaningful strengths (multi-view UX, rich React Flow editing, export utilities, Mermaid prompt guidance). However, the architecture still depends heavily on probabilistic AI transformations in the critical rendering chain (Mermaid → ReactFlow and Mermaid → Excalidraw), which introduces semantic drift, instability, and output variability.

To reach a world-class enterprise level, the module needs:

1. A canonical intermediate diagram model (deterministic source-of-truth).
2. Deterministic renderers/exporters per target format.
3. Semantic linting and scoring before presentation/export.
4. Narrative-aware variants (executive/technical/operational) generated from one model.
5. Premium output modes separated from technical diagram purity.

## Key findings by area

### Pipeline and AI dependence

- Artifact generation and format instruction quality are strong but broad and model-dependent.
- Critical parse/conversion steps still rely on LLM output (Mermaid parsing and Excalidraw conversion), increasing compounding uncertainty.
- Caching in `ArtifactCanvas` improves UX speed but can cache semantically wrong intermediate states.

### Visual quality

- React Flow visual system is robust: shape semantics, edge typing, grouping zones, layout presets, legend, and direct editing.
- Palette/icon decisions are keyword-driven heuristics and can become inconsistent across artifacts/domains.
- Layout quality is adequate but not narrative-directed (no explicit focal path, scenes, or sequence emphasis).

### UX and presentation

- Multi-mode canvas (document/diagram/split/markdown/excalidraw/lucidchart) is a major strength.
- Fallbacks and retries exist, including AI auto-fix.
- “Diagram generated” → “boardroom-ready narrative slide” remains mostly manual.

### Export quality

- PNG/SVG export exists for React Flow; Mermaid and Markdown export are available.
- No print theme presets per audience, no brand-safe templates, no pre-export quality gate.

## Recommended target architecture

1. **Canonical model (`DiagramIR`)**: typed nodes, edges, groups, semantics, narrative metadata.
2. **Deterministic parsers/renderers**:
   - Mermaid parser → `DiagramIR` (AST-based).
   - ReactFlow renderer from `DiagramIR`.
   - Excalidraw renderer from `DiagramIR`.
   - SVG/PNG/PDF exporter from `DiagramIR`.
3. **Quality gates**:
   - Semantic lint (IDs, orphan nodes, unlabeled edges, ambiguous types).
   - Visual lint (contrast, overlap risk, label truncation).
   - Narrative lint (focal path, message hierarchy, audience intent).
4. **Audience variants**:
   - Technical (full topology).
   - Executive (condensed capability/value flow).
   - Operations (runtime/deployment emphasis).
5. **Premium storytelling layer (optional)**:
   - Cover pages, contextual imagery, and editorial callouts outside the technical core diagram.

## Priority roadmap

### Critical

- Introduce `DiagramIR` as canonical persistence contract.
- Replace AI-based Mermaid parsing with deterministic parser.
- Add semantic lint + quality score required before export.

### High

- Deterministic Excalidraw and Lucid export from canonical model.
- Design tokens for diagram semantics and accessibility.
- Audience-driven view variants from one source model.

### Medium

- Narrative assistant (auto callouts, sequence numbering, key insights).
- Template-driven “executive one-pager” output.

### Low

- Optional premium visual assets library for covers and committee packs.

## Implementation notes

- Keep AI for ideation/generation, not for deterministic transforms.
- Maintain current React Flow UX strengths as the primary authoring experience.
- Introduce migration path: legacy artifacts → one-time conversion to `DiagramIR`.
