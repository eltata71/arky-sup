# F6-07 · Mediciones finales — salidas de los comandos

**Fecha:** 2026-09-25 · **Commit:** `87172fd` (`main`) · **Entorno:** Node v24.21.0 / npm 11.19.0

Mismos comandos que `00-linea-base.md`. El build usa las variables `VITE_*` del trabajo `quality` de `ci.yml`. Salidas recortadas a su resumen; el comando reproduce la completa.

## Gates

```
$ npm run typecheck         → exit 0
$ npm run typecheck:strict  → exit 0 (47 entradas en tsconfig.strict.json)
$ npm run lint              → exit 0, sin salida (0 errores, 0 avisos)
$ npm run check:any-budget
[check:any-budget] objetivo: tipos `any` = 7, cumplido (≤ 7).
[check:any-budget] OK — 7 `any` types, budget 7.
    6  components/ExcalidrawViewer.tsx
    1  components/routing/lazyWithRetry.ts
$ npm run check:module-size
[check:module-size] OK — no module over its ceiling (default 500 lines, 20000 bytes).
$ npm run check:no-orphan-scripts
[check:no-orphan-scripts] OK — the root holds only build configuration.
```

## Suite (`npm run test:ci`)

```
 Test Files  489 passed (489)
      Tests  4739 passed (4739)
   Duration  256.85s (transform 94.82s, setup 31.24s, import 246.96s, tests 149.86s, environment 135.94s)
```

## Fronteras (`node scripts/checkModuleBoundaries.mjs --report`)

```
// 3 cycles, 1 strongly connected components (3 modules), 0 upward pairs, 29 deep-import pairs, 0 screens over the fan-out default
export const ALLOWED_CYCLES = [
  'components <-> context',
  'components <-> hooks',
  'context <-> hooks',
];
DEEP_IMPORT_BUDGET: 29 pares, 173 imports profundos en total
modules.json: 39 módulos (28 domain, 6 foundation, 5 ui)
```

## Bundle (`npm run build && npm run check:bundle-budget`)

```
Eager payload — downloaded before anything renders:
    182.5 KB gz     586.4 KB raw  index-BWnRjdHe.js
     58.4 KB gz     177.8 KB raw  vendor-react-8aodS45q.js
     40.9 KB gz     124.9 KB raw  vendor-motion-CZDn_SST.js
     28.3 KB gz     210.5 KB raw  index-Ct8VWqOy.css
    310.1 KB gz            —      TOTAL


Per route — downloaded on top of the eager payload:
      4.9 KB gz  of    10.0 KB  AuthPage
     48.8 KB gz  of    60.0 KB  DashboardPage
     20.4 KB gz  of    30.0 KB  SettingsPage
     42.0 KB gz  of    50.0 KB  AgentsPage
      7.5 KB gz  of    15.0 KB  UserManagementPage
    734.3 KB gz  of   740.0 KB  ProjectsPage
    655.3 KB gz  of   660.0 KB  InitiativesPage
    661.6 KB gz  of   670.0 KB  InitiativeRoom
    640.3 KB gz  of   650.0 KB  OfficePage
    641.3 KB gz  of   650.0 KB  EngagementRoom
    623.5 KB gz  of   630.0 KB  TrainingCenterPage
    658.0 KB gz  of   665.0 KB  SDDProcessView
   1097.1 KB gz  of  1105.0 KB  Workspace

[check:bundle-budget] OK — eager 310.1 KB gz of 340.0 KB budget.
$ npm run check:bundle-secrets
[check:bundle-secrets] OK — no provider credentials found in dist/.
```

## pgTAP — ejecutado en CI sobre `main` (`supabase.yml`, ejecución 36182778049)

La línea base no pudo ejecutarlos (sin Docker). Esta vez sí se ejecutaron.

```
supabase/tests/database/artifact_commands.test.sql … ok
supabase/tests/database/business_initiatives.test.sql … ok
supabase/tests/database/decide_engagement_atomic.test.sql … ok
supabase/tests/database/engagement_overload_and_initiative_references.test.sql … ok
supabase/tests/database/identity_authorization.test.sql … ok
supabase/tests/database/initiative_code_allocation.test.sql … ok
supabase/tests/database/knowledge_graph.test.sql … ok
supabase/tests/database/learning.test.sql … ok
supabase/tests/database/office_engagement_transitions.test.sql … ok
supabase/tests/database/office_engagements.test.sql … ok
supabase/tests/database/platform_foundation.test.sql … ok
supabase/tests/database/platform_reference_parameters.test.sql … ok
supabase/tests/database/project_deletion_conflict.test.sql … ok
supabase/tests/database/projection_outbox.test.sql … ok
supabase/tests/database/projects_artifacts.test.sql … ok
supabase/tests/database/retirement_completeness.test.sql … ok
supabase/tests/database/storage_private_objects.test.sql … ok
supabase/tests/database/user_settings_pilot.test.sql … ok
supabase/tests/database/artifact_commands.test.sql … ok
supabase/tests/database/business_initiatives.test.sql … ok
supabase/tests/database/decide_engagement_atomic.test.sql … ok
supabase/tests/database/engagement_overload_and_initiative_references.test.sql … ok
supabase/tests/database/identity_authorization.test.sql … ok
supabase/tests/database/initiative_code_allocation.test.sql … ok
supabase/tests/database/knowledge_graph.test.sql … ok
supabase/tests/database/learning.test.sql … ok
supabase/tests/database/office_engagement_transitions.test.sql … ok
supabase/tests/database/office_engagements.test.sql … ok
supabase/tests/database/platform_foundation.test.sql … ok
supabase/tests/database/platform_reference_parameters.test.sql … ok
supabase/tests/database/project_deletion_conflict.test.sql … ok
supabase/tests/database/projection_outbox.test.sql … ok
supabase/tests/database/projects_artifacts.test.sql … ok
supabase/tests/database/retirement_completeness.test.sql … ok
supabase/tests/database/storage_private_objects.test.sql … ok
supabase/tests/database/user_settings_pilot.test.sql … ok
All tests successful.
Files=18, Tests=501,  2 wallclock secs ( 0.08 usr  0.05 sys +  0.18 cusr  0.10 csys =  0.41 CPU)
Result: PASS
All tests successful.
Files=18, Tests=501,  2 wallclock secs ( 0.09 usr  0.04 sys +  0.19 cusr  0.11 csys =  0.43 CPU)
Result: PASS
```

## Superficie SQL

```
$ ls supabase/migrations/*.sql | wc -l           → 45
$ ls supabase/tests/database/*.sql | wc -l       → 18
$ grep -rln "drop function" supabase/migrations → 2 ficheros, 2 sentencias (el tercer resultado de grep es un comentario): delete_engagement(text, text) y save_project_aggregate(jsonb, jsonb, bigint)
```
