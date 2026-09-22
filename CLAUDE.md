# CLAUDE.md — Arky 10 (arkypro-1.0)

This document is the definitive reference for AI assistants working on this codebase. Read it fully before making any changes.

Last audited against the repository: **2026-09-19**, tras F9: Firebase retirado y toda la aplicación —identidad, datos y archivos— sobre Supabase. Las olas anteriores siguen vigentes en lo estructural y se describen abajo (la de entrega continua y dependencias: el repositorio abierto para desbloquear Actions, un solo camino publicando producción, y la cola de Dependabot resuelta paquete a paquete — ver *Vercel Deployment* y *Dependencias que no pueden subir*). La ola anterior sigue vigente: captura asistida —un agente al lado de cada campo de los seis formularios—, las fichas configurables de los agentes, y los límites declarados de la orquestación con su evaluador-optimizador acotado. Las cuatro olas de monolito modular anteriores siguen siendo la base estructural: módulos declarados con su gate de fronteras, el agregado `architectureProjects` y su invariante, `types.ts` partido por contexto, y `AppContext` reducido a composición sobre `context/app/`.

---

## Project Overview

**Arky 10** is a browser-based SaaS application for software architects. It combines:

- AI-assisted architecture project creation and management
- A deterministic diagram pipeline (Mermaid → DiagramIR → ReactFlow / Excalidraw / Lucidchart)
- An artifact compiler with quality gates, review workflow and a publication pipeline
- An Architecture Knowledge Graph (consistency, traceability, impact analysis)
- An "Oficina de Arquitectura" — 13 specialist AI agent personas that take an engagement from brief to governed delivery: charter, task DAG, cross-review, quality gates and an Architecture Review Board
- A Learning Management System (LMS / Training Center)
- Role-based user management backed by Supabase Auth + PostgreSQL

The app is **frontend-first**: there is no custom domain backend. Persistence goes through Supabase (PostgreSQL with RLS + `SECURITY DEFINER` RPC, Auth, and private Storage), and AI inference goes through the provider layer in `services/ai/`.

The single exception to "frontend-only" is `api/` — two **stateless** Vercel serverless functions that exist purely to keep provider API keys off the client. They hold no domain logic and the app degrades to a direct provider call when they are unset or fail. Do not add domain endpoints there.

### El backend es Supabase, y Firebase ya no existe (F9)

`docs/plan-transformacion-supabase-ddd.md` es el mandato y `docs/fase-1/adrs.md`
(ADR-001…ADR-008) la arquitectura aprobada. **F9 la terminó de ejecutar**:
Supabase Auth para identidad, PostgreSQL con RLS y RPC `SECURITY DEFINER` para
datos y permisos, Storage privado para archivos, y una sola Edge Function
(`provision-user`) para lo único que el navegador no puede hacer. El hosting
sigue siendo Vercel (ADR-006).

Cuatro cosas que esto cambió y cuatro que no:

| Cambió | Sigue igual |
|---|---|
| **No queda ningún SDK de Firebase**: ni dependencia, ni `firestore.rules`, ni emulador, ni variables `VITE_FIREBASE_*` | Ningún componente, página, contexto o hook habla con un SDK: se entra por el repositorio del contexto |
| `services/ports/` declara los contratos (`IdentityPort`, `RepositoryPort`, `FileStoragePort`, `ClockPort`) y el dominio depende solo de ellos — **sobrevivieron al cambio de proveedor sin un solo cambio**, que es la prueba de que valían la pena | El dominio se prueba sin React y sin base de datos |
| `services/adapters/` es donde vive el SDK, en **un fichero y un cliente**, cargado dinámicamente | `api/` sigue siendo apátrida y sin lógica de dominio |
| La autorización sensible se hace cumplir en el servidor —RLS y RPC— además de en `lib/authz` | `lib/authz` sigue decidiendo qué *se muestra*; nunca qué *se permite* |

**El interruptor por contexto sobrevive, la elección no.** `VITE_BACKEND` y
`VITE_BACKEND_<CONTEXTO>` siguen existiendo con `supabase` por defecto y
`memory` sólo para pruebas. Un valor desconocido —incluido `firebase`— cae al
seguro y se marca como *no honrado*, que es lo que el arranque registra en
observabilidad. Se conserva el eje porque borrarlo obligaría a reinventarlo el
día que un contexto tenga una razón real para vivir en otro sitio, y esa razón
llegaría junto con la prisa.

**Lo que no autoriza:** microservicios, un backend de dominio propio, endpoints
de dominio en `api/`, ni exponer `service_role` al cliente. El estado actual del
producto es una **prueba de concepto** (decisión de usuario, 2026-09-12): un
único proyecto Supabase `ArkyDB-US` (`us-east-1`), sin datos productivos y sin
multi-ambiente.

`AGENTS.md` regla 1 dice lo mismo para Codex/Koder; mantenga los dos en el mismo
cambio.

**UI language is Spanish** (`<html lang="es">`). Source code, identifiers and most comments are English; user-facing copy is Spanish. The `en`/`es` dictionary lives in `lib/i18n/`; `AppContext` binds it to `settings.language` and exposes it as `t()`. Both languages carry the same 168 keys, and `__tests__/lib/i18n/translations.test.ts` fails the build if one gains a key the other lacks — a missing key renders as the key itself, in the middle of a toast.

---

## Domain Vocabulary (enterprise architecture)

The product's three levels are named in the language of the discipline, and
**`lib/eaTerminology.ts` is the single source of those names** — no screen may
invent a second one:

```
Iniciativa de Negocio          the business driver: a need, not a project
  └─ Proyecto de Arquitectura  how architecture responds to that need
       └─ Solicitud de Entregable   one governed unit of work (an `OfficeEngagement`)
            └─ Artefacto            the documents and diagrams it produces
```

**Every level carries two registers, and which one a surface uses is a rule.**
`singular`/`plural` is the long name — page titles, headers, empty states, any
first mention. `short`/`shortPlural` is the short name — the navigation rail,
chips, breadcrumbs, dense rows. A screen titled with the short name reads as an
abbreviation; a rail carrying the long one wraps. `AppRail` shows the short
label and keeps the long one as the tooltip and the accessible name.
`PRODUCT_NAME` (`Arky · Oficina de Arquitectura`) lives here too.

Two traps this vocabulary exists to avoid:

- **The level below is created from the level above.** An initiative opens a
  project (`/projects?iniciativa=<id>&crear=guiado`), a project opens a
  deliverable (`EngagementIntakeWizard` with `initialProjectId`), and a
  deliverable opens an artifact (`/workspace/:id?crear=artefacto`). Each link
  carries its parent's context, and `AttentionInitiativeGate` stands down when
  the initiative arrived with the link — asking again would be the system
  forgetting where the user just came from.
- **The assistant is reachable from every room**, through `AssistantLauncher`,
  not only from a header that scrolls away.
- **"Entregable" names the third level only.** Inside a charter the word used to
  mean the artifacts to produce; those are **artefactos** everywhere in the UI.
  Never reintroduce "entregable" for a charter item.
- **An initiative is not a project.** It carries the business rationale across
  the engagements that serve it and stays open while its outcomes are still
  being measured. Modelling it as a project would force an end date onto the
  one thing whose purpose is to outlive them.

### Relations between the levels are keys, never text

All three edges are ids, resolved by `services/portfolioGraph/`:

| Edge | Canonical field |
|---|---|
| Initiative ← Attention | `Project.initiativeIds[]` |
| Attention ← Deliverable | `OfficeEngagement.projectId` (+ `initiativeIds[]` to narrow) |
| Deliverable ← Artifact | `OfficeTask.producedArtifactId` |

`Project.linkedBusinessProjects` and `OfficeEngagement.businessProjectIds` hold
the `NEG-YYYY-NNN` **codes** and are a *derived mirror*, kept because the code
is what people quote in a steering meeting. Rules:

- **Ids win.** The resolver consults codes only when no id resolved — a mirror
  that can add a link the ids do not have is a second source of truth, and then
  a stale code silently attaches work to an initiative nobody linked.
- **Legacy records migrate lazily**, in memory, on every read, so nothing has to
  be rewritten before the app works.
- **Broken references are reported, never dropped** (`LinkIssue`). Filtering
  them out makes a dashboard that always looks healthy while quietly losing
  work.
- **Never capture a relation as free text.** `InitiativePicker` is the only way
  to create one, and it can emit only ids of records that exist.
- **The parent levels are mandatory at creation, and the rule lives in the
  aggregate.** `createArchitectureProject` in `services/architectureProjects` is
  the only way to build a `Project`, and it *refuses* one without an initiative,
  returning a typed rejection the caller has to handle. It used to be a React
  component's job: `addProject` declared `initiativeIds` optional and filled it
  with `[]`, so the rule held only because both callers happened to pass through
  `AttentionInitiativeGate`. Use `useCreateAttention()` from the UI.
- **The parent levels are mandatory at creation, and the link travels with the
  creating write.** `AttentionInitiativeGate` stands in front of *every* way of
  opening an attention (guided creation, document analysis, templates) and
  `EngagementIntakeWizard` demands both an initiative and an attention before it
  will plan a deliverable. Neither offers to invent the missing parent: they send
  the user to the screen that creates it. An attention that exists even
  momentarily with no initiative is the `orphan-attention` the graph reports, and
  a failed follow-up write would make that state permanent — so `addProject`
  accepts `initiativeIds`/`linkedBusinessProjects` and persists them itself.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.8 (incremental strictness — see *TypeScript Conventions*) |
| UI Framework | React 18 |
| Routing | React Router DOM v7 |
| Build Tool | Vite 6 (manual vendor chunking) |
| Styling | Tailwind CSS 3.4 compiled at **build time** via PostCSS |
| Icons | `components/Icons.tsx` (Heroicons set) + Lucide React |
| Diagrams | Mermaid 11, ReactFlow 11, Dagre, ELK.js, Excalidraw |
| Animation | Motion (Framer Motion successor) |
| Database | Supabase PostgreSQL 17 (RLS deny-by-default + RPC `SECURITY DEFINER` en `supabase/migrations/`) |
| Auth | Supabase Auth (correo y contraseña; proveedor único por ADR-004) |
| Storage | Supabase Storage, dos cubos privados, con registro en `api.file_objects` |
| AI | Provider-agnostic layer over Google GenAI (`@google/genai`) and OpenRouter |
| Unit/component tests | Vitest 5 + Testing Library + jsdom |
| E2E tests | Playwright (desktop Chromium + iPad Safari) |
| Lint | ESLint 10 flat config + typescript-eslint |
| Hosting | Vercel (SPA rewrite + `api/` functions) |
| Node | 24 (`.nvmrc`, y `engines` en `package.json`) |

---

## Repository Layout

