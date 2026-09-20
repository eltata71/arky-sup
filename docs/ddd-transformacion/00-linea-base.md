# Línea base medida — transformación DDD / monolito modular

**Fecha de medición:** 2026-09-20
**Rama de trabajo:** `claude/arky-ddd-modular-transform-lowfh7`
**Commit base:** `fd590e70ad7a0fda1530025153fc89c43d037649` (idéntico a `origin/main`)
**Entorno:** Node v22.22.2 / npm 10.9.7 (el repositorio declara `engines.node: 24.x`;
npm emite `EBADENGINE` y la instalación funciona. **Pendiente**: repetir la medición
sobre Node 24 antes del cierre, porque el presupuesto de bundle depende del bundler
y no del runtime, pero la suite sí puede depender del runtime.)

Todas las cifras salen de ejecutar los gates, no de leer código ni documentación.
Los comandos y sus salidas completas están en `evidencias/`.

---

## 1. Gates del repositorio

| Gate | Comando | Resultado | Valor |
|---|---|---|---|
| Tipos | `npm run typecheck` | ✅ limpio | — |
| Tipos estrictos | `npm run typecheck:strict` | ✅ limpio | 31 entradas en `tsconfig.strict.json` |
| Lint | `npm run lint` | ✅ 0 errores, 0 avisos | — |
| Presupuesto `any` | `npm run check:any-budget` | ✅ | **23 / 23** — 16 `services/geminiService.ts`, 6 `components/ExcalidrawViewer.tsx`, 1 `components/routing/lazyWithRetry.ts` |
| Tamaño de módulo | `npm run check:module-size` | ✅ | ningún módulo sobre su techo |
| Scripts huérfanos | `npm run check:no-orphan-scripts` | ✅ | — |
| Fronteras | `npm run check:module-boundaries` | ✅ | ver §2 |
| Suite | `npm run test:ci` | ✅ | **450 ficheros, 4 312 pruebas** |

> **Discrepancia registrada.** `CLAUDE.md` declara «456 ficheros (455 + 1 omitido),
> 4 359 pruebas pasadas y 64 omitidas». Lo medido hoy sobre el mismo commit es
> **450 ficheros / 4 312 pruebas, 0 omitidas reportadas**. La documentación va por
> delante del repositorio en esa cifra; esta tabla es la autoridad.

## 2. Censo de fronteras (`check:module-boundaries --report`)

| Medida | Valor |
|---|---|
| Módulos declarados en `modules.json` | 34 (4 `ui`, 28 `domain`, 2 `foundation`) |
| Ciclos **directos** registrados | **4** (`components <-> context`, `components <-> hooks`, `context <-> hooks`, `services (raíz) <-> services/ai`) |
| Pares de import hacia arriba | **0** |
| Pares con import profundo | **59** |
| **Imports profundos totales** | **264** |
| Pantallas sobre el fan-out por defecto (2) | **10** |

Los diez ficheros sobre el fan-out: `ArtifactCanvas.tsx` (5),
`artifacts/export/ArtifactExportModal.tsx` (4), `copilot/ProjectCopilotChatModal.tsx` (4),
`pages/InitiativesPage.tsx` (4), `architectureOffice/EngagementIntakeWizard.tsx` (3),
`architectureOffice/OfficeCapabilitiesPanel.tsx` (3), `artifacts/ArtifactInspectorPanel.tsx` (3),
`AssistantPanel.tsx` (3), `pages/ProjectsPage.tsx` (3), `pages/Workspace.tsx` (3).

## 3. Lo que el censo no ve — componentes fuertemente conexos

`analyse()` declara un ciclo sólo cuando **dos** módulos se importan mutuamente
(`has(b, a)`). Un ciclo `A → B → C → A` es invisible para el gate.

Ejecutando Tarjan sobre el **mismo** grafo de aristas que produce el gate
(`evidencias/scc-linea-base.md`):

| Componente | Tamaño | Módulos |
|---|---|---|
| Dominio | **9** | `services (raíz)`, `services/agent`, `services/ai`, `services/architectureKnowledgeGraph`, `services/architectureOffice`, `services/architectureProjects`, `services/artifacts`, `services/chat`, `services/publicationPipeline` |
| UI | 3 | `components`, `context`, `hooks` |

**22 aristas** viven dentro del componente de dominio. La afirmación de `CLAUDE.md`
— «4 ciclos registrados, **0 de ellos entre contextos de dominio**» — es cierta
para ciclos de longitud 2 y **falsa** en sentido transitivo: nueve contextos de
dominio son mutuamente alcanzables. Ésta es la corrección más importante del
diagnóstico, y es la tarea F3-01.

Las dos aristas que sostienen el componente:

- `services/ai -> services (raíz)` — **12 imports** de `services/geminiService`.
- `services (raíz) -> {ai, agent, artifacts, chat, architectureOffice, architectureKnowledgeGraph}` — **26 imports**, todos desde `geminiService.ts`.

## 4. Bundle

| Medida | Valor | Presupuesto |
|---|---|---|
| Carga inicial (eager) | **323,9 KB gz** | 340,0 KB gz |
| Entrada (`index-*.js`) | **195,8 KB gz** (619,1 KB raw) | — |
| Secretos en `dist/` | ninguno | — |

Margen: **16,1 KB gz**. Detalle en `evidencias/bundle-linea-base.md`.

> **Discrepancia registrada.** `CLAUDE.md` declara «eager 439,1 KB gz de 450;
> entrada 200,3». Lo medido es 323,9 / 340. La documentación describe un
> presupuesto que ya no es el del repositorio.

## 5. Superficie SQL

34 migraciones en `supabase/migrations/`, 11 contratos pgTAP en
`supabase/tests/database/`. **Ninguna migración contiene `drop function`**
(verificado con `grep -rn "drop function" supabase/migrations/`), lo que hace
estructuralmente posible que una sobrecarga antigua siga concedida — ver F1-H09.

**No se ejecutaron los contratos pgTAP en esta medición**: requieren Docker
(`bash scripts/supabase/local.sh verify`) y el entorno de esta sesión no lo
tiene. Queda como verificación pendiente, y ninguna afirmación sobre
comportamiento SQL de este documento se apoya en ejecución: todas son evidencia
estática sobre el texto de las migraciones.