```
arkypro-1.0/
├── index.html              # HTML shell (fonts, boot guards, no runtime CDNs)
├── index.tsx               # React entry: provider tree + boot recovery fallback
├── App.tsx                 # Router, AppRail/MobileBottomNav shell, global commands
├── constants.ts            # Project/artifact templates, Kanban columns (~800 lines)
├── types.ts                # The shared kernel — Settings, MemoryEntry, templates. Every
│                          # aggregate lives in its context; sólo `Artifact` y `Project` se
│                          # reexportan aquí todavía, y es lo que D-4 decide (F3-07).
├── utils.ts                # Shared utility helpers — JSON extraction, artifact grouping, a
│                          # memory cache. **No prompt composition**: eso es `services/ai/prompts/`
├── env.d.ts                # Ambient declarations for `import.meta.env`
├── vite.config.ts          # Vite + Vitest config (port 3000, `@` alias, manualChunks)
├── vitest.setup.dom.ts     # `dom` project setup: jest-dom matchers + auto `cleanup()`
├── vitest.setup.node.ts    # `node` project setup: jest-dom only if a DOM is present
├── playwright.config.ts    # E2E projects: desktop-chromium + ipad-safari
├── eslint.config.js        # ESLint 10 flat config (tiered error/warn/off)
├── tailwind.config.cjs     # Tailwind theme (primary/gray palettes, fonts, shadows)
├── postcss.config.cjs      # tailwindcss + autoprefixer
├── tsconfig.json           # ES2022, bundler resolution, `@/*` alias, strictness gates
├── vercel.json             # framework=vite, SPA rewrite
├── Makefile / run.sh       # Maintenance targets (run.sh works without `make`)
├── modules.json            # The modular monolith declared: modules, layers, public APIs
├── scripts/                # Build-time gates: bundle secrets, `any` budget, orphan scripts,
│                          # module size, module boundaries
│
├── api/                    # Vercel serverless AI proxies (stateless, no domain logic)
│   ├── ai.ts               # Provider-agnostic proxy (gemini | openrouter), SSE-capable
│   ├── gemini.ts           # Legacy Gemini-only proxy (`VITE_GEMINI_PROXY_URL`)
│   └── _shared/proxyRuntime.ts  # Body read, client id, rate limit, JSON error envelope
│                                # (`_`-prefixed → Vercel never routes it)
│
├── src/
│   └── index.css           # The three `@tailwind` directives (imported by index.tsx)
│
├── types/
│   └── lms.ts              # LMS types (Course, Lesson, UserProgress…)
│
├── context/                # 8 React contexts — no external state library
│   ├── AppContext.tsx          # Composition only (~147 lines) — the surface 40 modules read
│   ├── app/                    # What it composes: usePersistenceReporter, useAppBootstrap,
│   │                           # useSettingsState, useProjectsState, useArtifactsState,
│   │                           # useProjectHistory, useArchitectureGraphSync + appContextTypes
│   ├── AuthContext.tsx         # Auth state + login/logout/register + role
│   ├── InitiativeContext.tsx   # Business initiatives (top of the hierarchy): CRUD + patches
│   ├── OfficeContext.tsx       # Architecture Office engagements: intake, run, gates, ARB
│   ├── LMSContext.tsx          # Courses, progress, notes, catalog
│   ├── ToastContext.tsx        # Transient notifications
│   ├── CommandPaletteContext.tsx # Cmd+K command registry
│   └── ObservabilityContext.tsx  # Runtime error capture + boot session telemetry
│
├── services/                # One loose file left at the root — see `SERVICES_ROOT_BUDGET`
│   ├── ai/                   # ★ Provider-agnostic AI architecture (see "AI Layer")
│   │   ├── core/             # AIProvider/AIRequest/AIResponse/AIStream contracts + executor
│   │   ├── providers/        # GeminiProvider, OpenRouterProvider, AIProviderFactory
│   │   ├── generation/       # Domain façades (artifact/document/diagram/recommendation)
│   │   ├── callControl/      # Global AI call gating/budget + per-call context budget
│   │   ├── guardrails/       # ★ What may not leave and what may not come back, with severities
│   │   ├── capabilities/     # What a request needs vs what the backend offers
│   │   ├── routing/          # Eligibility → ranking → AIRoutePlan + provider health
│   │   ├── modelRouting/     # AIModelRouter (tier → model, within one provider)
│   │   ├── retry/            # AIRetryPolicy + AITimeoutPolicy
│   │   ├── errors/           # AIErrorClassifier
│   │   ├── tracing/          # AITraceBuilder
│   │   ├── pipeline/         # AIGenerationPipeline + trace recorder
│   │   ├── context/          # Context pack building/ranking/dedup/citations
│   │   ├── prompts/          # diagramPrompts.ts, promptComposer.ts
│   │   ├── structuredOutput/ # Schema-checked JSON parsing
│   │   └── aiProxyClient.ts  # Client for `api/ai.ts`; returns null → caller falls back
│   ├── geminiService.ts      # ⚠ Legacy 6.6k-line monolith: most prompts + `geminiService` singleton
│   ├── persistence.ts        # Persistence result envelope + degradation status
│   ├── observabilityService.ts   # Global error handlers, boot session, runtime reports
│   ├── identity/             # ★ Session, user profile + role, admin account provisioning
│   ├── learning/             # ★ LMS CRUD (courses, progress, context, notes)
│   ├── lucid/                # ★ Lucidchart REST integration (token, embed, export)
│   ├── agent/                # "Arquitecto Agente": planner, executor, intent, memory
│   ├── businessInitiatives/  # ★ Business initiatives: types, repository, metrics
│   ├── portfolioGraph/       # ★ The four levels as a keyed graph: resolution, integrity, search
│   ├── architectureProjects/ # ★ The Proyecto de Arquitectura aggregate: type, factory, repository,
│   │                        # and `attentionTracking` — its progress, health and contributions
│   ├── persistence/          # ★ The write gateway: PersistenceResult, local drafts, classification,
│   │                        # collection paths, the cache+local-mirror primitive
│   ├── settings/             # ★ Per-user preferences: theme, language, AI config
│   ├── observability/        # Runtime error capture, boot session, telemetry
│   ├── architectureOffice/   # ★ Engagement engine: personas, agent profiles, router, planner,
│   │                        # runner, ARB, coordination + the consolidation evaluator
│   ├── architectureKnowledgeGraph/  # Entity/relation extraction, consistency, impact, traceability
│   ├── artifactCompiler/     # Contracts, validators, repair, scoring, recompile
│   ├── artifacts/            # View controller, brief, presentation compilers, export facade,
│   │                        # and the deterministic fallbacks (no model call in them)
│   ├── contextGraph/         # Project-wide context graph (builder, ranker, serializer)
│   ├── diagram/              # ★ Canonical diagram pipeline (see "Diagram Pipeline")
│   ├── export/               # Export registry + adapters (md/html/pdf/docx/pptx/xlsx/csv/json/txt)
│   ├── publicationPipeline/  # Preflight, packages, approvals, branding, manifest, audit
│   ├── quality/              # Artifact/document quality models, gates, auto-repair, reports
│   ├── review/               # Artifact review repositories (local / remote / hybrid)
│   ├── chat/                 # Chat history compaction
│   ├── memory/               # Structured agent-memory entries
│   └── presentation/         # Presentation prompt + schema
│
├── lib/                     # Framework-agnostic helpers (no React, no SDK)
│   ├── ai/                  # Model catalogue: ids, cost tiers, fallback chain, resolution
│   ├── secretShapes.ts / untrustedContent.ts  # ★ The published key shapes, and the fence
│   │                        # around content the app did not write — leaves on purpose
│   ├── designTokens.ts      # ★ Motion, elevation, radius, type and surface — the named
│   │                        # steps Tailwind cannot express as a class
│   ├── diagramTokens.ts / diagramThemes.ts / diagramC4Levels.ts / diagramBpmn.ts
│   ├── layoutEngine.ts / elkLayoutEngine.ts / layoutSelector.ts
│   ├── artifacts/           # Artifact contracts, pipeline vocabulary, classification,
│   │                        # template governance, export declarations, document IR
│   ├── security.ts, ids.ts   # ← held to stricter lint rules
│   ├── capture/             # ★ Assisted capture: the field catalogue and its contract
│   ├── platformGuide/       # ★ The platform guide: its contract, its search and its topics
│   ├── lazyWithRetry.ts     # Chunk-load retry for lazy routes (iPad/Safari resilience)
│   └── jsonSafe.ts, colorContrast.ts, textDiff.ts, printDocument.ts, chartSvg.ts…
│
├── utils/
│   ├── diagram/extractMermaid.ts   # Shared Mermaid extraction + kind detection
│   ├── chatHistory.ts, markdownOutline.ts, artifactExploration.ts, datetime.ts
│   └── __tests__/
│
├── hooks/
│   ├── artifacts/           # 12 hooks extracted from ArtifactCanvas (barrel: index.ts)
│   ├── useCaptureAssistant.ts / useLevelCapture.ts  # Assisted capture, per level
│   ├── usePlatformGuide.ts  # The rail's guide: catalogue + composition + model, with its fallback
│   ├── useInitiativeDelivery.ts / useAttentionInitiatives.ts  # The project↔initiative edge, resolved
│   ├── useAgentProfiles.ts  # The agents' cards, resolved for the signed-in user
│   ├── useLMS.ts, useTheme.ts, useAgentActions.ts
│   └── useFocusTrap.ts, useReducedMotion.ts, useAriaAnnouncer.tsx
│
├── pages/                   # 11 top-level pages + pages/LMS/*
│   ├── AuthPage.tsx, DashboardPage.tsx, ProjectsPage.tsx, Workspace.tsx
│   ├── OfficePage.tsx, EngagementRoom.tsx, AgentsPage.tsx
│   ├── SettingsPage.tsx, TrainingCenterPage.tsx, UserManagementPage.tsx
│   ├── SDDProcessView.tsx
│   └── LMS/                 # Dashboard, Catalog, CourseView, LessonModal, AILab,
│                            # Consulting, SmartNotes, Analytics, Diagnostic, LessonLab,
│                            # CertificateView, StudentContextModal, EditCourseModal…
│
├── components/              # ~118 components
│   ├── ArtifactCanvas.tsx   # Central editing canvas (delegates to hooks/artifacts + subviews)
│   ├── ProjectHub.tsx, Workspace shell pieces, CommandPalette, AppRail, MobileBottomNav
│   ├── reactFlowCanvas/    # Layout, narrative scenes, group zones, legend, image export
│   │                       # — everything ReactFlowCanvas.tsx used to hold inline
│   ├── artifacts/           # diagram/ document/ markdown/ presentation/ excalidraw/
│   │                        # lucidchart/ fable/ export/ quality/ suggestions/ toolbar/
│   │                        # trace/ diagnostic/ wizard/ + ReviewPanel, CommentThread
│   ├── capture/             # ★ The assisted-capture controls used by all six forms
│   ├── platformGuide/       # ★ PlatformGuideDock — the rail's help, one agent, one panel
│   ├── architectureOffice/  # EngagementIntakeWizard, EngagementCharterReview, ArbDecisionPanel,
│   │                        # OfficeTimeline, OfficeAgentPicker, OfficeCapabilitiesPanel,
│   │                        # agentProfile/ (the agent's card, its file and its editor)
│   ├── publication/         # PublicationCenter + preflight/approval/package/export panels
│   ├── copilot/, assistant/, memory/, diagram/
│   ├── ui/                  # Design-system primitives (Button, Card, Tabs, Drawer, cn…)
│   │                        # + SectionHeader, StatusDot, ResizeHandle, PageSkeleton
│   │                        # + charts/ (Donut, TrendArea, FlowBars, RadialGauge,
│   │                        #   Sparkline, StatusBars, StatTile)
│   ├── dashboard/           # ★ El centro de mando: PortfolioHealthHero, AttentionCenter
│   └── Icons.tsx            # Curated Heroicons set — append only
│
├── __tests__/               # Mirror-structure Vitest suites (diagram, services, components…)
├── tests/fixtures/          # `.mmd` fixtures for the diagram parser
├── e2e/                     # Playwright specs (smoke, diagram focus, office personas auth)
├── docs/                    # 20 design/hardening docs — read before touching those subsystems
├── specs/                   # SDD artifacts (BRD, ADRs, NFR, BDD, traceability matrix)
├── .github/workflows/       # ci.yml (quality gate) + e2e.yml (Playwright)
├── .claude/                 # settings.json (sub-agents) + skills/ (slash commands)
├── .hermes/                 # Workspace maintenance scripts (health.sh) + local reports
└── AGENTS.md                # Codex/Koder mirror of the AI capability contract
```

### Utility scripts (`.cjs`)

Only two `.cjs` files remain and both are build configuration: `tailwind.config.cjs` and `postcss.config.cjs`.

The eleven one-off codegen/codemod scripts that used to sit in the root, and the `app/**/*.js` tree beside them, were deleted in the Ola 2 supply-chain pass. They were historical scaffolding: unreferenced by any code or config, ESLint-ignored, never typechecked, and stale enough that reading them was actively misleading about how the app works. A `check:no-orphan-scripts` gate keeps the root from re-accumulating them.

---

### The barrel against the bundle

A module's `index.ts` is the right door — and from code the **entry chunk**
reaches, entering through it is what puts a whole module in the eager payload.
This has now cost a build five times, each measured by `check:bundle-budget`:

| Entering | Eager payload |
|---|---|
| `runtimeValidation` through the `publicationPipeline` / `architectureOffice` barrels | 658 → 1 126 KB gz |
| `AppContext` through four repository barrels | 659 → 1 125 KB gz |
| `geminiService` through the `services/artifacts` barrel | 660 → 1 126 KB gz |
| `deterministicArtifactFallbacks` through the `services/diagram` barrel | 660 → 1 098 KB gz |
| `platformGuideService` through the `lib/platformGuide` barrel | entry 346,7 → 350,9 KB gz |
| `chatHistoryRepository` through the `services/chat` barrel, **from boot code** | eager 430,4 → 586,9 KB gz (medido al revés: así es como se recuperaron 156) |

**The rule: a barrel from lazy code, a file path from boot-path code**, with a
comment saying which case it is. `check:bundle-budget` is what tells the two
apart — not judgement — and `check:module-boundaries` records the resulting deep
import as what it is.

**The sixth case is the largest and it is the rule read backwards.** The five
above are budgets a barrel *cost*; this one is 156 KB gz the eager payload got
*back* when one import stopped using one. `AppContext` → `useProjectsState` →
`ArchitectureProjectRepository` → `projectWrites` imported `chatHistoryRepository`
through the `services/chat` barrel. That barrel exports `chatCompactor`, which
value-imports `aiGateway` from the `services/ai` barrel, which re-exports
`generation`, which reaches `services/geminiService` — so **the entire AI layer
and the 5 400-line engine were downloaded before the login screen rendered**, to
obtain one object that talks to the database.

Two changes, and the second is the more interesting one. `projectWrites` now
enters by file path. And `deterministicCompactionDigest` — a pure, AI-less
function that `chatHistoryCap` needs on the *persistence* path — moved out of
the file that calls a model into `services/chat/compactionDigest.ts`. It is the
same rule that already put the deterministic artifact fallbacks in
`services/artifacts` rather than behind `services/ai`: **a pure function that
never calls a model does not live behind a door that does.** Sharing a file is
enough to make it one.

**And there is a second shape, which the fifth case is.** Neither side was boot
code: the guide's model call and the guide's dock are both lazy, and each
entered `lib/platformGuide` through its barrel. That made the topic catalogue —
which only the dock reads — reachable from *two* lazy chunks, so Rollup hoisted
it to their common ancestor, the entry, where nobody ever opens it. **A module
shared by two lazy chunks lands in the eager one.** The fix was the same file
path, and the rule generalises: enter through the barrel unless the barrel
carries something you do not use and someone else does.

### Module boundaries — `modules.json` and the gate

The folders under `services/` were not modules. Measured on 2026-09-01: **24
cycles between pairs of modules**, 65 pairs of imports reaching past a module's
`index.ts`, and `lib/` — documented here as the layer with no dependencies —
importing from `services/` in seven files. None of it broke a rule, because
there was no rule; folders enforce nothing.

`modules.json` now declares the modules, their layer and their public API, and
`npm run check:module-boundaries` enforces six things on every push:

| Rule | What it refuses |
|---|---|
| **Layers** | `foundation` (`lib`, `utils`) must not import `domain`; `domain` (`services/*`) must not import `ui` |
| **Cycles** | two modules that import each other — one module with twice the surface, and neither readable alone |
| **Alcanzabilidad** | un grupo de módulos que puede volver a sí mismo siguiendo imports, aunque ningún par se importe mutuamente. `ALLOWED_SCCS` registra los dos de hoy y **sólo puede encoger** — ADR-104 |
| **Public API** | an import that reaches past a module's `index.ts` into an internal file |
| **UI fan-out** | a screen under `components/`/`pages/` importing more than **two** service modules |
| **Loose root files** | a new file dropped at the root of `services/`, which belongs to no module |

**Las seis se aplican sobre un grafo, y de qué está hecho ese grafo es la mitad
de la garantía** (F3-02, ADR-105). Se construye leyendo `import`,
`export … from`, `import type` **e `import('…')`** —en sus dos formas, la
diferida y la de posición de tipo—, sobre todo `.ts`/`.tsx` de las carpetas
declaradas **y** sobre los ficheros de la raíz que `modules.json` nombra uno a
uno: `types.ts`, `constants.ts`, `utils.ts`, `App.tsx`, `index.tsx`. Faltaban
las dos cosas, y las dos daban el mismo resultado —un gate en verde sobre 27
módulos mutuamente alcanzables—, que es el modo de fallo de ADR-104 un nivel más
abajo: allí el gate medía una propiedad más débil que la que decía medir; aquí,
un árbol más pequeño. La cabecera del script declara qué deja fuera, para que la
próxima ampliación empiece por leerlo.

**UI fan-out** is Wave 4's. A component that imports one service is using a
capability; one that imports eight *is* the application layer for that screen,
written in a file whose job is rendering — which is how `ArtifactCanvas` came to
decide compilation, validation, quality, review and export policy between two
JSX branches. Each screen over the default carries its own recorded number; the
fix for one is to move its orchestration into an application service the screen
calls once, not to raise the entry.

**Ola 4 built the first application services, and they are the pattern to
follow.** `services/<contexto>/application/` holds what a screen *decides*, as
pure functions; a hook under `hooks/` holds only what React needs, which is
when to recompute:

| Service | What it took out of a screen |
|---|---|
| `services/artifacts/application/artifactAssessment` | the canvas's whole derivation chain — quality with real positions, preflight, presentation, export formats, exportability, the visual gate — plus `hooks/artifacts/useArtifactAssessment` for the memo boundaries |
| `services/architectureOffice/application/assistantConsultation` | what the Office knows about a project when it answers, and who signs the reply |
| `hooks/useAgentMemoryStore` | 30 lines of memory-store adapter that were **written twice, line for line**, in `AssistantPanel` and `ProjectCopilotChatModal` |

The split between the service and the hook is not decoration. Collapsing the
canvas's six `useMemo`s into one call would have been shorter and worse:
`analyzeDiagramQuality` is the most expensive thing that screen does, and it
cannot recompute every time someone switches tab. So the composition is declared
without React, stage by stage, and the hook keeps the exact dependency arrays
the component had.

**A deep-import count that rises while a fan-out falls is the trade working.**
Moving orchestration out of a screen moves its imports into the domain layer:
`components -> services/diagram` fell 24 → 20 while
`services/artifacts -> services/diagram` rose 10 → 14. What matters is where
the decisions live, and the UI's own total fell from 168 to 157.

**Loose root files** is Ola 1's, and `SERVICES_ROOT_BUDGET` is its number. The root of
`services/` is where a file lands when nobody decides which context it belongs
to: it held **20 files and 9 923 lines**, and was the single largest cause of
the census — nine of the fourteen cycles, all three upward pairs and sixty deep
imports. Seventeen of them have moved to the module whose language they already
spoke. **One remains**: `geminiService.ts`. Moving it into `services/ai` was
tried in Ola 5 and reverted — see *Known Issues* for why the relocation makes
the cycle census worse rather than better.

`runtimeValidation.ts` was the other holdout and it is gone: once
the persistence monolith was split, its only two callers turned out to be
`projectReads` and `projectDocumentMapper`, so it was never shared code — it was
the Project aggregate's own read-validation, kept outside because the
persistence monolith called it. It is `services/architectureProjects/projectRuntimeValidation.ts`.

Each rule carries a **monotonic budget**, like `check:module-size` and
`check:any-budget`: today's count may fall and must never rise. A cycle or a
pair not in the recorded list fails outright. `--report` prints the census in
the shape the script records it, which is how you update a budget after
removing something.

**The four cycles between domain contexts are broken and must stay broken** —
`export ↔ quality`, `artifacts ↔ export`, `agent ↔ architectureOffice`,
`ai ↔ diagram`. `__tests__/scripts/moduleBoundaries.test.ts` asserts each by
name, including that it is not quietly re-added to `ALLOWED_CYCLES`.

**And `lib/` and `utils/` no longer import the domain at all — zero, not a
recorded few.** The same test asserts that too. It was three pairs and five
imports, and two of them came out of `lib/validation/`, a re-export shim that
reached up into `services/` to republish domain types under `lib/` names and
that **no file in the repository imported, not even a test**. Deleting it, and
bringing the pipeline vocabulary, the artifact classification, the template
governance and five export declarations down into `lib/artifacts/`, took the
number to zero. The rule that did it every time is the one already written
above: a contract with no behaviour moves down to a leaf.

**Pero la capa de fundación son dos carpetas y dos ficheros de la raíz, y ésos
subían — 7 pares, 9 imports** (F3-02, ADR-105). La frase de arriba decía «la
capa de fundación» y era cierta sólo de las carpetas, porque el gate no abría
`types.ts` ni `utils.ts`. `types.ts` era exactamente el mismo defecto que
`lib/validation/` a mayor escala: un reexportador que subía a cinco contextos de
dominio, sólo que a éste sí lo importa medio repositorio.

**Quedan dos, y la misma regla retiró los otros cinco.** F3-07 midió los
consumidores antes de mover nada, y el andamio no sostenía casi nada: las 19
declaraciones de diagrama reexportadas no tenían **un solo consumidor**, y las
de presentación, revisión y chat sólo las importaban los propios módulos dueños
—por la raíz del repositorio en vez de por el fichero de al lado—. F3-08 sacó de
`utils.ts` las 290 líneas que componen prompts de proyecto, que son capa de IA
escrita bajo un nombre que promete utilidades; están en
`services/ai/prompts/projectPrompts.ts`, y de paso **dos ficheros de IA salieron
del arranque**, porque lo que la fundación importa el arranque lo descarga
(`bootPathStaysLight.test.ts` lo mide). Los dos pares que siguen, `Artifact` y
`Project`, no son andamio: son la frontera del agregado Proyecto–Artefacto y
esperan a D-4.

Two patterns did the breaking, and they are the ones to reach for next time:

- **A contract with no behaviour moves down to a leaf.** `ExportFormat`,
  `ArtifactView`, `ArtifactPresentationModel`, `ArtifactKind` and the suggestion
  vocabulary were pure declarations sitting inside one context while three
  others needed them. They now live in `lib/artifacts/` — a shared kernel in the
  strict sense: small, inert, and not the place for the next domain type only
  one context needs.
- **A dependency that must point one way becomes a port.** `services/agent` no
  longer knows the Architecture Office exists: it declares
  `AgentPersonaBriefing` — what it needs from a specialist persona — and
  `buildOfficePersonaBriefing` in `services/architectureOffice` supplies one.
  The office drives the agent; the agent does not look the office up.

What is left in the budget is honest: the **loose files still at the root of
`services/`**, which belong to no module and form cycles with eleven of them.
Each one that moves into a module lowers the number.

---

## Development Commands

```bash
npm install            # Install dependencies (resolutor estricto de peers; `.npmrc` ya no lo desactiva — D-18)

npm run dev            # Vite dev server → http://localhost:3000 (host 0.0.0.0)
npm run build          # Production build → dist/
npm run preview        # Serve the production build

npm run typecheck      # tsc --noEmit
npm run lint           # ESLint 10 flat config
npm run lint:fix       # ESLint --fix
npm test               # Vitest watch mode
npm run test:ci        # Vitest single run
npm run test:coverage  # Vitest + v8 coverage (applies the thresholds)
npm run test:shard -- --shard=1/4   # One CI shard: coverage into a blob report
npm run test:merge-reports          # Merge the shards' blobs and enforce the thresholds
npm run quality        # everything the CI `quality` job runs — static gates + coverage + build + bundle checks
npm run quality:fast   # the same static gates + `test:ci`, for the inner loop
npm run quality:static # typecheck, strict, lint and the four budgets only
npm run check:module-boundaries  # ni ciclo, ni componente conexo mayor, ni import ascendente, profundo o fan-out nuevo

npm run e2e            # Playwright (starts the dev server itself)
npm run e2e:install    # Download chromium + webkit browsers
bash scripts/supabase/local.sh verify   # esquema, contratos pgTAP, lint, advisors y tipos (necesita Docker)
```

`Makefile` and `run.sh` wrap the same targets (`./run.sh quality`, `./run.sh ci-check`, `./run.sh health`, `./run.sh status`). `run.sh` exists because `make` is usually absent on Windows/git-bash. `make health` runs `.hermes/bin/health.sh`.

### Quality gate — current state (medido 2026-09-19 sobre `a44bab9`, tras la ola de entrega continua y dependencias)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run check:module-boundaries` | **6 ciclos directos registrados y 2 componentes fuertemente conexos (3 + 27 módulos)**. El alcance completo (F3-02, ADR-105) hizo visibles 11 ciclos y 7 pares ascendentes el 2026-09-21; F3-07 y F3-08 retiraron cinco ciclos y cinco pares al día siguiente, y casi todo era andamio: `types.ts` reexportaba 19 declaraciones de diagrama **sin un solo consumidor**, y las de presentación, revisión y chat sólo las usaban los módulos dueños. La frase anterior —«0 ciclos entre contextos de dominio»— era cierta sólo para ciclos de longitud 2: el gate no medía alcanzabilidad. Desde ADR-104 sí, y lo que ve es un componente de **nueve** contextos de dominio unidos por 22 aristas, con `services/ai -> services (raíz)` cerrándolo. `ALLOWED_SCCS` lo registra y sólo puede bajar. **Ese componente es hoy de 27** porque `types.ts` entró en el grafo: lo importan 25 de los 34 módulos y le quedan **dos** aristas de salida, `Artifact` y `Project`, con las que cierra el grafo entero y arrastra dentro a `lib`. No se repuntan con un codemod: `services/artifacts` necesita el proyecto y `services/architectureProjects` necesita el artefacto, así que cambiar el ciclo contra `types.ts` por uno entre dos contextos de dominio sería peor — debajo está la frontera del agregado Proyecto–Artefacto (D-4, la decide F4-02 con los datos de F4-01). **2 upward pairs**, las dos de `types.ts`; `lib/` y `utils/` siguen en cero y la prueba lo afirma por separado; **1 loose file** at the root of `services/`. `services (raíz) -> services/ai` bajó y se fijó: 18 → 16, al mudar la traducción legacy→canónica a `services/ai/generation/legacyGeminiBridge.ts`. Hay **una entrada nueva y deliberada**, `services/architectureProjects -> services/chat`: es la regla del barril contra el bundle, y su comentario en `scripts/checkModuleBoundaries.mjs` dice cuánto costaba la puerta principal |
| `npm run check:module-size` | clean. Tres techos bajaron el 2026-09-22 al fijar lo que ya se había ganado y nadie había registrado: `services/geminiService.ts` a 5 405 líneas / 271 653 bytes y `services/agent/agentExecutor.ts` a 988 / 41 175 — este último figuraba como deuda abierta («1007 vs 1001») mientras el gate estaba en verde. Un presupuesto que no se baja cuando se gana permite volver a subir sin que se note. Sube uno, con su razón al lado: `pages/EngagementRoom.tsx`, nueve bytes, por preguntar si *este* actor puede firmar *este* encargo en vez de leer un booleano de permiso |
| `npm run typecheck:strict` | clean over 31 entries — `lib/capture`, `lib/platformGuide`, `attentionTracking` and `initiativeDelivery` join the day they are written — plus `lib/authz`, `lib/diagram`, `services/observability`, `services/memory`, the review rules, the initiative model, the `architectureProjects` factory and its document mappers, and all of `services/persistence` and `services/settings` |
| `npm run check:any-budget` | 23 `any` types, budget 23 (eran 38) |
| `npm run lint` | **clean — 0 errors, 0 warnings**, y volvió a serlo el 2026-09-22: `OfficeEngagementRunner.ts` importaba dos tipos que sólo reexportaba, así que arrastraba dos avisos que `eslint .` no hace fallar. Keep it that way: a warning is a finding nobody will read once there are ten of them |
| `npm run test:ci` | **456 ficheros y 4 419 pruebas, todas pasando**, medido el 2026-09-22 sobre Node 24. Sube desde 4 359 con las de F3-02 (alcance del verificador), la elegibilidad del comité y el fixture E2E de dos identidades. **El entorno local también se arregló**: con Node 20 el SDK de Supabase no encuentra `WebSocket` nativo y `supabaseIdentityAdapter` fallaba una prueba que en CI pasaba — `.nvmrc` pide 24 y ahora eso es lo que hay instalado |
| `npm run test:coverage` | 65,20 % statements / 56,53 branches / 57,64 functions / 67,03 lines — por encima de todos los suelos de `vite.config.ts`, y de los cuatro valores anteriores |
| `npm run check:bundle-budget` | **eager 439,1 KB gz de 450; entrada 200,3** — sube 7,5 desde los 431,6 de la ola anterior, repartidos entre las subidas de dependencia y las hojas del guardrail. El margen es de **10,9 KB gz**, y conviene leerlo como lo que es: dos de las subidas que Dependabot propone como «minor» se lo comen entero (ver *Dependencias que no pueden subir*) |
| `npm run check:bundle-secrets` | clean — y ahora conoce `sk-ant-`, que faltaba mientras Anthropic ya era un proveedor embarcado: una clave suya en el bundle se reportaba como «OpenAI-style» o, con sufijo corto, no se reportaba |

### CI

Cuatro workflows de GitHub Actions, todos con `permissions: contents: read` y
concurrencia con `cancel-in-progress`:

- **`.github/workflows/ci.yml`** — push y PR contra `main`. Cinco trabajos:
  - `quality` — typecheck, strict typecheck, ESLint, los cuatro presupuestos,
    build y los dos chequeos de bundle (con valores `VITE_*` de relleno).
  - `tests` — la suite en **cuatro shards**, cada uno escribiendo su blob report
    con cobertura. `VITEST_SKIP_THRESHOLDS=1` está puesto a propósito: un shard
    corre un cuarto de los ficheros y fallaría un suelo de suite entera siempre.
  - `coverage` — reúne los cuatro blobs con `vitest --merge-reports --coverage`
    y aplica los suelos sobre un denominador. **Aquí se juzga la suite**, no en
    los shards.
  - `deploy` — **cuelga de los dos anteriores** (`needs: [quality, coverage]`),
    sólo desde `main`, en su propio grupo de concurrencia y **sin**
    `cancel-in-progress`: interrumpir un `vercel deploy` deja lo publicado a
    merced del momento en que llegó la señal.
- **`.github/workflows/e2e.yml`** — Playwright (Chromium escritorio + Safari
  iPad). **Sólo en PR**: en push a `main` analizaría el mismo árbol que la PR
  acaba de analizar.
- **`.github/workflows/security.yml`** — CodeQL y `npm audit --audit-level=high`.
  Sólo en PR y en cron semanal, por lo mismo.
- **`.github/workflows/supabase.yml`** — contratos pgTAP contra el stack local;
  se dispara sólo si cambian `supabase/**`, `scripts/supabase/**` o
  `package.json`.

El paso único de pruebas llegó a ser 8 m 49 s de un trabajo de 11 m 13 s — el
79 %. Dos causas, ambas corregidas: jsdom se construía para los 371 ficheros
cuando ~270 no tocan un DOM (ver *Testing Conventions*), y el resto corría en un
runner de 2 vCPU. No devuelvas los shards a un solo trabajo «para simplificar»,
y no muevas los umbrales a los shards.

**La ruta de los blob reports la fija Vitest y cambió en su mayor 5**: de
`.vitest-reports/` a `.vitest/blob/`. El modo de fallo merece recordarse porque
no apunta a donde duele: `upload-artifact` con la ruta equivocada **no falla**,
avisa «No files were found» y sale en verde, así que los cuatro shards pasan
subiendo artefactos vacíos y quien rompe es `coverage`, tres trabajos más allá,
con un `ENOENT`. Por eso la subida lleva `if-no-files-found: error` además de
`include-hidden-files: true`.

La versión de Node sale de `.nvmrc` (24) en los cuatro.

### Dependencias que no pueden subir, y por qué

Medido el 2026-09-19 resolviendo la cola de Dependabot paquete a paquete. Esto
existe para que nadie vuelva a intentarlo a ciegas: **las seis pasan la suite
entera**, y ninguna se detecta leyendo el changelog.

| Paquete | Qué pasa | Quién lo detecta |
|---|---|---|
| `vite` 8 | Cambia el bundler a **Rolldown**. La carga inicial pasa de 439,1 a **1 058,8 KB gz** y el artefacto cambia de forma: la entrada cae a 16,8 KB y aparecen veinte chunks pequeños en el arranque, más Excalidraw entero | `check:bundle-budget` |
| `@excalidraw/excalidraw` 0.18 | **Pierde la carga diferida.** Su chunk de 1 390 KB gz se muda al arranque: 439,1 → **1 937,8 KB gz** | `check:bundle-budget` |
| `typescript` 7 | `typescript-eslint@8.70` —la última publicada— declara `peer typescript@">=4.8.4 <6.1.0"`. No hay versión que lo soporte | el resolutor estricto de npm |
| `mermaid` 12 | Depende de `chevrotain` 11 → `lodash-es` vulnerable. **5 advisories de severidad alta**, entre ellos inyección de código vía `_.template` | `npm audit --audit-level=high` |
| `react-dom` 19 | La PR sube `react-dom` dejando `react` en 18. Rota de partida | typecheck |

**Lo que estos seis casos enseñan sobre los gates.** Los cinco primeros pasan
las 4 359 pruebas sin una sola en rojo. Un presupuesto de bundle y un `npm
audit` no son burocracia alrededor de la suite: miden cosas que **ninguna
prueba unitaria puede ver** —cuánto se descarga antes de pintar, y qué cadena
de dependencias arrastra un CVE—. Por eso son trabajos obligatorios aparte, y
por eso subir un número es una decisión de revisión y no un arreglo de build.

**Una rama de Dependabot no se fusiona tal cual.** Las once que había nacieron
de un `main` anterior a la auditoría y, comparadas con el actual, reintroducen
`.github/workflows/mirror-source.yml` —el workflow que copiaba otro repositorio
sobre el árbol y hacía `push` directo a `main`—, además de revertir `engines`,
`storage:inventory` y `@supabase/supabase-js`. `ciPipeline.test.ts` las pararía
en CI, que es su trabajo; el camino limpio es **aplicar las subidas sobre `main`
actual** y dejar que Dependabot cierre sus PR solo.

---

## Environment Variables

All client variables use the `VITE_` prefix and are read via `import.meta.env`. `.env.example` is the authoritative, commented list — read it before adding a variable. Create `.env.local` locally (git-ignored; never commit it).

| Variable | Purpose |
|---|---|
| `VITE_GEMINI_API_KEY` | Gemini key (users may also supply their own in Settings → IA) |
| `VITE_OPENROUTER_API_KEY` | Optional OpenRouter key |
| `VITE_AI_PROXY_URL` | Provider-agnostic proxy endpoint, e.g. `/api/ai`. **Optional**: a production build with it unset uses the `/api/ai` this repo deploys beside the bundle (`DEFAULT_AI_PROXY_PATH`); set it only when the proxy lives elsewhere. Unset in `npm run dev` means no proxy |
| `VITE_GEMINI_PROXY_URL` | Legacy Gemini-only proxy, e.g. `/api/gemini` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | **Obligatorias.** El proyecto Supabase: identidad, datos y archivos. La clave publicable es pública por diseño; la `service_role` nunca lleva prefijo `VITE_` |
| `VITE_LUCID_API_KEY` | Global Lucidchart token (users can paste their own) |
| `VITE_DIAGRAM_PIPELINE` | `canonical` (default) or `ai` fallback |
| `VITE_ARTIFACT_REFINEMENT_ENABLED` / `_AI_ENABLED` / `_MAX_PASSES` | Semantic refinement kill switches |
| `VITE_STRUCTURED_ARTIFACT_BRIEF_ENABLED`, `VITE_AI_BRIEF_EXTRACTION_ENABLED`, `VITE_TOP3_ARTIFACT_RECOMMENDATIONS_ENABLED` | On-demand artifact brief flags |
| `VITE_ENABLE_DEV_LOGIN` | Dev-only admin bypass button — ignored in production builds |

**Server-only** variables (no `VITE_` prefix → never bundled), set in Vercel → Settings → Environment Variables: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `AI_PROXY_MAX_REQUESTS_PER_WINDOW`, `GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW`.

User-supplied keys live in `localStorage`: `user_gemini_key`, `user_openrouter_key`.

### Vercel Deployment

`vercel.json` fija `framework: vite`, `buildCommand: npm run build`,
`outputDirectory: dist` y un rewrite SPA que **excluye `/api/`** — capturarlo es
el fallo de F5, y `__tests__/config/vercelApiRoutes.test.ts` lo sostiene. Tras
desplegar, añade la URL a **Supabase → Authentication → URL Configuration →
Redirect URLs**, o los enlaces de invitación y de recuperación volverán al sitio
equivocado. Ver `docs/security-hardening.md`.

**Producción la publica un solo camino, y es GitHub Actions.** El contrato
versionado `docs/operacion/despliegue.json` fija conjuntamente el repositorio
`eltata71/arky-sup`, la rama `main`, el equipo y proyecto Vercel `arky-sup`
(`team_HGSWQHORpMV8wQUQf3mAdWEl` / `prj_Sr0cq7A21ZX8MfEmyLBbEkpO0Bfk`) y el
alias estable `https://arky-sup.vercel.app`. Tras `vercel pull`, el job `deploy`
compara `.vercel/project.json` con ese contrato antes de construir: secretos que
resuelvan otro destino fallan cerrados. El proyecto está enlazado a este
repositorio, así que su integración Git desplegaría al recibir el push, sin
leer el resultado de ningún gate. `vercel.json` lo apaga:

```json
{ "git": { "deploymentEnabled": { "main": false } } }
```

Tres cosas que esa línea decide:

- **Sólo `main`.** Las ramas que no se nombran siguen desplegando, así que cada
  PR conserva su preview — la mitad útil de la integración Git.
- **No es `deploymentEnabled: false`.** Esa forma apagaría también las previews.
  `__tests__/config/ciPipeline.test.ts` afirma las dos cosas por separado.
- **Vive en el repositorio, no en el panel.** Un interruptor del dashboard no se
  revisa en una PR, no viaja con el repositorio y nadie se entera el día que
  alguien lo vuelve a encender. El `$schema` de la cabecera es la otra mitad:
  una clave mal escrita en `vercel.json` se acepta en silencio y no hace nada.

No es hipotético. El primer despliegue del proyecto nuevo falló **en el build,
en producción, sobre un commit ya fusionado**, porque el gate de
`lib/runtimeConfig.ts` rechazó una clave de proveedor con prefijo `VITE_`. Ese
fallo pertenecía a una PR.

**Y el mismo gate falló por el otro lado, que es el modo más caro.** Una
`VITE_SUPABASE_URL` escrita a mano en el panel de Vercel sin el esquema
(`btbhkmckrazoayaoorys.supabase.co`) pasó el gate —que sólo la comprobaba
*presente*—, pasó el build, pasó el despliegue, y reventó dentro de
`createClient` al pulsar «Iniciar sesión»: `Invalid supabaseUrl`, una frase que
nombra un argumento del SDK y no la casilla que hay que corregir. Quien lo vio
leyó «contraseña inválida», porque ninguna credencial llegó a comprobarse —el
cliente nunca se construyó, así que el enlace de recuperación tampoco se
envió. **Una variable presente y mal escrita no es una variable configurada**:
`isValidSupabaseUrl` aplica ahora la regla del SDK —ni más estricta ni más
laxa, para que `http://127.0.0.1:54321` del E2E siga valiendo— en el gate y en
el adaptador, y el mensaje nombra la variable sin repetir nunca el valor: el
log de un build es público.

Detalle, secretos y runbook de reversión en `docs/ci-cd-pipeline.md`.

### Desplegar el esquema

Hosting es de Vercel; Supabase sirve identidad, datos y archivos. El esquema son
migraciones versionadas en `supabase/migrations/`, y se aplican **en orden**:

```bash
supabase link --project-ref <ref>     # una vez
supabase db push                      # aplica las migraciones pendientes
supabase functions deploy provision-user
```

**Las migraciones son aditivas respecto a la aplicación en ejecución**:
aplicarlas *antes* de desplegar el código que usa las rutas nuevas es el orden
correcto, nunca al revés — exactamente la misma regla que tenían las reglas de
Firestore.

**Un aviso operativo que cuesta una sesión encontrar.** Todo el producto entra
por RPC del esquema `api`. Si PostgREST no lo tiene en `db-schemas`, cada
llamada devuelve 404 y la aplicación se lee como si no hubiera datos. La
migración `data_api_exposed_schemas` lo fija con `alter role authenticator set
pgrst.db_schemas`, pero **cambiar «Exposed schemas» desde el panel reescribe la
configuración del contenedor** y puede volver a dejarlo fuera. Si un día todas
las RPC devuelven 404, ese es el primer sitio donde mirar.

Verificación local completa —esquema reconstruido desde cero, contratos pgTAP,
lint de SQL, advisors y comprobación de tipos generados— con
`bash scripts/supabase/local.sh verify`. Necesita Docker; es lo mismo que corre
`.github/workflows/supabase.yml`.

---

## State Management

React Context only — no Redux/Zustand/Jotai.

| Context | File | Responsibility |
|---|---|---|
| `AppContext` | `context/AppContext.tsx` + `context/app/` | Projects, artifacts + versions, settings, `t()` i18n, chat history, agent action log, architecture graph, publication packages, `persistenceStatus` |
| `AuthContext` | `context/AuthContext.tsx` | Logged-in user, role, sign-in/out/register |
| `InitiativeContext` | `context/InitiativeContext.tsx` | Business initiatives: capture, tracking fields, KPIs, milestones, risks, stakeholders, supporting documents |
| `OfficeContext` | `context/OfficeContext.tsx` | Architecture Office engagements: intake, charter approval, running the task DAG, gates, ARB decisions |
| `LMSContext` | `context/LMSContext.tsx` | Courses, progress, notes, catalog |
| `ToastContext` | `context/ToastContext.tsx` | Transient notifications |
| `CommandPaletteContext` | `context/CommandPaletteContext.tsx` | Cmd+K command registry |
| `ObservabilityContext` | `context/ObservabilityContext.tsx` | Runtime error surface + telemetry |

The provider tree is assembled in `index.tsx`: `ObservabilityProvider → ErrorBoundary → AuthProvider → AppContextProvider → InitiativeProvider → OfficeProvider → LMSProvider → ToastProvider → AriaAnnouncerProvider → BrowserRouter → CommandPaletteProvider → App`.

`InitiativeProvider` sits **above** `OfficeProvider` on purpose: an initiative is the reason an engagement exists, so the Office may read initiatives, never the reverse.

### `AppContext` is one context composed of seven hooks

The surface is deliberately **one** context: forty modules read it, and
splitting the *context* would make every screen decide which of four to
subscribe to. What was split is the *provider*, which costs a consumer nothing.
Each concern owns a module under `context/app/`:

| Module | Owns |
|---|---|
| `usePersistenceReporter` | whether the last write reached the database |
| `useAppBootstrap` | the first read of projects and settings |
| `useSettingsState` | settings, theme, `t()` |
| `useProjectsState` | the `projects` array and every project write |
| `useArtifactsState` | artifacts, versions, and the rollback rule |
| `useProjectHistory` | chat history and the agent action log |
| `useArchitectureGraphSync` | the debounced knowledge-graph rebuild |

**`projects` has exactly one owner** — `useProjectsState`. The hooks that write
artifacts or graph fields do it through the `setProjects` and `updateProject`
handed to them. Two arrays of the same artifacts is how a canvas and a sidebar
start disagreeing about what the user just edited, and
`__tests__/context/appContextComposition.test.ts` fails if a second one appears.

`AppContext.tsx` itself must stay composition: no `useState`, no `useEffect`,
no `useCallback`, no service import. It reached 917 lines the way these files
always do — forty lines at a time, each addition reasonable on its own — so the
guard is on the shape, not only on the size. Add a hook under `context/app/`,
or a dedicated context.

---

## Data Layer

### Dónde vive cada cosa, y cómo se entra

**Ninguna tabla se lee ni se escribe directamente.** Los privilegios están
revocados sobre todas ellas; lo único que `authenticated` puede ejecutar son las
RPC del esquema `api`, que comprueban permiso **y sesión viva** antes de tocar
nada. Es la postura deny-by-default de ADR-003, y es lo que hace que un cliente
manipulado no gane nada: no hay superficie que atacar.

| Tabla | RPC de entrada | Contenido |
|---|---|---|
| `api.architecture_projects` | `list_project_aggregates`, `load_project_aggregate`, `save_project`, `save_project_aggregate` (sólo creación), `delete_project_aggregate` | La raíz del Proyecto/Atención. Su contador e índice de artefactos son una **proyección** que recalcula el servidor; las lecturas devuelven `revision` |
| `api.project_artifacts` | `create_artifact`, `create_artifact_version`, `update_artifact`, `delete_artifact`, `revise_artifacts` | El Artefacto es raíz de su propio agregado (ADR-106): un comando por intención, revisión **del artefacto**, índice único por versión de grupo (A-02). Ningún comando recibe la lista del proyecto |
| `api.project_chat_history` | `load_chat_history`, `save_chat_history` | Una fila por proyecto, reescrita entera |
| `api.agent_actions` | `list_agent_actions`, `append_agent_action` | Registro append-only de lo que hizo el agente |
| `api.artifact_comments` | `list_artifact_comments`, `save_artifact_comment`, `delete_artifact_comment` | Hilos de revisión |
| `api.artifact_review_decisions` | `list_artifact_review_decisions`, `record_artifact_review_decision` | Rastro **inmutable**: `on conflict do nothing`, nunca se reescribe |
| `api.office_engagements` + `api.office_arb_decisions` | `load_engagements`, `save_engagement`, `delete_engagement`, `record_arb_decision` | Encargos de Oficina y decisiones del ARB |
| `api.business_initiatives` | `list_business_initiatives`, `save_business_initiative`, `delete_business_initiative` | Iniciativas: lo alto de la jerarquía |
| `api.architecture_knowledge_graphs` | `load_knowledge_graph`, `save_knowledge_graph` | Grafo de conocimiento: **derivado**, en su tabla porque crece con los artefactos |
| `api.user_settings` | `save_user_settings` | Preferencias por usuario |
| `api.user_profiles` | `load_own_profile`, `list_user_profiles`, `provision_user_profile`, `set_user_role`, `set_user_status`, `delete_user_profile`, `update_own_display_name` | Perfil y rol. El correo se lee de `auth.users`, nunca se copia |
| `api.agent_profiles` | `list_agent_profiles`, `save_agent_profile`, `delete_agent_profile` | La ficha configurada de cada agente, por usuario |
| `api.lms_courses` / `_progress` / `_context` / `_notes` | `list_courses`, `save_course`, `delete_course`, `load_progress`, `save_progress`, `load_context`, `save_context`, `list_notes`, `save_note`, `delete_note` | Centro de Formación |
| `api.file_objects` + dos cubos privados | `register_file_object`, `mark_file_object_ready`, `mark_file_object_deleted` | Archivos: la metadata y su binario, atados por el id que Storage asigna |

**Si cambias una forma, la migración va en el mismo cambio.** La diferencia con
Firestore es que ahora la regla y el dato viven en el mismo fichero: una RPC que
valida es la misma que escribe, y `private.authorization_audit` recibe la
entrada en la misma transacción que el cambio de rol.

### Service layer rule

Each context owns a repository — `architectureProjects`, `artifacts`, `chat`,
`agent`, `architectureOffice`, `businessInitiatives` — and they sit on
`services/persistence`, which owns `PersistenceResult`, the error
classification (`supabaseErrors.ts`: **una sola tabla** de códigos de PostgreSQL
y PostgREST, que antes estaba escrita cinco veces con diferencias que no eran
decisiones) and `writeLocalDraft` (the one correct way to degrade: keep the
data, and say it is only local). It also owns `MirroredList`, the
cache-plus-local-mirror pattern that five contexts had each written their own
slightly different copy of.

**There is no shared persistence module any more.** The monolith held
seven contexts in 1 379 lines and was deleted in Ola 2: each context now owns
its adapter. Talk to your context's repository.

**El SDK se importa en exactamente un fichero**, `services/adapters/supabaseClient.ts`,
y ESLint lo exige. Antes la lista tenía un fichero por contexto, porque cada
repositorio hablaba con la base directamente; con todo el acceso por RPC, el SDK
sólo hace falta para *crear el cliente*.

**Y el cliente es uno, lo cual no es orden sino corrección.** Hubo dos —uno de
identidad y uno de datos—, cada uno con `persistSession: true` y, al no declarar
`storageKey`, sobre la misma clave de almacenamiento. El SDK avisa de esto por
consola («Multiple GoTrueClient instances … under the same storage key») y el
modo de fallo es el que no se ve venir: los dos traen `autoRefreshToken`, así
que los dos renuevan el **mismo** refresh token; el segundo recibe
`refresh_token_already_used`, el SDK borra la sesión guardada y emite
`SIGNED_OUT`, `useAuthSessionBootstrap` lo traduce a `setUser(null)` y
`ProtectedRoute` manda a `/auth`. Visto por una persona: **iniciar sesión bien y
volver a la pantalla de inicio de sesión**, sin un solo error en pantalla. Tumbó
los tres recorridos autenticados de la suite E2E.

Identidad, datos y archivos son tres vistas de esa única instancia, y
`__tests__/authz/noSdkInUiLayers.test.ts` cuenta las construcciones —no los
imports— porque reexportar el SDK y llamar a `createClient` en otro sitio
traería el defecto entero sin mover una línea de import.

**Y se carga en diferido.** El fichero hace `await import(...)`, lo que mantiene
59 KB gz fuera de la carga inicial: el SDK sólo se descarga cuando algo va a
hablar con la base de datos, que nunca es antes de pintar la pantalla de inicio
de sesión.

### Degradation and persistence status

When the database is unavailable (no configuration, permission denied, offline) the service layer transparently falls back to LocalStorage. `services/persistence` normalises every write into a `PersistenceResult` (`success | failed | permission-denied | offline | conflict | validation-error`) and `AppContext` surfaces it as `persistenceStatus` / `persistenceMessage`, rendered by `components/PersistenceStatusBanner.tsx`. See `docs/persistence-hardening.md`.

**The local mirror was write-only until Ola 2, and this is worth knowing.**
`writeLocalDraft(key, …)` stored under `arky.offlineDraft.{key}` wrapped in
`{ value, status, at }`, while `readLocal(key)` read the bare `{key}`. They
never met: every `readLocal(...) ?? []` fallback in the product returned the
empty list, so the degradation this layer exists to provide kept the user's
work and was then unable to show it back. It came straight from the two private
methods of the persistence monolith this module was extracted from, and the test
covering it wrote the raw key just like the reader did, so nothing caught it.
`readLocal` now looks at the draft first and falls back to the bare key for
values older builds wrote. `MirroredList` is the primitive that exercises the
round trip, and `__tests__/services/persistence/mirroredList.test.ts` pins it.

**`MirroredList` is how a context caches a list.** Five contexts had each
written their own copy of "cache, then the database, then the local mirror", with
differences that were not decisions. Two rules it encapsulates: a local draft is
never reported as success, and the in-memory cache only ever holds *confirmed*
writes — caching a failed one would serve it back as good for the next five
minutes, which is about how long it takes someone to close the tab believing
their work is saved.

---

## AI Layer

`services/ai/` is the canonical layer, and it is canonical in fact: **no module
outside it may import `services/geminiService`**, and ESLint enforces that. The
engine is an implementation detail of this layer.

### 1. `services/ai/` — the provider-agnostic architecture

Layering, top → bottom: `generation/` façades → `core/` contracts + `AIRequestExecutor` → `routing/` → `providers/` → `catalog/` → `retry/` → `errors/` → `tracing/`.

**The rule, and it is now enforced by tests rather than by convention:**

```
Domain / Agent / Orchestration → Canonical AI Kernel → Provider Adapter → Provider API
```

`__tests__/services/ai/kernelArchitectureRules.test.ts` scans the code — not the
comments — and fails if any of six invariants comes back. They exist because
each of them was broken while the docblock above them said otherwise:

- **The executor was Gemini's.** `AIRequestExecutor`'s constructor read
  `classifier = geminiErrorClassifier` and every call site took the default, so
  on the path documented as *provider-driven* every Anthropic and OpenRouter
  failure was stamped `provider: 'gemini'` and judged by heuristics scoped to
  Google's SDK. `AIProvider.classifyError` had existed the whole time and was
  called by nobody. **Classification is the adapter's; the decision is not** —
  retry, model fallback, provider fallback and health all read the canonical
  `AIErrorCategory` in `errors/retryDecisions.ts`, once, for every backend.
- **A capability was declared without an implementation.** `embeddings` sat in
  the factory's union with no method behind it, so asking for it could only
  throw. It is gone rather than stubbed.
- **A capability was read by cast.** Tool support was probed with
  `(provider as { supportsTools?: boolean })` and defaulted to *supported*.
  `AIProviderCapabilities` is now one required record on `AIProvider`, so adding
  a capability is a compile error in every adapter instead of a silent `false`.
  It caught two live defects on the way in: `GeminiProvider` declared tools and
  never put a `tools` key on its config, and `OpenRouterProvider` sent tools and
  discarded the `tool_calls` that came back.
- **A requirement had no strength.** `AICapabilityLevel` is the missing half:
  `required` reroutes before a token is spent and fails when no route serves it,
  `preferred` biases ranking, `optional` only reports. Requirements are
  *derived* from the request's own shape (`deriveRequiredCapabilities`), not
  trusted from the caller — leaving it to callers is how the requirement came to
  be checked in `negotiate` and ignored in routing, the one place that could act.
- **The neutral contract carried a vendor payload.** `rawContents?: unknown`,
  documented as "e.g. Gemini `Content[]`". Nothing ever set it, which is the
  tell. `AIContentPart` (text / image / file / tool-call / tool-result) is the
  canonical replacement. `providerConfig` survives — some parameters genuinely
  have no neutral meaning — but keyed by provider, so a value written for one
  backend can no longer be merged into another's body when the provider changes.
- **The tool contract pointed backwards.** `fromGeminiTools` read definitions
  back *out* of Google's wire shape, because the monolith assembled
  `functionDeclarations` inline at two call sites — with *different*
  descriptions, so the streamed assistant briefed the model more weakly than the
  buffered one for the same request. Both declare `MODIFY_ARTIFACT_TOOL` now and
  the recovery adapter is deleted.

- The UI and domain depend only on `core` contracts and `generation` façades — **never on `@google/genai` directly**.
- Adding a provider means registering a builder with `AIProviderFactory`; `GeminiProvider` and `OpenRouterProvider` are the current implementations (OpenRouter includes its own SSE reader, error classifier and model list).
- `retry/` owns backoff (503/429) and the request timeout; `errors/AIErrorClassifier` normalises provider errors; `tracing/AITraceBuilder` produces the trace shown in `GenerationTracePanel`.
- `structuredOutput/` parses schema-checked JSON responses — prefer it over hand-rolled `JSON.parse`.
- `context/` builds the context pack sent with a prompt (signal extraction, relevance ranking, dedup, freshness, conflict detection, citations).
- Prompts live in `services/ai/prompts/` (`diagramPrompts.ts` carries the 10-dimension diagram rubric).
- `schema/` is the **neutral schema dialect** (`AIJsonSchema`, standard JSON Schema in lowercase) plus one adapter per provider. Describe output shape with `defineSchema` — never with a vendor's type enum. The adapters accept either dialect on input and emit one on output, which is what made the migration incremental.
- `catalog/` gives each provider its own tier table, fallback chain and id-recognition rule. Resolve a tier with `resolveModelForSettings`; nothing outside a provider should name a concrete model. The **model catalogue itself is `lib/ai/modelCatalog.ts`**, not this layer: five contexts — app bootstrap, agent, chat, artifacts and the Settings screen — need to resolve which model a `Settings` implies, and holding that inside `services/ai` made the AI layer a dependency of all of them, with an `ai <-> chat` cycle on top. A contract with no behaviour belongs in a leaf. `lib/ai` and a provider adapter are the only two places a concrete model id is named.
- `callControl/` gates every AI call: cooldowns after a 429, payload-size estimation and the per-call chat-history budget. It lives inside this layer because a call budget is meaningless without the call.
- `tools/` carries the per-provider adapters and the tools this product declares. The vocabulary itself (`AIToolDefinition`, `AIToolCall`, `AIToolResult`) is in `core`: a contract with no behaviour belongs next to the request that carries it, and keeping it one layer up is what forced three adapters to write `request.tools as AIToolDefinition[]` — an unchecked assertion at exactly the boundary where a wrong shape becomes someone else's 400.
- `guardrails/` decides what may not leave and what may not come back, in three severities whose difference is *what the caller may do next*: `warning` proceeds and is recorded on the trace, `recoverable-block` says the same request would fail again, `hard-block` says do not retry at all. A credential in a prompt is a hard block — a prompt reaches a third party and is retained, so it cannot be un-sent. An injection *phrase* is only a warning, and that is a decision about this product: Arky writes security documents, and an ADR about prompt injection legitimately contains «ignora las instrucciones anteriores». The mitigation is `wrapUntrustedContent` (`lib/untrustedContent.ts`), not a refusal to process the sentence. **Position is half the requirement**: the input guard sits above the retry policy, the model chain and the provider fallback, so a blocked request leaves the provider's call counter at zero — and it runs on all three paths that reach a backend (`core/requestGuards` for the executor, `aiProxyClient` for the proxy, `legacyGeminiBridge.routeLegacyRequest` for the monolith's own chain), because guarding only the canonical one would leave the largest prompt surface ungoverned while the docs said otherwise. See `docs/ai-kernel.md`.
- `capabilities/` compares what a request needs against what the provider offers. A `preferred` or `optional` gap is **reported** — degrading is allowed, degrading silently is the defect this exists to prevent. A `required` gap is not degradable at all: `negotiateOrThrow` refuses, and the executor skips that candidate first, so the refusal only happens when no route serves it.
- `routing/` decides **which backend**, in two stages that are deliberately not merged. *Eligibility* is a filter and it is absolute: a candidate that cannot serve a `required` capability is removed, never penalised — a score can be outweighed and a missing guarantee must not be. *Ranking* orders the survivors by configured provider (100), health (0–60), `preferred` capabilities served (25 each) and registration order as the tie-break, recording every contribution in `factors` so a total can be read rather than trusted. The output is an `AIRoutePlan` plus an `AIRouteDecision` — what was required, what was considered, what was rejected and why — carried on the trace.

  Two weights encode decisions worth keeping. `configuredProvider` outranks `health`, so a user's explicit choice is never abandoned on the strength of one 503; health reorders the alternatives behind it. And **model fallback and provider fallback stay independent policies**: switching model is resilience, switching vendor changes who processes the data, so `allowProviderFallback` is off in every shipped preset and is the operator's switch. The single exception is not governed by it — when the configured backend cannot serve a **required** capability, rerouting is mandatory, because the alternatives are failing or answering a different question from the one asked.

  `providerHealth` is a circuit breaker per backend: three consecutive failures open it, sixty seconds later one probe decides. An open circuit **deprioritises rather than excludes** — a degraded backend that is the only one able to serve a required capability still beats a certain failure — and only transport-level failures count, so a 400 this app produced never opens a circuit against a vendor.
- `generation/` holds the domain façades — `artifactGenerationService`, `diagramGenerationService`, `documentGenerationService`, `recommendationService`, `assistantService`, `learningService` — plus `aiGateway` for layers that compose their own prompts. **These are the import surface for the rest of the app.**

### 2. `services/geminiService.ts` — legacy monolith (~5,500 lines)

**The LMS no longer lives here.** The Training Center's ten generation methods
were the first vertical of the strangler migration and now sit in
`services/ai/generation/learning/`, reached through `learningService`. The
extraction was exact because the capability was measurably self-contained:
zero callers inside the class, and three engine dependencies that each already
had a neutral equivalent. `__tests__/services/ai/learningVertical.test.ts`
keeps it out. Do not add LMS generation to the monolith again.

Still the home of most artifact prompts and the `geminiService` singleton (a class instance with one method per generation concern: syllabus, lesson content, consulting, critique/refinement, C4 self-healing, …). It also owns `generateContentWithFallback`, which tries the serverless proxy first and degrades to a direct provider call.

Rules when touching it:

- One method per artifact type/concern — never merge unrelated prompts.
- Reuse the existing streaming, retry (503/429 exponential backoff) and 180s-timeout helpers; do not re-implement them.
- Never hardcode a model name — the model comes from `settings.aiConfig.model`.
- Do not duplicate key resolution; the shared helper already handles the user's `localStorage` key.
- **Do not grow this file, and do not import it.** It is reachable only from inside `services/ai/`; a lint rule enforces that. New capabilities belong in `services/ai/generation/`.
- **And the `services/ai` barrel may not re-export it.** A second, narrower rule on `services/ai/index.ts` alone: inside the layer the engine is a legitimate internal dependency — a façade delegating to it *is* the strangler pattern — but the barrel is the published surface. It used to re-export `AIServiceError`, `classifyAIError`, `C4SelfHealingError` and four deterministic fallbacks straight out of the monolith, so seven screens caught the engine's symbols through the door built to hide them. The errors now live in `services/ai/errors/aiServiceError.ts` and the fallbacks in `services/artifacts/deterministicArtifactFallbacks.ts`; ESLint and `__tests__/services/ai/publicApiSurface.test.ts` both hold the line.
- It is no longer in the eager entry chunk — `OfficeContext` loads the AI surface on demand. Keep it that way: a static import from a module in the root provider tree puts a ~600 kB chunk back into app startup.

### 3. Serverless proxy (`api/`)

`api/ai.ts` accepts `{ provider, model, prompt|contents, systemInstruction, temperature, maxOutputTokens, responseMimeType, responseSchema, stream }` and returns `{ requestId, text, provider, model }` or a normalised error envelope `{ requestId, error, source, retryAfterMs? }`. Streaming (SSE) is supported. `api/_shared/proxyRuntime.ts` holds the transport concerns: 2 MB body cap, per-client in-memory rate limit (60 req/60s by default), JSON error envelope, provider status normalisation.

`services/ai/aiProxyClient.ts` returns `null` whenever the proxy is unset or fails, so **every caller must keep working without the proxy**. Full details in `docs/ai-proxy.md`.

**The endpoint has a default, and that is a fix rather than a convenience.**
Production is fail-closed, so `VITE_AI_PROXY_URL` unset meant every AI feature
refusing to run — while pointing the user at `/api/ai`, a route the same
deployment was already serving. A production build now defaults to it. Two
consequences worth keeping: the client tells *the endpoint is not the proxy*
(404, or the SPA's HTML from the catch-all rewrite) and *the proxy has no
provider key* (`500 missing_provider_api_key`) apart from a provider outage —
all three are `not-configured`, because none of them improves by being retried;
and `lib/runtimeConfig.ts` no longer fails a build for the unset variable, which
is what had made a deployment switch the whole gate off with
`VITE_DISABLE_RUNTIME_CONFIG_GATE=true` and lose the operator-key check with it.

**A handled failure does not get a modal.** `RuntimeErrorOverlay` is for the
view that cannot continue — a render that threw, a chunk that never arrived —
and its offer to reload is that failure's actual remedy. It used to block on any
non-recoverable error, so an unconfigured proxy covered the product with
«Recargar aplicación» on top of a help panel that had already degraded to the
written guide and was showing the answer underneath. It now blocks only on
`critical`, or on an error from `runtime` / `react-boundary` / a failed chunk.
Everything else is recorded in the observability centre and reported by the
surface that made the call, which is the only one that knows what it did
instead.

---

## Diagram Pipeline

The canonical pipeline is **deterministic TypeScript** — the LLM produces *content* (Mermaid or IR), never layout:

```
Mermaid ──mermaidToIR──▶ DiagramIR ──┬── irToReactFlow  (dagre / ELK layout)
                                     ├── irToExcalidraw
                                     ├── irToMermaid    (round-trip serializer)
                                     └── audienceProjector (executive/technical/operations)
```

Entry point: `services/diagram/index.ts` (`getPipelineMode()` reads `VITE_DIAGRAM_PIPELINE`; `canonical` is the default, `ai` is the legacy fallback kept for debugging regressions).

Around that core, `services/diagram/` also owns: C4 and BPMN validation, auto-repair, quality gates (`qualityGate.ts`, `visualQualityGate.ts`, `diagramTypeQualityGates.ts`), readability metrics, semantic grouping and role resolution, edge routing/handles/label slots, smart fit and viewport fitting, export bounding-box cropping, accessible summaries, and telemetry. Design tokens and themes live in `lib/diagramTokens.ts` / `lib/diagramThemes.ts`; layout engines in `lib/layoutEngine.ts`, `lib/elkLayoutEngine.ts`, `lib/layoutSelector.ts`.

Rendering surfaces: Mermaid (via `components/artifacts/diagram/`), ReactFlow (`ReactFlowCanvas.tsx` + `components/reactFlowCanvas/` + `CustomNode`/`CustomEdge`/`NodeIcons`), Excalidraw (lazy ESM), Lucidchart embed, and the "Fable" view.

This is the most heavily tested subsystem — 106 spec files under `__tests__/diagram/`, with `.mmd` fixtures in `tests/fixtures/`. **Any change here ships with tests.** Background: `docs/diagram-quality-gate.md`, `docs/diagram-world-class-audit.md`, `docs/diagram-world-class-audit-2026-04-17.md`.

### The story is read from the model, never reconstructed from it

The IR has always carried a narrative — `DiagramNarrative`, with `scenes` bound
to node ids and `callouts` bound to elements — and until `buildStoryPlan`
nothing produced or read one. **Three** derivations rebuilt a walk from BFS
levels instead, the `presentation.scenes` prop meant to carry an authored story
was passed by nobody and read by nobody, and `DiagramCallout` was a declaration
with no implementation. So story mode animated a plausible sequence rather than
the real one: the same failure the coordination panel exists to avoid, told
with motion.

`services/diagram/storyPlanner.ts` is now the one answer to "in what order is
this read", and it holds four rules:

- **Authored wins.** A written scene is the story; a BFS level is a guess about
  it. The derivation runs only when there is nothing to honour.
- **Derived is distinguishable from declared.** `StoryPlan.source` travels with
  the plan, and the two fields a derivation cannot honestly fill —
  `primaryMessage` and `conclusion` — stay `null` rather than composed. A
  described topology presented as an argument is a sentence the architect never
  wrote appearing over their signature.
- **Broken references are reported, never dropped** (`unresolvedReferences`,
  plus the `NARRATIVE_STALE_REFERENCE` lint rule).
- **Nothing to tell returns `null`**, not an empty plan.

`DiagramNarrative.source` is what keeps the second rule enforceable: the repair
pass synthesises a one-line summary and marks it `derived`, so it is not
*storable* in the shape of a written story. That mattered in the rubric — the
*narrativa* dimension used to award a flat ten points for the field being
non-empty, which the repair guaranteed on every diagram it touched, so the
rubric was paying for its own repair. Credit is graduated now. `narrativeHasText`
and `narrativeIsAuthored` (`lib/diagram`) are the one definition of each
question; the repair and the planner had drifted apart on it.

The generator can finally produce one: `services/ai/prompts/diagramStorySchema.ts`
carries the structured narrative in **both** halves of the contract — the JSON
the prompt prints and the schema the request enforces — so they cannot diverge.
The model writes meaning, never geometry: scenes are ids and a title, callouts
are ids and a sentence. See `ADR-005`.

### A diagram is changed, not regenerated

Every AI-assisted change used to be a fresh `generateDiagramIR`: new ids, a new
layout, and every manual adjustment gone. A change of one word cost the diagram,
which is why nobody made small changes.

`lib/diagram/semanticPatch.ts` declares thirteen operations over ids that
already exist, and `services/diagram/semanticPatchEngine.ts` applies them with
three guarantees: **checked before applied** (a typed rejection per bad
operation, and the good ones beside it still apply), **the result is always a
valid IR** (removing a node takes its edges, group memberships and annotations,
and every cascade is listed — a deletion nobody asked for is one they get told
about), and **a patch that changes nothing says so** (`changed: false` and the
original object). `describeSemanticPatch` is the same code path against a copy,
so a preview cannot describe one thing and the apply do another.

There is no `move-node` with coordinates and no `set-colour`, deliberately:
position belongs to the layout engine and appearance to the design system, and
an operation able to set either would let a model overrule both from inside a
JSON payload. `services/ai/generation/diagramEdit/` is the vertical that asks a
model for one — one agent, one call, proposes and never applies. See `ADR-006`
and `docs/diagram-story-and-patches.md`.

---

## Artifact Subsystems

| Subsystem | Location | What it does | Doc |
|---|---|---|---|
| Generation pipeline | `services/artifacts/artifactGenerationPipeline.ts` (vocabulario en `lib/artifacts/artifactPipelineContracts.ts`) | Stage/diagnostic model (`request → ai-generation → raw-response → parsing → normalization → validation → rendering → persistence → export`) | `docs/artifact-generation-hardening.md` |
| Artifact compiler | `services/artifactCompiler/` | Contract registry, section/contract validators, document repair, unified scoring, recompile | `docs/artifact-compiler.md` |
| Quality | `services/quality/` | Artifact + document quality models, gates, auto-repair, report rendering | `docs/diagram-quality-gate.md` |
| Presentation | `services/artifacts/*PresentationCompiler.ts` | Markdown/table/diagram/hybrid → presentation model | — |
| Review | `services/review/` | Local / remote / hybrid review repositories, comments, decisions | — |
| Publication | `services/publicationPipeline/` | Preflight, packages, approvals, branding, manifest, accessibility, audit trail, versions | `docs/publication-pipeline.md`, `-packages`, `-governance`, `-accessibility` |
| Export | `services/export/` | Registry + adapters: md, html, pdf, docx, pptx, xlsx, csv, json, txt, diagram raster, zip | `docs/export-hardening.md` |
| Knowledge graph | `services/architectureKnowledgeGraph/` | Entity/relation extraction, normalization, dedup, freshness, consistency, impact, traceability | `docs/architecture-knowledge-graph.md`, `docs/consistency-engine.md`, `docs/traceability-engine.md` |
| Agent | `services/agent/` | Intent classification, planning, execution, memory extraction, proactive detection, lesson recording | `docs/arquitecto-agente.md` |
| Business initiatives | `services/businessInitiatives/` | The motivation layer: needs, drivers, objectives, outcomes, KPIs, milestones, risks, stakeholders, supporting documents, and the rollups the dashboard reports | — |
| Architecture Office | `services/architectureOffice/` | **Engagement engine**: 13 executable agent personas, deterministic charter planning, task DAG with cross-review, ARB governance, gates and validators | `docs/oficina-arquitectura.md` |
| Team coordination | `services/architectureOffice/officeCoordination.ts` | Every assistant request runs through the office **as a team** — coordinator, specialists, consolidator — and emits an observable event stream the UI animates | `docs/oficina-arquitectura.md` |
| Context graph | `services/contextGraph/` | Builds and ranks the project context sent to the model | — |

`components/ArtifactCanvas.tsx` is the central canvas. It has been decomposed: rendering, export, editing, speech, fullscreen, view mode, suggestions and diagnostics all live in `hooks/artifacts/*`, and the per-format views live in `components/artifacts/<format>/`. **When extending the canvas, add a hook or a subview — do not grow `ArtifactCanvas.tsx`.**

---

## Aggregates: one factory each, and a gate

Four aggregates, four factories, and none of them is a React component any more:

| Aggregate | Factory | What it refuses |
|---|---|---|
| `Project` (atención) | `services/architectureProjects/architectureProjectFactory` | no name, no initiative |
| `OfficeEngagement` (entregable) | `services/architectureOffice/officeEngagementFactory` | no title, no attention, no initiative link |
| `BusinessInitiative` | `services/businessInitiatives/businessInitiativeFactory` | no title, no stated need, no owner |
| `Artifact` | `services/artifacts/artifactFactory` | — it enforces identity and versioning rather than refusing |

Until Ola 3 three of the four were built with an object literal **inside a
React context**: `OfficeContext` assembled a 60-line `OfficeEngagement` in a
`useCallback` that also planned the charter, called the model, wrote the audit
trail and persisted; `InitiativeContext` held the "a title and a need are
required" rule above a constructor it did not own; `useArtifactsState` decided
version numbering between two `setState` calls. None of those rules could be
checked without rendering a provider.

**An invariant that lives outside its aggregate is not an invariant, it is a
convention of one screen** — and the screen is the thing most likely to be
copied. `__tests__/services/aggregates/noAggregateLiterals.test.ts` is what
keeps it that way: it scans for `: Aggregate = {` outside the factory, because
the compiler cannot help here — an object literal satisfies the type. Spreads
(`{ ...engagement, status }`) are deliberately allowed: modifying an existing
aggregate is what the transition rules do.

**Transitions are pure functions, next to the aggregate.**
`services/review/reviewTransitions.ts` was the pattern;
`services/architectureOffice/officeEngagementTransitions.ts` follows it with the
Office's one governance rule — *nobody runs a charter that has not been
approved*. Running before approving turns the approval into paperwork filed
after the fact, which is the thing an Architecture Office exists to prevent.

**And a state change carries its own reason.** `transitionEngagement` changes
`status` *and* appends the audit entry in one operation, because these used to
be two adjacent steps:

```ts
engagement = { ...engagement, status: 'blocked' };
engagement = withAuditEntry(engagement, 'engagement-blocked', '…');
```

Two adjacent steps are not one. A transition that forgets the second produces a
state change with no trace, and the trace is precisely what an Architecture
Office has to be able to show. It already happened: the runner's
`{ ...initial, status: 'in-progress' }` moved the engagement and the
`run-started` entry arrived two lines later, separately. The scanner in
`__tests__/services/aggregates/officeEngagementTransitions.gate.test.ts` keeps
them together — the compiler cannot, because a spread with `status` satisfies
the type just as well. It found one call site this rewrite had missed.

**Two rejections are worth reading before adding a third.** The engagement
factory accepts an initiative **by id or by `NEG-YYYY-NNN` code**: ids are
canonical, but a project saved by an older build arrives with only the code
mirror and `portfolioResolver` migrates it lazily on read. Requiring the id
would turn a correct silent migration into a user-facing error. And every
factory returns a typed result rather than throwing — a missing initiative is an
outcome the UI renders, and a `throw` would push each caller into a `try` that
most would write empty.

### `NEG-YYYY-NNN` is a value object

`BusinessInitiativeCode` in `lib/eaTerminology.ts` is a branded string with one
smart constructor, `toInitiativeCode`, which normalises (trim, uppercase) before
validating. The format used to be checked by **two identical regexes** — here
and in `services/architectureOffice/officeShared.ts` — which is one definition
too many for a key people quote in a steering meeting.

`BusinessInitiative.code` is `BusinessInitiativeCode | ''`, and the `''` is not
sloppiness: a malformed code in a stored document degrades to empty rather than
to something plausible, because a code that *looks* valid would silently break
the join with the attentions citing it. The union writes that case down so
callers have to handle it.

Entity ids (`Project.id`, `Artifact.id`, …) are **not** branded. Doing it would
touch every fixture in the suite for a confusion the factories already prevent,
and the four portfolio keys are resolved in one place (`services/portfolioGraph`)
rather than passed around. Revisit it if a second resolver ever appears.

---

## Authentication & Roles

Supabase Auth, proveedor único (ADR-004). Dos métodos de entrada: **correo con
contraseña** y **Google**.

Dos métodos no son dos proveedores de identidad, y la distinción es la que
sostiene todo lo demás: Google viaja *por* Supabase, así que las dos rutas
terminan en el mismo `auth.users`, con el mismo `uid`, sobre el mismo perfil de
`api.user_profiles`. Sigue habiendo un solo sitio donde una cuenta existe o no
existe, y una sola matriz de permisos.

`signInWithGoogle` (`services/identity/authService.ts`) manda `prompt=select_account`
siempre. Sin eso Google reutiliza en silencio la sesión que el navegador ya
tenga, que es exactamente lo contrario de lo que necesita quien tiene una cuenta
personal y otra de la organización. El retorno cae en `/auth` y lo recoge
`detectSessionInUrl`; **no hay ruta de callback propia** porque no hace falta:
el observador de sesión es el mismo que restaura una sesión al abrir la
aplicación, y una segunda copia de esa decisión es una que se queda vieja.

**El retorno lo decide el origen, no el proyecto.** `lib/authReturnUrl.ts` es la
única definición de a dónde vuelve alguien tras pasar por un proveedor, y las
tres puertas la usan: Google, la invitación de `provision-user` y la
recuperación de contraseña. La tercera no la usaba, y el modo de fallo es el que
no se ve venir: sin `redirectTo`, Supabase construye el enlace del correo con la
*Site URL* del proyecto. Con un despliegue anterior todavía vivo sobre la misma
base de datos, quien pidió recuperar su contraseña desde la aplicación nueva
recibió un correo que lo devolvió a la **vieja** — la sesión se abrió, pero esa
versión no tenía pantalla de «nueva contraseña», ni «Seguridad», ni «Cerrar
sesión», así que el síntoma se leyó como tres funciones que faltaban. Un enlace
de retorno mal dirigido no falla: te atiende otra aplicación.

**Entrar con Google no crea una cuenta.** Quien complete el flujo sin perfil en
`api.user_profiles` es devuelto a `/auth` con la explicación de siempre. Que la
puerta sea más cómoda no la abre a más gente.

Habilitarlo en un despliegue son dos cosas fuera del repositorio, y ninguna es
código: el proveedor Google en *Authentication → Providers* (con el client id y
el secreto de un proyecto de Google Cloud) y la URL del despliegue en
*Authentication → URL Configuration → Redirect URLs*. Sin lo primero el botón
devuelve un error del proveedor, que es lo que la pantalla muestra; sin lo
segundo el retorno cae en el sitio equivocado.

**Nobody creates their own account.** There is no registration form: `/auth` is
sign-in and password recovery, and an identity that authenticates without a
provisioned `users/{uid}` profile is signed straight back out. Accounts are
created by an administrator through `services/identity`, which
reparte la operación en dos: la Edge Function `provision-user` **invita** —es lo
único que necesita la clave de servicio— y el navegador, con la sesión del
administrador, llama a `api.provision_user_profile` para escribir el perfil y el
rol. Esa segunda mitad es donde viven el permiso `users:create`, la regla de que
sólo un superadmin concede roles privilegiados, y la entrada de auditoría con el
actor real; duplicarlas dentro de la función habría dejado dos copias, y la que
se queda vieja siempre es la que concede de más. No hay contraseña que elegir:
la invitación lleva un enlace para que la persona fije la suya.

### The six roles

`lib/authz/permissions.ts` is **the** definition: a permission catalogue, the
role list, and one matrix binding them. Screens ask `can(profile, permission)`
and never learn that a role called `admin` exists.

| Role | What it is for |
|---|---|
| `viewer` | Reads the portfolio, consumes training. Writes nothing |
| `architect` | The working role: initiatives, attentions, deliverables, artifacts |
| `reviewer` | Architect, plus approving charters, deciding at the ARB and publishing |
| `trainer` | Authors the Training Center and reads its analytics |
| `admin` | Everything above, plus managing users — but not granting privilege |
| `superadmin` | Everything, including granting `admin` and `superadmin` |

`student` and `teacher` are legacy names, migrated **on read** by
`parseAuthRole` (to `architect` and `trainer`) and refused on write. `admin`
cannot grant a privileged role, and cannot demote a `superadmin` — otherwise
the first rule is bypassed by removing the people who hold it.

### One rule for resolving the role

**El rol sale de una fila, y la lee el mismo motor que aplica las políticas.**
`private.current_role()` devuelve el rol del perfil **activo** del usuario del
JWT, y `NULL` si no hay perfil o está deshabilitado: falla cerrado. La interfaz
lee lo mismo por `api.load_own_profile`.

Esto cierra el defecto D-4 por construcción, no por coincidencia. Allí había dos
fuentes —las reglas leían un *custom claim* que nada ponía, la interfaz leía un
documento— y 32 cláusulas quedaban permanentemente falsas porque nadie las
comparaba. Ya no hay dos fuentes que comparar: la política y la pantalla leen la
misma fila.

### The rules are the boundary, and they are tested

`lib/authz` runs in a browser the caller controls; it decides what to *show*.
**PostgreSQL decide lo que se *permite*** —RLS, privilegios revocados y la guarda
de permiso de cada RPC— e implementa la misma matriz, sembrada como datos en
`private.role_permissions`. `__tests__/authz/sqlMatrixParity.test.ts` compara
las dos celda por celda.

Las políticas se ejercitan de verdad con los contratos pgTAP
(`supabase/tests/database/`), que corren contra una base real en
`.github/workflows/supabase.yml`. Localmente:
`bash scripts/supabase/local.sh test` (necesita Docker). **Ejecútalos antes de
cambiar una RPC**: leer el SQL es exactamente lo que no detectó D-4.

Do not add a role-string comparison anywhere;
`__tests__/authz/noRoleStrings.test.ts` scans for them. Read
`docs/security-hardening.md` before changing anything auth-related. Seeding the
first administrator cannot come from the app once self-service creation is gone:
`docs/primer-administrador.md` is the click-by-click guide written for the
non-technical person who installs the product, and §3.2.1 of the hardening doc
carries the Admin SDK variant.

The dev-login bypass (`VITE_ENABLE_DEV_LOGIN`) is hard-disabled in production
builds and its `superadmin` role exists only in React state.

## Routing

`App.tsx` defines every route. All route components are loaded through `lib/lazyWithRetry.ts`, which retries a failed chunk fetch instead of stranding the user on a blank screen (an actual iPad/Safari failure mode after deploys).

```
/auth                   → AuthPage
/                       → DashboardPage           (protected — the landing page)
/projects               → ProjectsPage            (protected)
/office                 → OfficePage              (protected)
/office/:engagementId   → EngagementRoom          (protected)
/initiatives            → InitiativesPage         (protected)
/initiatives/:initiativeId → InitiativeRoom       (protected)
/workspace/:projectId   → Workspace               (protected)
/sdd-process/:projectId → SDDProcessView          (protected)
/agents                 → AgentsPage              (protected)
/settings               → SettingsPage            (protected)
/training               → TrainingCenterPage      (protected)
/users                  → UserManagementPage      (protected)
*                       → NotFoundPage            (protected)
```

`ProtectedRoute` redirects to `/auth` when there is no user. LMS screens (`pages/LMS/*`) are **not** separate routes — `TrainingCenterPage` switches between them internally. The persistent shell (`AppRail` on desktop, `MobileBottomNav` below `md`, skip-link, `PersistenceStatusBanner`, `CommandPalette`, `KeyboardShortcutsModal`, `RuntimeErrorOverlay`, `GlobalObservabilityCenter`) lives around the `<Routes>` element.

### Navigation lives in the rail, and only in the rail

`components/AppRail.tsx` carries the product's whole navigation, in this fixed
order: **Dashboard · Iniciativas · Proyectos · Entregables · Agentes ·
Formación · Ajustes · Seguridad** (the last one admin-only) — short labels on the buttons,
long names in the tooltip and the accessible name. Its foot carries **Ayuda**
—the platform guide, which opens a dock rather than navigating— and then the
three utilities that act on the app rather than navigating it: global search,
the theme toggle and the keyboard-shortcut sheet. Ayuda keeps a visible label
like the destinations, because the person it serves is the one who does not yet
know what the product does; `MobileBottomNav` carries the same guide inside its
"Más" sheet, never as a second help.

Agentes, Formación, Configuración and Seguridad appear **here and nowhere
else** — no working screen links to them. Agentes is a system screen for the
same reason the other three are: it configures the cast that answers *every*
request, so it belongs to the application rather than to one level of the
hierarchy. `MobileBottomNav` is the same rail in a
thumb-reachable form, not a second menu: the four working screens plus search
sit in the bar and those three system screens live in its "Más" sheet.

The old `HomePage` was deleted rather than kept alongside `DashboardPage`: it
duplicated the creation entry points that already live in `ProjectsPage` and was
the only screen still linking to `/users` and `/settings`.

---

## Styling Conventions

- **Tailwind CSS is the only styling mechanism.** No CSS modules, no styled-components.
- Tailwind is compiled at **build time** (`postcss.config.cjs` → `tailwind.config.cjs` → `src/index.css`, imported from `index.tsx`). The old runtime CDN was removed; **do not reintroduce a CDN `<script>` or stylesheet in `index.html`** — the E2E smoke test fails when the sandbox blocks external hosts. ReactFlow's package stylesheet is imported by the lazy diagram-view chunk so its CSS version matches the runtime without taxing application startup.
- Theme changes go in **`tailwind.config.cjs`** (`theme.extend.colors.primary` / `.gray`, fonts, shadows, font sizes) — not in `index.html`.
- Dark mode is `darkMode: 'class'`; the current theme is stored in settings and applied by `hooks/useTheme.ts`.
- Animations use `motion/react`. A few keyframes (`fade-in`, `slide-up`) are defined in `index.html`.
- Only use inline styles for genuinely dynamic values (computed widths, transforms, diagram coordinates).
- The single global stylesheet is `src/index.css` and it contains nothing but the three `@tailwind` directives — **do not add rules there.**

---

## TypeScript Conventions

- **`strict: true` is on for a growing boundary, not yet repository-wide.** `tsconfig.json` keeps the incremental flags (`noImplicitThis`, `noFallthroughCasesInSwitch`, `alwaysStrict`, `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`) for everything; **`tsconfig.strict.json` applies full `strict` plus `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`/`noImplicitOverride` to an allowlist of modules**, checked by `npm run typecheck:strict` in CI. The list only grows — `__tests__/lib/strictBoundary.test.ts` fails if an entry leaves. **Put new modules inside it**, and add an existing one when you make it hold.

  Two things about enrolling a module, learned the expensive way in Wave 4.
  **`tsc` checks the whole transitive closure**, so a module joins only if
  everything it can reach holds too — which is why the entries are the *rules*
  (`architectureProjectFactory`, `reviewTransitions`, `initiativeMetrics`) and,
  until Ola 2, not their persistence repositories: every repository delegated to
  the persistence monolith, which had 57 errors under `strict`. **One file
  kept the seven storing contexts out.** Deleting it let `services/persistence`,
  `services/settings` and the project mappers in, and the two findings it
  surfaced were real: the database handle was nullable and every repository read
  assumed otherwise, and `Project['artifactIndex'][number]` indexed an optional
  array. The chat and agent repositories are still out for
  the older reason, one step removed: they reach the `services/ai` barrel, and
  a barrel is the whole module. **And ambient declarations must be listed
  explicitly** — `env.d.ts` and `types/dagre.d.ts` are entries because otherwise
  `import.meta.env` is unknown and `dagre` (which ships no types) reads as an
  implicit `any` against our code.
- **`@types/react` and `@types/react-dom` are installed.** They were not, which meant every JSX element, hook and prop in a React 18 app was silently `any`; `components/ErrorBoundary.tsx` even carried a hand-rolled `Component` cast with a comment explaining the absence. Installing them surfaced 34 errors, several of them live defects. Do not remove them.
- **Avoid `any`.** ESLint's `no-explicit-any` is `off` globally only because the legacy monolith would produce thousands of violations; it is `error` for `lib/security.ts` and `lib/ids.ts`, and new modules should be written to that bar. Prefer precise types or `unknown` + type guards. `npm run check:any-budget` holds the repository to **23**, and what remains is named: 16 in `services/geminiService.ts`, 6 in the untyped Excalidraw boundary, and React's own `ComponentType<any>` in `lazyWithRetry`.
- **A generator's output is a shape, not `any`.** When a prompt prints the JSON it asks for, that shape is knowable: `services/ai/generation/learning/learningTypes.ts` is the worked example. It declares what the model *proposes* (`GeneratedCourse`, `GeneratedTopic`) separately from what the domain *records* (`Course`), because a proposal carries no ids and its `level` is whatever string came back — and it ships the two coercions (`asCourseCategory`, `asCourseLevel`) and the two guards (`isQuizQuestion`, `isRelatedConcept`) that bridge them. Typing those three LMS functions surfaced two live defects where a model's free text was written straight into a union.
- Path alias `@/` resolves to the repo root. Both `@/`-prefixed and relative imports exist in the codebase — match the file you are editing.
- Core domain types live in `types.ts`; LMS types in `types/lms.ts`; subsystem-local types next to their module (`agentTypes.ts`, `ArtifactCompilerTypes.ts`, `contextGraphTypes.ts`, …). Do not declare domain types inline in components.
- Enums are avoided in favour of string unions and `as const` objects.
- `interface` for object shapes; `type` for unions and aliases.
- Barrel files (`index.ts`) are the public surface of a subsystem — import from `services/artifacts`, `services/ai`, `hooks/artifacts`, `components/ui` rather than reaching into individual modules.

---

## Component Conventions

- **Functional components only.**
- One component per file; file name matches the exported component (PascalCase).
- Props interfaces are declared directly above the component, named `<ComponentName>Props`.
- Side effects in `useEffect`; never do async work at module top level.
- Custom hooks live in `hooks/` (or a subsystem's `hooks/` folder) and start with `use`.
- Extract logic into a hook before a component crosses ~400 lines — `ArtifactCanvas.tsx` and `hooks/artifacts/` are the reference pattern.
- Use `components/ui/` primitives (`Button`, `Card`, `Badge`, `Tabs`, `Drawer`, `Dropdown`, `Alert`, `Spinner`, `Tooltip`, `EmptyState`, `SectionHeader`, `StatusDot`, `PageSkeleton`, `ResizeHandle`, `cn`) instead of re-styling raw elements.
- **Reach for a token before writing a class.** `lib/designTokens.ts` holds the
  named steps of motion, elevation, radius, type and surface. A panel is
  `ELEVATION.floating` and a section title is `TYPE.sectionTitle`, because the
  alternative is what the repository had: five shadow scales and two title
  weights across panels of the same kind, and a reader who cannot tell which of
  two panels matters more. Colour deliberately stays in `tailwind.config.cjs` —
  Tailwind's scanner is what compiles it, and a second palette in TypeScript is
  a palette nobody compiles.
- **A known layout loads as a skeleton, not a spinner.** `PageSkeleton` takes the
  shape (`hero`, `tiles`, `panels`) and announces one `role="status"` line. A
  skeleton that does not match what arrives is worse than a spinner: it promises
  a layout and delivers another.
- Accessibility is enforced in review: keep the skip link, `useFocusTrap` in modals, `useAriaAnnouncer` for live regions, `useReducedMotion` for animation opt-out, and real `role`/`aria-*` attributes.
- **Nothing may be announced twice.** `lib/a11y.ts` documents the five rules and
  the reasoning behind each; `__tests__/a11y/duplicateAnnouncement.test.ts`
  scans every `.tsx` under `components/` and `pages/` and fails the build if the
  pattern returns. The one that caused real damage: **`title` is not an
  accessibility affordance** — on an element that already has a name it becomes
  the *description*, so `<h1 title={name}>{name}</h1>` and a button carrying
  both `aria-label="X"` and `title="X"` are each read twice by VoiceOver. CSS
  truncation does not remove text from the DOM, so a `title` that restates
  truncated content buys nothing for assistive technology. Use
  `components/ui/Tooltip` (built to stay silent) when the hover affordance
  matters, and keep `title` only when it says something genuinely different.
- `components/Icons.tsx` (~375 lines) is the curated Heroicons set — **append only, never rewrite**. Lucide React is available for one-off icons.
- Wrap risky render surfaces in an error boundary (`ErrorBoundary`, `CanvasErrorBoundaries`, `ViewerCrashFallback`) — a crashed viewer must never blank the app.

---

## Testing Conventions

- **Vitest** (`globals: false` → import `describe`/`it`/`expect` explicitly).
  Global `testTimeout` is 20s because Mermaid rasterisation is slow under jsdom.
- **Two projects, and which one a test lands in is decided by its extension.**
  Building a jsdom environment cost 212,9 s across workers against 50,6 s of
  actual test execution, because `environment: 'jsdom'` applied to all 371
  files while ~270 of them never touch a DOM. So:
  - A test that **renders** is a **`.test.tsx`** file. It runs in the `dom`
    project: jsdom, `vitest.setup.dom.ts`, jest-dom matchers and Testing
    Library's `cleanup()`.
  - A test that **does not render** is a **`.test.ts`** file and runs in the
    `node` project. If it still needs a DOM (`localStorage`, DOMPurify, a
    `Blob`), it says so in its own header with `// @vitest-environment jsdom` —
    26 files do. `vitest.setup.node.ts` then loads the jest-dom matchers, and
    only then.
  Do not put the whole suite back on jsdom to make one file work: give that
  file the docblock.
- Two placement patterns coexist: the mirror tree under **`__tests__/<subsystem>/`** (dominant — diagram, services, components, lib, quality, publicationPipeline, …) and colocated **`<module>/__tests__/`** (`services/agent`, `services/chat`, `utils`). Follow whichever the target module already uses; default to the mirror tree.
- Mock external SDKs. Lo que se dobla es la **puerta**, no cada repositorio:
  `vi.mock('../../services/adapters')` devolviendo un `rpc` falso deja bajo
  prueba la traducción de `{ data, error }` a `PersistenceResult`, que es donde
  viven los defectos. **Never call a real Supabase project, Gemini, OpenRouter or
  Lucid from a test.**
- Playwright specs live in `e2e/` and are excluded from the Vitest run by
  `vite.config.ts`. They run against **`dist/` served by `vite preview`**, on
  desktop Chromium and iPad Safari viewports — so `npm run e2e` needs a build
  first. They used to run against `npm run dev`, which meant the one gate whose
  job is to check the deployed artefact was checking a dev transform instead.
  `PLAYWRIGHT_DEV_SERVER=1` restores the old behaviour for a fast inner loop.
- Run `npm run quality` before proposing a change; report the real output. It
  now composes exactly what CI's `quality` job composes, so green locally means
  green in CI — it did not before, and a coverage or bundle regression only
  surfaced after eleven minutes of waiting.

---

## Known Issues / Incomplete Areas

- `components/ReviewArchitectureModal.tsx` is still an **empty placeholder (0 lines)** — do not import or reference it. The working review UI is `components/artifacts/ReviewPanel.tsx`.
- `services/geminiService.ts` (~5,500 lines) is still the largest single module, but it is no longer a public dependency: nothing outside `services/ai/` imports it, and it loads lazily. Splitting it is now ordinary internal maintenance rather than a cross-cutting change.
- Supabase Auth is behind `services/identity`; `context/AuthContext.tsx` imports no SDK, and `no-restricted-imports` plus `__tests__/authz/noSdkInUiLayers.test.ts` keep every SDK out of `components/`, `pages/`, `context/` and `hooks/`. La prueba conserva Firebase en su lista de prohibidos como sonda de regresión: una que sólo busca el SDK actual no impide que vuelva el anterior.
- `@google/genai` still appears in `services/geminiService.ts` as well as `providers/gemini/` and `api/`. The client factory *has* moved: it is `services/ai/providers/gemini/geminiClient.ts` now.

  **Moving the engine into `services/ai/` was tried in Ola 5 and reverted, and
  the reason is worth keeping.** Relocating the file does not remove its
  dependencies: the engine reaches *up* into eight domain contexts to build its
  prompts, and four of them (`agent`, `chat`, `artifacts`,
  `architectureOffice`) import `services/ai` back. So the move turned one
  recorded cycle — `services (raíz) <-> services/ai`, where `services (raíz)`
  is by definition the files that belong to no module — into **four cycles
  between real domain contexts**, which is exactly what Olas 1–2 spent their
  effort removing and what `moduleBoundaries.test.ts` asserts by name.

  The engine's home is not a move; it is the strangler migration continuing
  vertical by vertical, cutting each upward dependency first. `learningService`
  is the worked example of one vertical done. Until then it stays at the root,
  where its cycles are attributed to the pseudo-module that exists to hold
  exactly this.
- `README.md` still carries the original AI Studio banner/intro above the accurate sections.
- There is no Prettier config — formatting follows the surrounding file.

---

## Common Workflows for AI Assistants

### Adding a new Artifact Type

1. Add the type string to the `ArtifactType` union in `types.ts`.
2. Add a template entry in `constants.ts` (`ARTIFACT_TEMPLATES`) and map it to an `ArchitecturalView`.
3. Add the generation prompt/method behind a `services/ai/generation/` façade, and describe any structured output with `defineSchema` from `services/ai/schema`.
4. Register a contract in `services/artifactCompiler/profiles/contractDefinitions.ts` if the artifact is validated/scored.
5. Handle the type in the `switch`/map sites: `services/artifacts/artifactGenerationPipeline.ts`, `services/artifacts/viewController.ts`, `components/ArtifactCanvas.tsx`, `components/ProjectHub.tsx`.
6. Add tests under `__tests__/`.

The project skill `/add-artifact-type` automates this flow.

### Adding a new Page

1. Create the component in `pages/`.
2. Register it in `App.tsx` via `lazyWithRetry` and add a `<Route>` inside `ProtectedRoute`.
3. Add navigation in `AppRail.tsx` / `MobileBottomNav.tsx` and, if useful, a command in `GlobalCommands`.
4. If it needs global state, extend the right context or add a new one — do not widen `AppContext` reflexively. A new concern inside it is a hook under `context/app/`, never a callback in `AppContext.tsx`.

### Adding a new LMS Course

Go through `services/learning` (`courses` collection). Validate `Lesson[]` against `types/lms.ts` first. Progress → `users/{uid}/lms_progress`, notes → `users/{uid}/lms_notes`, learning context → `users/{uid}/lms_context`; never cross-write. Only `teacher`/`admin`/`superadmin` may author courses.

### Modifying AI Prompts

Diagram prompts: `services/ai/prompts/diagramPrompts.ts` (keep the 10-dimension rubric intact). Everything else: the relevant method inside `services/geminiService.ts`, reached through its domain façade. Prompts never live in components. Preserve the output contract the renderer expects (valid Mermaid, valid ReactFlow JSON, or Markdown), and prefer `services/ai/structuredOutput/` when the response is JSON.

### Charts with nothing to plot

A donut whose total is zero draws an empty ring, a "0" and a legend of zeros; a
ranked-bar set with every value at zero draws empty tracks; a trend with no
signal draws a line pinned to the baseline. Each is a *chart of nothing*: it
takes the space and authority of a figure while carrying no information, and it
reads as a rendering fault rather than as an accurate report of an empty
portfolio. `DonutChart`, `FlowBars` and `TrendArea` therefore take an
`emptyMessage` and render `ChartEmptyState` instead. The message is a prop
because only the caller knows what would fill the chart — the chart sees
numbers, not a domain. It is opt-in: a chart given no message still draws, so
nothing disappears silently.

`StatTile` tints only `warning` and `danger`. If every tile were tinted none
would stand out and the row would read as five equal numbers; a finding has to
be distinguishable from a count at a glance.

### Changing Theme / Colours

Edit `tailwind.config.cjs` (`theme.extend`). Diagram-specific colours are tokens in `lib/diagramTokens.ts` / `lib/diagramThemes.ts`, not Tailwind classes — check `lib/colorContrast.ts` when changing them, because the accessibility gate asserts contrast ratios.

### Adding a field or a table

Escribe la migración en `supabase/migrations/` —tabla, RLS, privilegios
revocados y la RPC que la atiende—, su contrato pgTAP con el caso negativo, el
tipo en `types.ts` y el repositorio, **en el mismo cambio**. Después comprueba el
manejo en `services/persistence` y cualquier migración de forma en
`ArchitectureGraphMigrations.ts` / `irMigration.ts` si el dato está versionado.

Una tabla nueva sin `revoke` es una tabla que la Data API expone: el gate que lo
detecta es `supabase db advisors`, y corre en `supabase.yml`.

---

## A project is tracked, and its initiative knows what it moves

The top level always carried its own instrumentation — objectives, outcomes,
KPIs, milestones, risks — and the middle one carried almost none: a project
either existed or it did not, and the only signal of progress was how many
artifacts it happened to contain. That is enough to work in and not enough to
report on, and it left the hierarchy unable to answer the question the level
above exists for: *what does this project change for my business need?*

`ProjectAttentionTracking` (`services/architectureProjects`) now carries
`progress`, `milestones`, `risks` and `contributions`, all optional and
additive — a project saved before them still loads and reads as *sin
seguimiento*, never as a project at 0 %.

**The contribution is the edge that was missing.** `AttentionContribution` says
what this project moves in one initiative, and points at that initiative's
`expectedOutcomes` and `kpis` **by id**, never by copied text — the rule the
whole portfolio already lives by, and for the same reason: a copied statement
survives the outcome being rewritten and starts lying quietly. A reference that
no longer resolves is *reported*, never dropped.

Four rules the derivations hold to, all of them about honesty:

- **Undeclared is not zero.** `attentionProgress` returns `null` when nobody has
  declared progress and there are no milestones to infer it from. A 0 % painted
  over an unmeasured project reports a team that has done nothing.
- **Derived is distinguishable from declared.** When progress comes from the
  milestones met, `source` says so, so a screen cannot present an estimate with
  the authority of a figure.
- **The traffic light is computed, never chosen.** `attentionHealth` reads the
  missed milestones, the severe risks and the target date. A health field that
  is typed into a dropdown is an opinion shaped like a measurement, and it is
  always green.
- **Weights are declared or shared evenly, and the rollup says which.** An
  invented weight looks like a distribution somebody thought about.

**The two contexts do not import each other.** `services/businessInitiatives/initiativeDelivery.ts`
declares the *port* — what it needs to know about a contributing project — and
`services/architectureProjects/attentionTracking.ts` supplies one with
`describeAttentionDelivery`. It is the pattern `services/agent` already uses to
avoid knowing that the Office exists. The two halves meet in
`hooks/useInitiativeDelivery`, which is also where `portfolioGraph` decides
*which* projects serve the initiative — ids first, codes only as migration, the
one resolution rule in the product. A hook, not a screen: that is what keeps
`InitiativeRoom` at two service modules, and it is where the compiler checks
that the port and its supplier still fit.

What the rollup reports is chosen to be actionable rather than flattering:
weighted progress over the projects that actually declare it, how many are
measured at all, how many are off track, the severe risks the initiative
inherits, the blocked contributions — and, the most useful of them, **the
expected outcomes and KPIs no project claims to serve**. That last one is work
the business is waiting for that nobody has started.

The UI is three panels composed by `AttentionDetailsPanel`, so the screen that
hosts it did not change: *what it is* (the existing file), *how it is going*
(`AttentionTrackingPanel`) and *what it moves* (`AttentionContributionPanel`).
`InitiativeDeliveryPanel` renders the other end in the initiative's room.

## El tablero es un centro de mando, y su cifra viene con su composición

La pantalla con la que abre el producto tenía cuatro contadores y dejaba la
síntesis al lector: nada en ella respondía «¿en qué estado está todo?». Esa
respuesta es una **regla de dominio** —qué cuenta como deteriorado, dónde cortan
las franjas, qué baja la cifra— y no existía en ninguna parte.

`services/architectureOffice/application/portfolioCommandCenter.ts` la escribe, y
sostiene las mismas cuatro reglas de honestidad que el resto del producto:

- **Sin medir no es cero.** Un portafolio vacío devuelve `health: null`. Un 0 %
  pintado sobre una organización que aún no ha registrado nada informa de un
  equipo que ha fracasado.
- **La franja se calcula, nunca se elige.** No hay ningún campo donde alguien
  escriba «vamos bien».
- **La cifra viene con su composición.** `drags` enumera qué la bajó y cuánto, y
  la cabecera lo pinta **al lado del número**, no en un tooltip: un indicador de
  salud sin desglose es una opinión con forma de medición, y éste además cruza
  tres niveles.
- **Lo roto se informa, nunca se descarta.** Los vínculos que no resuelven son
  una señal propia.

Dos cosas más que conviene no deshacer:

- **La población son los tres niveles gobernados**, no los artefactos. Contar
  artefactos haría que publicar mucho tapara un portafolio bloqueado.
- **Alcanza el nivel de iniciativas por un puerto** (`InitiativeSignalPort`), el
  patrón que ya usan `initiativeDelivery` y `AgentPersonaBriefing`. Ninguno de
  los dos contextos importa al otro.

`hooks/usePortfolioCommandCenter` lo compone con el grafo del portafolio y el
retrato de la Oficina, y por eso **`pages/DashboardPage.tsx` salió de la tabla de
fan-out**: alcanzaba tres módulos de servicio y ahora alcanza uno. Un fichero
bajo `pages/` que importa tres servicios *es* la capa de aplicación de esa
pantalla, escrita en un sitio cuyo trabajo es pintar.

Los KPI del tablero miden **flujo**, no existencias: los recuentos de cada nivel
ya están en la cabecera, y repetirlos abajo sería una fila de tarjetas sin
pregunta propia. `windowedDelta` compara dos ventanas del **mismo** ancho y
devuelve `null` cuando no hay una ventana anterior completa — un `previous: 0`
diría que la semana pasada no se hizo nada, que es un hecho distinto de no
saberlo.

## El raíl se explica sin dejar de ser compacto

El raíl estrecho es correcto para quien ya sabe dónde está cada cosa, y es
exactamente inútil el primer día. Hay dos estados y ninguno reemplaza al otro:
en reposo mide 72 px con el registro corto bajo cada glifo; al pasar el cursor
—o **al entrar el foco de teclado**— se despliega a 264 px con el nombre largo,
la frase que dice para qué sirve el destino y los rótulos que separan el trabajo
del sistema. `hooks/useRailExpansion` recuerda el pestillo por dispositivo.

Cuatro reglas que no conviene tocar:

- **El nombre accesible es el largo en los dos estados**, y todo el texto visible
  es `aria-hidden`. Abrir el raíl cambia lo que se ve y nunca lo que se anuncia:
  un botón que se llama de dos formas según dónde esté el ratón es uno que un
  lector de pantalla no puede seguir.
- **Sólo el foco de teclado lo mantiene abierto** (`hooks/useKeyboardModality`).
  Un clic con el ratón también da foco, así que con un `onFocus` a secas cambiar
  el tema dejaba el raíl desplegado sobre la página hasta pinchar en otro sitio.
  Es la misma heurística que `:focus-visible`, escrita a mano porque jsdom
  implementa ese selector devolviendo siempre `false`: apoyarse en él deja sin
  ninguna prueba la rama que sirve a quien más depende de ella.
- **La ayuda conserva etiqueta visible en los dos estados**, a diferencia de las
  utilidades del pie. Sirve justo a quien no sabe todavía qué hace el producto.
- **`RAIL_ITEMS` es el único sitio donde vive la arquitectura de información.**
  `components/navigation/appRailItems.tsx` lo declara y lo leen las dos
  superficies; `MobileBottomNav` tenía su propia copia —mismos iconos, mismas
  rutas, mismos emparejadores— y una copia sólo permanece igual mientras alguien
  se acuerda de las dos. El reparto entre la barra y la hoja «Más» sale del
  `group` que cada destino ya declara.

## El móvil no es el escritorio con menos píxeles

Dos defectos que sólo se vieron al abrir la aplicación en un teléfono, y ninguno
de los dos era un problema de tamaños:

- **Todas las páginas reservaban el canal del raíl en el móvil.** El patrón era
  `pl-16 pr-4 … md:pl-20 md:pr-8`, y `pl-16` aplica desde el primer píxel — pero
  el raíl es `hidden md:flex` y debajo de `md` la navegación está abajo, no a la
  izquierda. Eran 64 px de margen muerto en una pantalla de 390: el 16 % del
  ancho, gastado en un elemento que no está. Ahora es `px-4 … md:pl-20 md:pr-8`
  en las diez pantallas: **el canal se reserva donde vive el raíl y en ningún
  otro sitio.**
- **La cadena de cuatro niveles se salía de su tarjeta.** Cuatro eslabones de
  96 px mínimos no caben en 390, así que el tercero quedaba cortado por el borde.
  Es una rejilla de dos columnas hasta `sm` y una fila a partir de ahí; las
  flechas son `hidden sm:block`, así que en la rejilla no ocupan celda.

La regla que dejan: **una utilidad `md:`-condicionada necesita su contrapartida
base explícita.** `pl-16 md:pl-20` no es «64 px, y 80 en escritorio»; es «64 px
siempre, y 80 en escritorio», que es justo lo que nadie quiso escribir.

## El tema tiene un dueño, y `localStorage` es su espejo

Había dos dueños y nunca coincidían. `useSettingsState` escribía la clase `dark`
del `<html>` desde `settings.theme` —la preferencia del usuario, en la base— y
`useTheme` la escribía desde `localStorage['arky_theme']`, con su propio concepto
de `'system'`. Con una cuenta recién creada —ajustes en `dark`, `localStorage`
vacío— la aplicación se pintaba oscura, el botón del raíl ofrecía «Modo oscuro»,
y pulsarlo guardaba lo que ya estaba en pantalla: **un interruptor de tema que no
cambiaba el tema**.

La fuente ahora es `settings.theme`, y sólo `useSettingsState` toca la clase.
`localStorage['arky_theme']` sigue existiendo con un único trabajo: el script de
arranque de `index.html` lo lee antes de que React exista, para no pintar un
destello claro antes del primer render. Es un espejo derivado —como los códigos
`NEG-YYYY-NNN` del portafolio— que se lee cuando aún no hay nada mejor y nunca
decide. `useTheme` lo escribe también en el momento del cambio, para que el
próximo arranque acierte aunque la escritura remota falle: verse bien y no haber
sincronizado es mejor degradación que un destello blanco.

## Arrastrar nunca puede ser el único camino

`hooks/useResizablePanel` + `components/ui/ResizeHandle` dan ancho ajustable al
copiloto del Workspace, y lo dan **por dos caminos**: arrastre y teclado
(flechas, `Shift` para el paso grueso, `Home`/`End` a los extremos). WCAG 2.2
añadió el criterio 2.5.7 (*Dragging Movements*) exactamente por esto: una función
que sólo se consigue arrastrando deja fuera a quien usa teclado, conmutador o
control por voz. El asa es un `role="separator"` con `aria-valuenow`, y su
objetivo de puntero mide 12 px detrás de una línea de 1.

Mientras se arrastra, el panel apaga su transición: un ancho interpolado va
siempre un fotograma por detrás del cursor, y esa desincronización se lee como
lentitud del sistema.

## Assisted capture — one agent, next to every field

A form assistant and the Office's team are **two different patterns**, and the
product uses each where it belongs. Completing "¿qué necesita el negocio?" is a
single-domain question with one acceptance criterion; running it through a
coordinator, four specialists and a consolidator would cost five model calls and
several seconds to produce a sentence. Anthropic's guidance on building agents
puts this first — use the simplest pattern that solves the task — and
`docs/agentes-anthropic-alineacion.md` records the mapping principle by
principle.

So there are three entry points and they never merge:

| | Assisted capture | The platform guide | The Office |
|---|---|---|---|
| Answers | one field, or the fields still empty in a form | how the product works | an architecture question |
| Pattern | **one agent, one call**, no orchestration | **one agent, one call**, grounded in a written catalogue | orchestrator-workers + a bounded evaluator |
| Who | Arky, the generalist, **as configured on its card** | Arky, the generalist, **as configured on its card** | coordinator, specialists, consolidator |
| Reached from | the ✨ button beside every field, and the form bar | the rail's *Ayuda* button, anywhere | `AssistantLauncher` / `AssistantDock`, from a record |

**The pieces, and why each lives where it does:**

- `lib/capture/` — the field catalogue and the contract. Foundation layer: a
  declaration with no behaviour belongs in a leaf, and three modules need it.
  Each field carries its shape, its guidance and **the rules of the discipline**
  («un objetivo dice QUÉ, nunca CÓMO»; «un indicador sin unidad no sirve»),
  which travel verbatim into the prompt. This is the agent-computer interface
  Anthropic asks you to invest in, and it is why creation and maintenance ask
  for the same field in the same words.
- `services/architectureOffice/application/captureAssistance.ts` — **what** to
  ask: the record's context, its ancestry, and the briefing composed from the
  agent's configured profile plus the Office standards. Pure, so the policy is
  testable without rendering anything.
- `services/ai/generation/capture/` — **how** to ask a model, and how to
  distrust the answer: suggestions for fields nobody requested are dropped, a
  single-value field is held to one suggestion, and everything the model could
  not deduce comes back as `openQuestions`.
- `hooks/useLevelCapture.ts` — the three level-specific hooks (`useInitiativeCapture`,
  `useAttentionCapture`, `useDeliverableCapture`, plus the two `…RecordCapture`
  variants for maintenance screens). Screens enter here, which is what keeps
  their service fan-out at two.
- `components/capture/` — `FieldAssistButton`, `CaptureSuggestionCard`,
  `CaptureAssist` and `FormAssistBar`. Identical in all six forms on purpose:
  the user learns the button once.

**Four rules this capability holds to:**

1. **Nothing is written silently.** A suggestion is shown and applied by an
   explicit click, entry by entry in a list. A field the assistant filled in by
   itself is indistinguishable from a field somebody filled in badly.
2. **It refuses rather than invents.** `describeInsufficientContext` blocks the
   call when the record is empty — a model asked for objectives with nothing to
   go on produces objectives, and they are about nothing. That output is worse
   than none because it looks like work.
3. **Structured rows are drafted, not committed.** In the KPI, milestone, risk
   and stakeholder panels the suggestion fills the *add row*; the unit, the
   date and the level are put there by a person. The assistant drafts; whoever
   confirms is whoever signs.
4. **The record's own words are never rewritten.** An initiative's `need` and a
   deliverable's `brief` are what the business said. The initiative's need can
   be assisted *while being written*, in intake; once stored, it is the record
   — which is also why a deliverable has no maintenance assist: its brief is
   immutable by design, and a changed request is a new deliverable.

## The platform guide — the help that survives the model

`/agents` explains who answers; the rail's **Ayuda** button explains how the
product works. It is the third assistant pattern and it is one agent, one call,
for the same reason the capture assistant is: "¿cómo pido un entregable?" is a
single-domain question with one acceptance criterion, and routing it through a
coordinator, four specialists and a consolidator would spend several calls and
several seconds to produce the same sentence.

It lives in the rail rather than inside a screen because the question it serves
— *how does this work?* — does not depend on where you are standing. That is
exactly the opposite of the Office dock, which answers about a record and opens
from that record. The dock says so in its own empty state: for an architecture
question, go to the initiative, the project or the deliverable.

**The catalogue is the source; the model is the writer.** `lib/platformGuide`
holds written answers to the questions people actually ask, and
`findGuideTopics` picks the closest ones lexically. When the model answers, it
answers *over those topics* and is forbidden from inventing screens; when it
fails — no key, no network, a 503 — `composeGuideAnswer` renders the topics
themselves and the reply is **labelled as coming from the guide**. A help
assistant that only knows how to call a model stops existing exactly when
someone needs it, which is usually their first day; and a canned answer dressed
up as a written one is worse than a canned answer that says what it is.

The three halves, and why each sits where it does:

- `lib/platformGuide/` — foundation: the contract, the lexical search and the
  topic catalogue. **Hand-written product material, and that is a decision**:
  generating this from the code would produce a description of files, while what
  a newcomer needs is why there are four levels and in what order things are
  done. Its maintenance rule: *if a screen moves or is renamed, this file
  changes in the same commit* — a stale guide sends people to a button that no
  longer exists and makes them doubt everything else.
- `services/architectureOffice/application/platformGuidance.ts` — **what** the
  guide knows: the four levels from `lib/eaTerminology` and the **real agent
  roster**, read from the registry with the user's own overrides applied. A
  guide that said "there are thirteen agents" in a constant would lie the day
  the fourteenth is added, and would lie to precisely the user who came to ask.
- `services/ai/generation/platformGuide/` — **how** to ask a model and how to
  distrust it: the rules travel in every prompt, an empty answer counts as a
  failure, and nothing ever throws.

`hooks/usePlatformGuide` composes them and owns the degradation; the dock
(`components/platformGuide/PlatformGuideDock`) is one panel, not two — a
coordination panel with a single name on it would be theatre — and it is loaded
through `lazyWithRetry` from `App.tsx`, because the rail is in the tree from
boot and the AI layer must not be.

## The agents have a card

`pages/AgentsPage.tsx` (`/agents`) is the full cast, and the place an
organisation adapts it. It is reached from the rail and from the command
palette, and from nowhere else, for the reason every system screen is: it
configures the cast that answers *every* request, so it belongs to the
application rather than to one level of the hierarchy.

**Three levels of reading, and three is deliberate.** The **grid** answers who
there is; the **file** (`AgentProfileSheet`, a read-only drawer) answers who one
of them is — avatar, instruction, domains, capabilities, skills, organisation
knowledge, memory, standards, what it may produce and review, model tier,
concurrency, availability; and the **form** (`AgentProfileEditor`) changes it.
Consulting a specialist before handing them work is the frequent operation and
configuring them is the rare one, so a single always-editable form would turn
every consultation into a chance to change, by accident, the cast that serves
the whole organisation.

The file also **marks what came from where**: `inheritedProfileEntries` says how
much of each list the product ships, and the entries above that line are shown
as the organisation's own. A reader who cannot tell whether "the broker channel
runs on AS/400" ships with the product or was typed by a colleague last week
cannot judge the answer the agent signs with it — and the seam is known by
`resolveAgentProfile`, which concatenates in that order, so deriving it in a
screen would be a second definition of the same rule.

**Un agente es un contrato, y el registro es la única puerta.** Las trece
personas eran una descripción; lo que faltaba es la mitad que la hace
comprobable. `services/architectureOffice/agentDefinition.ts` la declara —
`version`, `scope: { goals, nonGoals }`, `modelTier` — y `agentRegistry.ts`
responde *toda* pregunta de «¿qué agente?»: `get`, `list`, `findByCapability`,
`findByDomain`, `findThatProduce`, `findThatReview`, `canTakeWorkstream`,
`canDelegate`, `validateDefinition`, `validate`.

Cada campo entra porque algo lo lee. `nonGoals` **viaja al prompt**: un
especialista al que sólo se le dice lo que hace contesta a lo que le pongan
delante, y una oficina de trece falla por uno contestando con seguridad fuera de
su dominio. `modelTier` es de lo que la ficha hace override, en vez del literal
`'default'` que compartían los trece. `version` se estampa en la ficha resuelta,
para que una personalización escrita contra un contrato viejo se pueda detectar.

**La topología de delegación se deriva de los roles**, no se lista por agente:
escribir `delegatesTo` trece veces es el mismo hecho dicho trece veces, y el
decimocuarto agente sería el que lo dijera mal. Nadie delega en sí mismo, y un
especialista no delega — eso es lo que mantiene la profundidad en uno.

`validateAgentRegistry()` encontró **dos incoherencias reales en su primera
ejecución**, y estaban en la regla: Alejandro `consolidate` y Tomás `report`
autoran sin declarar `generate`. El vocabulario tiene tres verbos de autoría.
Detalle y lo que deliberadamente **no** se construyó —tool policy, context
policy, memory policy con scopes— en `ADR-004`.

The split that makes all of this safe is in
`services/architectureOffice/officeAgentProfile.ts`:

| Configurable | Not configurable — this is governance |
|---|---|
| alias, avatar (emoji only), role, instruction | `orchestrationRole` (coordinator / consolidator / specialist) |
| extra skills, organisation knowledge, working memory | `producesArtifactTypes` / `reviewsArtifactTypes` |
| model **tier** (never a model id), concurrent tasks, availability | the standards the persona upholds |

A form that could make one agent produce *and* review the same artifact would
switch off the separation of duties with a dropdown — which is the reason an
architecture office exists rather than a generator.

Three properties worth keeping:

- **Overrides are additive and sparse.** Only what the user changed is stored,
  and the three lists are appended to the persona's own. Storing the defaults
  would freeze them: the next release that improves Elena's instruction would
  never reach anyone who had opened her card once. Teaching Sofía about this
  company's broker channel must not make her forget ACORD.
- **The card reaches every place the agent speaks.** `useCaptureAssistant` reads
  Arky's card, and `AssistantDock` passes `customizedAgentBriefings` and
  `disabledAgentIds` into `coordinateRequest`. A card that changed how an agent
  *looks* and not what it *says* would be decoration.
- **Per user, one document per agent.** `users/{uid}/agentProfiles/{agentId}`,
  through `OfficeAgentProfileRepository` over `services/persistence` — so a
  customisation survives a database outage in the local mirror instead of
  vanishing. An array would let two open tabs overwrite each other's agent.

## The assistant answers as a team

`coordinateRequest` (`services/architectureOffice/officeCoordination.ts`) is the
one entry point for an assistant request, at any of the three levels. Rules:

- **The team is the default, never opt-in.** A request always routes through the
  coordinator, the specialists its domains touch and the consolidator. The
  earlier design only did this when the user wrote "Lucía, coordina…", which
  meant the ordinary path was a single generalist — the opposite of the premise.
- **The coordination is emitted, never reconstructed.** Every hand-off produces
  a `CoordinationEvent` as it happens. `TeamCoordinationPanel` renders that
  stream. An animation that replays a plausible-looking sequence instead of the
  real one is a lie told with motion, and it would mislead precisely when
  something went wrong.
- **The scope travels with every prompt.** `CoordinationScope` carries the
  level, the record's briefing and its ancestry, so a specialist and the
  consolidator can never work from different pictures. A project asked about
  without its initiative loses the reason it exists.
- **An initiative is never modelled as a project to reach the model.**
  `officeCoordinationInvoker` builds an in-memory *context carrier* for the
  levels that have no project, marked by `COORDINATION_CARRIER_PREFIX` and never
  persisted.

`AssistantDock` is the shared surface (initiative, project, deliverable): chat on
one side, coordination on the other.

**Una sola tabla de enrutado, y la ficha del agente manda.** Había dos tablas
respondiendo la misma pregunta —`OfficeAgentRouter.DOMAIN_SIGNALS` y una copia
dentro de `officeOrchestration`— y habían divergido: el router aprendió que
«Health Cloud» es un producto de Salesforce y no puede llegar al arquitecto de
AWS; la copia no. La misma frase convocaba a un especialista distinto según
llegara como entregable o como petición de coordinación. Ahora hay una tabla, y
quién puede tomar un workstream se le pregunta al registro
(`orchestrationRole === 'participant'` y capacidad `consult`) en vez de a una
lista de tres nombres mantenida a mano.

**Y lo que la ficha configura, el motor lo lee.** `maxConcurrentTasks` y
`modelTier` se validaban, se guardaban y se resolvían, y el runner leía el valor
de fábrica mientras el invocador de coordinación no pedía tier ninguno: subir a
Elena a 3 o mover a Carmen a un nivel superior cambiaba un desplegable y nada
más. `services/architectureOffice/application/agentConfiguration.ts` las carga y
el runner las recibe inyectadas —sigue sin hacer E/S—, y un fallo al leerlas cae
en los valores de fábrica en vez de negarse a ejecutar.

**Un handoff es un contrato, y el inválido se rechaza antes de gastar nada.**
Los dos traspasos que ya ocurrían en cada petición coordinada —el coordinador
dando su workstream a cada especialista, y los resultados reunidos yendo al
consolidador— viajaban como **cadenas concatenadas**. Nada podía responder qué
se le pidió exactamente a un agente, qué se le dejó ver, qué debía devolver ni
con qué tope. `agentHandoff.ts` lo declara —objetivo, restricciones, criterios,
referencias de contexto, salida esperada, presupuesto y correlación— y el prompt
pasa a ser una *representación* del contrato, no al revés.

Tres propiedades que conviene no perder. La topología la responde el registro
(`canHandOff`), así que «el consolidador no reparte trabajo» se comprueba en vez
de suponerse, y el rechazo ocurre **antes de la llamada**: un handoff imposible
cuesta cero. El contexto viaja como referencias atribuidas y con un tope de
**número**, no de longitud: un análisis largo es trabajo legítimo, cuarenta
turnos de historial es el modo de fallo que la regla nombra. Y un handoff
rechazado se **informa** (`rejectedHandoffs`) en vez de tragarse: un workstream
que no se emitió es trabajo que no ocurrió, y quien presenta la recomendación
tiene derecho a saber que el equipo era más pequeño de lo que parece.

**Una ejecución se puede reconstruir.** El encargo guardaba dos mitades de una
historia y ningún hilo entre ellas: el rastro decía que una tarea empezó y
terminó, y el registro de acciones del agente guardaba el prompt, las fases, las
versiones y el rollback de la generación que hizo el trabajo. `executeAgentAction`
devolvía su `traceId` desde que existe y `OfficeProduceOutcome` lo tiraba.

Ahora cada intento tiene su `runId` —un encargo se **reanuda**, no se reinicia,
así que sin él el segundo intento se añade a la misma secuencia indiferenciada
que el primero—, cada tarea nace con `createdAt` y guarda en `traceIds` las
invocaciones que causó, y `officeRunTrace.describeRun` reconstruye el intento
entero. El `runId` lo estampa `withAuditEntry` leyéndolo del encargo, no del
llamante: el runner escribe ocho clases de entrada y un id que hay que recordar
en cada sitio es uno que se olvidará en alguno.

Dos detalles que conviene no deshacer. Los `traceIds` de producción son los del
agente y **empalman** con `projects/{id}/agent_actions/{traceId}`; los de
revisión y consolidación los acuña la Oficina porque ese camino llega al modelo
por la fachada legacy, que no devuelve ninguno — y el tipo lo dice, porque un id
con la misma pinta que los otros y que no empalma con nada sería peor que no
tenerlo. Y lo anterior a la correlación se informa como `unattributedWork` en
vez de absorberse en el primer run: fecharlo en un intento al que nunca
perteneció es peor que admitir que no está atribuido.

**Una acción de alto impacto no corre sin que alguien la apruebe.**
`requiresConfirmation` lo calculaban el clasificador de intención, su variante
LLM y el planificador, y **no lo leía nadie**: lo único que separaba una acción
de alto impacto del artefacto era que un hook de UI aparcara el plan antes de
ejecutarlo. `agentConfirmationGate` lo aplica en el executor, que es el único
sitio por el que pasan todos los llamantes, y devuelve `cancelled` —no `failed`—
porque nada ha fallado: la acción sólo no estaba autorizada todavía.

**The orchestration carries declared limits, not emergent ones**, and a bounded
self-correction:

| Limit | Where | Value |
|---|---|---|
| Specialists per operation | `planOfficeWorkstreams` | 4 (`DEFAULT_MAX_SPECIALISTS`) |
| Specialists in parallel | `executeOfficeOrchestration` | 3 |
| Consolidator corrections | `executeOfficeOrchestration` | **1** |
| Agents the user switched off | `unavailableAgents` | never empties the team |

The correction is the evaluator-optimizer pattern, kept cheap:
`officeConsolidationReview.ts` evaluates the recommendation **without calling a
model** — the four criteria are mechanical (a verdict, every contributor cited,
a partial answer that says it is partial, and enough body to be consolidating
anything) — and only a failure spends the one extra call. If the correction
itself fails, the original answer is kept: an imperfect recommendation beats an
error where the answer should be. The refinement emits its own event, because
two "recommendation signed" events in a row are indistinguishable to a reader.

## What NOT to Do

- Do not add a custom domain backend or REST API. `api/` is limited to stateless key-hiding proxies. La transición aprobada en F1 mueve la autoridad de las reglas sensibles a PostgreSQL (RLS + RPC `SECURITY DEFINER`) y, cuando hace falta clave de servicio, a una Edge Function — no a endpoints de dominio en `api/`.
- Do not talk to Supabase from a page, component, context or hook either. El SDK vive en **un** fichero de `services/adapters/` y se carga en diferido; el dominio entra por `callRpc` o por el repositorio de su contexto. Un segundo fichero que importe `@supabase/supabase-js` está rehaciendo la puerta que ya existe.
- **Do not construct a second Supabase client.** Uno solo, en `services/adapters/supabaseClient.ts`. Dos con `persistSession` sobre la misma clave de almacenamiento se pelean por el refresh token y cierran la sesión de quien acaba de abrirla, sin ningún error a la vista; `noSdkInUiLayers.test.ts` cuenta las llamadas a `createClient`.
- Do not bring Firebase back, in any form. No hay dependencia, ni reglas, ni emulador, ni variables; `noSdkInUiLayers.test.ts` conserva sus módulos en la lista de prohibidos exactamente para eso.
- Do not persist a signed URL. Los cubos son privados y una URL firmada caduca: guardar una es guardar un enlace roto, o —si no caducara— una puerta pública a un objeto privado escrita en la base de datos. Se guarda la **ruta** y se firma al abrir.
- Do not publish production by any path but `ci.yml`. `vercel.json` apaga el
  despliegue automático de la integración Git en `main`, y las dos mitades de
  esa decisión —`main` apagada, previews vivas— están afirmadas por separado en
  `__tests__/config/ciPipeline.test.ts`.
- Do not bump `vite`, `@excalidraw/excalidraw`, `typescript`, `mermaid` o
  `react-dom` sin leer antes *Dependencias que no pueden subir*. Las cinco pasan
  la suite entera y rompen otra cosa; el changelog no lo dice. (`firebase` salió
  de esa lista al salir del proyecto.)
- Do not merge a Dependabot branch as-is. Las de la cola nacieron de un `main`
  anterior y reintroducen `mirror-source.yml`. Aplica la subida sobre `main`
  actual y deja que Dependabot cierre su PR solo.
- Do not deploy from a workstation. Un artefacto que no se puede reconstruir desde `main` no es un despliegue: producción sirvió durante días un commit que no existía en el repositorio. El despliegue cuelga del trabajo `deploy` de `ci.yml`, detrás de los gates — ver `docs/ci-cd-pipeline.md`.
- Do not call the database **or Auth** directly from a page, component, context or hook — always go through your context's repository and `services/identity` (lint-enforced).
- Do not import `@google/genai` outside `services/ai/providers/gemini/` (lint-enforced). Describe output shape with `AIJsonSchema` from `services/ai/schema`; each provider translates it at its own boundary.
- Do not import `services/geminiService` outside `services/ai/` (lint-enforced). Use a domain façade, or `aiGateway` when you compose your own prompt.
- Do not name a concrete model outside a provider. Resolve tiers with `resolveModelForSettings`.
- Do not introduce a cycle between modules, **a group of modules that can reach itself through others**, an import that points up through the layers, an import that reaches past a module's `index.ts`, or a screen that imports a third service module — **`npm run check:module-boundaries` enforces all five** against `modules.json`. El segundo es el que faltaba: durante una ola entera el gate estuvo verde con nueve contextos de dominio mutuamente alcanzables. Ver *Module boundaries* y `docs/ddd-transformacion/`.
- Do not grow `services/geminiService.ts` or `components/ArtifactCanvas.tsx` — **`npm run check:module-size` enforces this**, along with a 500-line **and 20 KB** default for every other module. Each oversized file carries both numbers it has today; a change may lower one and may not raise it without a reason in the commit message. The weight is the half that catches data: the `en`/`es` dictionary inside `AppContext` was 17 lines and 20 KB, under every line budget the repository had.
- Do not introduce a state management library (Redux, Zustand, …) without explicit approval.
- Do not reintroduce runtime CDN `<script>`/`<link>` tags in `index.html`.
- Do not add CSS files, CSS modules, or rules to `src/index.css` — Tailwind classes only.
- Do not rewrite `components/Icons.tsx`; append.
- Do not use `any` in new code; do not add `// @ts-ignore` (ESLint blocks it — `@ts-expect-error` with a description is allowed).
- Do not commit `.env.local` or any file containing API keys.
- Do not let `npm run lint` report errors, or `npm run typecheck` / `npm run test:ci` fail.
- Do not change a table or a payload shape without its migration, its `revoke`, and its pgTAP contract with the negative case, in the same change.
- Do not skip, disable, or delete a failing test to get the suite green.
- Do not compose a prompt out of content the app did not write without fencing
  it (`wrapUntrustedContent`), and do not add a guardrail that blocks on a
  *phrase*. Blocking on injection wording refuses this product's own security
  documents, and a guardrail that stops ordinary work is one somebody switches
  off — taking the credential check with it.
- Do not move a guardrail below the retry loop, and do not let the proxy client
  turn a block into an outcome. Both turn a refusal that costs nothing into one
  that costs a call per candidate, or into a caller quietly trying the direct
  provider instead.
- Do not add a key shape to one of the two lists only. `lib/secretShapes.ts`
  (runtime) and `scripts/checkBundleSecrets.mjs` (build) are compared entry by
  entry by `__tests__/security/secretShapes.test.ts`.
- Do not route a form field through the Office's team. Assisted capture is one
  agent by design — see *Assisted capture*.
- Do not make an agent's artifact assignments, its reviewer duties or its
  orchestration role configurable from a screen. That half of the card is
  governance.
- Do not offer an ARB decision control by reading the permission alone. El autor
  no firma su propio encargo —el servidor lo rechaza con `42501`— y la pregunta
  es «¿puede *este* actor firmar *este* encargo?»:
  `describeArbDecisionEligibility`, que devuelve el motivo para que la pantalla
  elija la frase y no vuelva a decidir la regla.
- Do not re-export a type from `types.ts` «para que los imports existentes sigan
  funcionando». Eso creó cuatro ciclos y tres imports ascendentes que
  sobrevivieron a los imports que iban a proteger — 19 de las declaraciones
  reexportadas no tenían **un solo consumidor**. Importa del contexto dueño.
- Do not put prompt composition in `utils.ts`, ni en ningún fichero de la raíz.
  Lo que la capa de fundación importa, el arranque lo descarga: esas 290 líneas
  metían dos ficheros de `services/ai` en el chunk eager, y
  `bootPathStaysLight.test.ts` es lo que lo mide.
- Do not answer "which agent?" anywhere but `agentRegistry`. Filtering
  `OFFICE_AGENT_PERSONAS` inline is what produced two routing tables that
  disagreed; `agentRegistrySingleDoor.test.ts` scans for it.
- Do not add a field to the agent contract that nothing reads. A tool policy for
  one tool, or a memory policy with no scopes to grant, is a governance surface
  that governs nothing — and an empty field on thirteen records says the work
  was done.
- Do not write a suggestion into a record without an explicit human click, and
  do not call the model when the record has nothing to reason from.
- Do not route a question about *how the product works* through the Office's
  team, and do not let the platform guide answer an architecture question. Each
  one is the other's wrong tool — see *The platform guide*.
- Do not let the guide's catalogue go stale: a screen that moves or is renamed
  updates `lib/platformGuide/platformGuideTopics.ts` in the same commit.
- Do not derive the portfolio's health inside a component either. The rule is
  `buildPortfolioCommandCenter`, an unmeasured portfolio is `null` and never
  0 %, and the figure is never rendered without the `drags` that compose it.
- Do not add a charting dependency. The eager payload runs on a 600 KB gz budget
  with single-digit headroom, and `components/ui/charts/` covers the seven forms
  the product uses in hand-rolled inline SVG.
- Do not add a second definition of a shadow, radius, motion duration or type
  step. `lib/designTokens.ts` names them once; colour stays in
  `tailwind.config.cjs`.
- Do not ship a control whose only operation is a drag. WCAG 2.2 · 2.5.7 —
  `useResizablePanel` is the worked example of the keyboard path.
- Do not let a status be carried by hue alone. `StatusDot` gives each of the four
  severities its own silhouette, and every chart labels its marks in words.
- Do not derive a project's health, or its progress, inside a component. Both
  are domain rules in `services/architectureProjects/attentionTracking.ts`, and
  an undeclared value stays `null` — never 0 %.
- Do not capture a project's contribution to an initiative as text. The outcome
  and the KPI are ids of records that exist, like every other relation in the
  portfolio.
- Do not derive a diagram's reading order anywhere but `buildStoryPlan`, and do
  not present a derived story as an authored one. There were three copies of
  that traversal and the authored narrative lost to all three.
- Do not add a patch operation that can set a position, a size or a colour.
  Geometry is the layout engine's and appearance is the design system's; an
  operation that could set either hands both to whatever emits the JSON.
- Do not apply a model's diagram change without `applySemanticPatch`, and do not
  build a preview by summarising the operations. The engine's own run against a
  copy is the preview — a proposal that describes one change and encodes another
  is exactly what it exists to catch.

---

## Documentation Map

Read the relevant doc before modifying a subsystem — they carry the rationale that the code does not:

| Doc | Topic |
|---|---|
| `docs/security-hardening.md` | Auth bypass removal, Custom Claims, required server-side config |
| `docs/persistence-hardening.md` | Degradación de persistencia y seguridad de escritura de artefactos |
| `docs/ai-kernel.md` | The canonical AI kernel: modules, how to add a provider/model/tool, how to diagnose a run, and what it deliberately does not do yet |
| `specs/02-architecture/ADR/ADR-002-canonical-ai-kernel.md` | Why the contract is shaped this way, and the trade-off accepted with it |
| `specs/02-architecture/ADR/ADR-003-model-routing-strategy.md` | Eligibility vs ranking, and why the two fallback policies stay separate |
| `specs/02-architecture/ADR/ADR-004-agent-contract-and-registry.md` | El contrato del agente, el registro como única puerta, y lo que se dejó fuera a propósito |
| `specs/02-architecture/ADR/ADR-005-diagram-story-plan.md` | Por qué la historia es parte del modelo, y por qué lo derivado nunca se presenta como escrito |
| `specs/02-architecture/ADR/ADR-006-semantic-diagram-patches.md` | Editar un diagrama sin regenerarlo: el vocabulario, las tres garantías y lo que no se puede expresar |
| `docs/ai-proxy.md` | Provider-agnostic serverless proxy contract |
| `docs/artifact-compiler.md` | Compilation + review engine |
| `docs/artifact-generation-hardening.md` | Optimistic rollback, concurrency, runtime validation, "no blank screen" |
| `docs/artifact-generation-stabilization-report.md` | Stabilization findings |
| `docs/diagram-quality-gate.md` | The diagram quality rubric and gate |
| `docs/diagram-story-and-patches.md` | How to read a diagram's story plan, and how to change a diagram without regenerating it |
| `docs/diagram-world-class-audit.md`, `docs/diagram-world-class-audit-2026-04-17.md` | Diagram module audits |
| `docs/oficina-arquitectura.md` | Architecture Office: engagement model, task DAG, runner ports, ARB governance, separation of duties, known limits |
| `docs/guia-oficina-arquitectura.md` | Architecture Office **user guide** (Spanish): intake, charter, gates, ARB, troubleshooting |
| `docs/agentes-anthropic-alineacion.md` | Which agent pattern is used where, its limits and guardrails, mapped to Anthropic's guidance principle by principle |
| `docs/architecture-knowledge-graph.md`, `docs/consistency-engine.md`, `docs/traceability-engine.md` | AKG, consistency, traceability/impact |
| `docs/publication-pipeline.md`, `-packages.md`, `-governance.md`, `-accessibility.md` | Publication pipeline |
| `docs/export-hardening.md` | Export adapters and their guarantees |
| `docs/arquitecto-agente.md` | The agent (planner/executor/memory) |
| `docs/ui-ux-world-class-plan.md` | UI/UX upgrade plan |
| `docs/technical-debt-audit.md` | Prioritised debt — **record new debt here** |
| `docs/aws-migration-plan.md` | **Propuesta, sin ejecutar, y hoy histórica**: se escribió contra la infraestructura Firebase/Vercel, que F9 sustituyó. Plan por fases para migrar a AWS dentro de la capa gratuita: Cognito, DynamoDB en tabla única, Lambda + API Gateway, S3 + CloudFront, CI/CD por OIDC, y los cuatro riesgos estructurales medidos sobre este código |
| `docs/top-10-monolito-modular-ddd-2026-09-01.md` | Open review: modular-monolith boundaries, DDD, tech debt and CI/CD — measured dependency graph, cycle census and the root cause of the 8m49s test step |
| `specs/00-index.md` | SDD artifacts: BRD, use cases, ADRs, domain model, NFR, BDD, traceability matrix |

---

## AI Assistant Resources

This repository ships project-scoped agents and skills. Prefer them over ad-hoc reasoning.

> **Cross-assistant compatibility:** `AGENTS.md` maps these same capabilities for OpenAI Codex/Koder and for the Hermes maintenance workflow. Keep `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/` and `AGENTS.md` in sync in the same change whenever agents or skills are added or modified.

### Sub-agents (`.claude/settings.json`)

| Agent | Use it for |
|---|---|
| `code-reviewer` | Reviewing diffs for TS/React/security/service-layer violations |
| `architect` | Evaluating architectural decisions across the React/Supabase/Vite stack |
| `debugger` | Systematic diagnosis — traces UI → context → service → SDK |
| `tech-lead` | Planning features, estimating effort, choosing implementation order |
| `test-author` | Writing Vitest unit/component/integration tests with the standard mocks |
| `gemini-prompt-engineer` | Authoring and editing AI prompts |
| `lms-curator` | Creating/editing LMS content via `services/learning` + `types/lms.ts` |

### Slash-command skills (`.claude/skills/`)

| Skill | Purpose |
|---|---|
| `/architecture` | Deep architectural analysis of the current codebase |
| `/code-review` | Review the latest diff for correctness and safety |
| `/debug` | Walk a bug through the UI → context → service call path |
| `/deploy-checklist` | Pre-deploy validation for Vercel + Supabase |
| `/documentation` | Generate/update JSDoc and component docs |
| `/incident-response` | Structured response to a production incident |
| `/standup` | Standup summary from recent git activity |
| `/system-design` | Design a feature across data, services, context, UI |
| `/tech-debt` | Prioritised tech-debt audit |
| `/testing-strategy` | Test plan for a target module |
| `/add-artifact-type` | Scaffold a new Artifact type across all layers |
| `/write-test` | Produce a Vitest spec for a target file |
| `/add-lms-course` | Create a new LMS course end-to-end |
| `/refresh-claude-md` | Re-audit this file against the real repo and propose fixes |

Generic skills (art, doc co-authoring, MCP builder, skill-creator, theme-factory, …) live in the user-level `~/.claude/skills/` directory and are available in every project.
