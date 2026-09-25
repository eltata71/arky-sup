# F6-05 · Rendimiento, descarga, concurrencia y recuperación

**Fecha:** 2026-09-25 · **Rama:** `codex/f6-05-rendimiento`

La tarea no tenía criterio escrito en el backlog. Se derivó de los criterios
de cierre de la fase 6: *gates de calidad y rendimiento en verde; conflictos
concurrentes explícitos y recuperables; proyecciones durables idempotentes*.
Cada eje se midió, y dos de las mediciones encontraron defectos que se
corrigieron aquí.

## 1. Descarga — lo que cada ruta cuesta

El presupuesto existente mide la **carga inicial**, lo que todo visitante
descarga antes de pintar: 310,1 KB gz de 340 (la línea base era 323,9). No
medía lo que pasa **después**, al abrir cada pantalla. Esto es lo que se midió
sobre el build de producción: el cierre de imports estáticos del chunk de
cada ruta, menos lo que ya trajo la carga inicial.

| Ruta | Antes | Después | Presupuesto |
|---|---:|---:|---:|
| **Dashboard** (aterrizaje tras iniciar sesión) | **617,6** | **48,9** | 60 |
| Agentes | 610,6 | 42,1 | 50 |
| Configuración | 569,3 | 20,5 | 30 |
| Autenticación | 4,9 | 4,9 | 10 |
| Usuarios | 7,5 | 7,5 | 15 |
| Proyectos | 737,0 | 737,0 | 740 |
| Iniciativas | 657,9 | 657,9 | 660 |
| Sala de iniciativa | 664,2 | 664,2 | 670 |
| Oficina | 642,9 | 642,9 | 650 |
| Sala de entregable | 643,8 | 643,9 | 650 |
| Formación | 626,3 | 626,4 | 630 |
| Proceso SDD | 660,5 | 660,6 | 665 |
| Workspace | 1 100,7 | 1 100,5 | 1 105 |

KB gz descargados además de la carga inicial.

**La causa.** Un único chunk compartido de **517,6 KB gz** que Rollup nombró
`captureFields`. Su mapa de fuentes muestra qué contiene: **elkjs** (el motor
de layout de diagramas), **@google/genai** (el SDK de Gemini) y el núcleo
entero de `services/ai`. El Dashboard lo descargaba para pintar cuatro
gráficas. El camino, trazado por imports estáticos:

```
pages/DashboardPage.tsx
  -> hooks/usePortfolioCommandCenter.ts
  -> services/architectureOffice/index.ts        (el barril)
  -> services/architectureOffice/OfficeRunnerAdapters.ts
  -> services/agent/index.ts -> agentExecutor.ts
  -> services/diagram/index.ts -> irToReactFlow.ts -> lib/elkLayoutEngine.ts
```

Es la regla del barril contra el bundle en rutas diferidas. CLAUDE.md
autoriza el barril desde código diferido, y la regla es correcta para la
carga inicial. Pero el barril de la Oficina reexporta su orquestación, y ésta
tiene efectos de módulo que el tree-shaking no puede quitar. Así que
cualquier pantalla que lee un tipo o una regla pura de la Oficina paga el
motor entero.

**El arreglo son puertas pequeñas**, el patrón de F3-06, declaradas en
`modules.json`:

- `services/architectureOffice/portfolio.ts`: los modelos de lectura del
  portafolio (`officePortfolio`, `portfolioCommandCenter`). Las usan el
  Dashboard y `PortfolioHealthHero`.
- `services/architectureOffice/agents.ts`: las fichas de los agentes, su
  repositorio y el conocimiento de la Oficina. Las usan `/agents` y sus
  componentes.
- `services/ai/generation/providerModelDirectory.ts`: el directorio de
  modelos. Lo usa `/settings`, junto con el catálogo de `lib/ai`.

Ninguna de las tres alcanza el núcleo de IA ni ELK. Se comprobó trazando el
grafo de imports.

**Las rutas que siguen en ~600 KB gz** son las que sí llaman a un modelo: la
captura asistida está en todos los formularios y el asistente en las salas.
Bajarlas exige cargar la IA en el primer uso y no al abrir la pantalla. Es un
cambio de diseño, no de imports, y queda como propuesta (§5). Sus
presupuestos fijan la cifra de hoy para que sólo pueda bajar.

**El gate.** `check:bundle-budget` mide ahora cada ruta
(`ROUTE_BUDGETS_GZIP_KB`, `routeDownloads`). Una ruta que no aparezca en el
build se informa como ausente, nunca como cero. Cuatro pruebas nuevas en
`__tests__/scripts/bundleBudget.test.ts` fijan qué cuenta como coste de una
ruta:

- su chunk y los imports estáticos que arrastra;
- menos lo que ya trajo la carga inicial;
- sin los imports dinámicos, que no se descargan al abrir la pantalla.

## 2. Descarga — que cada chunk además se evalúe

El incidente de F6-04 fue de otra clase: el chunk del Workspace se descargaba
con un 200 y **fallaba al evaluarse**. Ningún presupuesto de tamaño lo ve.
`e2e/chunks.spec.ts` importa en el navegador, contra el `vite preview` de
`dist/` que usan los recorridos, **cada chunk que emitió el build**, y falla
con cualquiera que lance.

**Probado contra el defecto.** Sobre un build con el `services/review`
anterior al arreglo de F6-04, falla con el error de producción:

```
Error: 3 de 151 chunks fallaron al evaluarse
  "Workspace-DhkWBl5V.js: Cannot access 'Tk' before initialization"
```

Sobre el build actual pasan los 151.

## 3. Concurrencia — inventario de escrituras

Se recorrieron las 37 RPC de escritura del esquema `api`, en su última
definición. Las que llevan revisión esperada rechazan una revisión vieja con
`P0001`, y `services/persistence/supabaseErrors.ts` clasifica ese código como
`conflict`: el conflicto es explícito de extremo a extremo.

| Escritura con revisión | Contrato con el caso de conflicto |
|---|---|
| `save_project`, `update_artifact`, `delete_artifact` | `artifact_commands`, `projects_artifacts` |
| `save_business_initiative`, `delete_business_initiative` | `business_initiatives` y dos más |
| `save_engagement` | `office_engagements`, `decide_engagement_atomic` |
| `save_knowledge_graph` | `knowledge_graph` |
| `save_graph_projection` | `projection_outbox`: no lanza, devuelve `applied: false` con `already-processed` o `stale` |
| `save_user_settings` | `user_settings_pilot` |
| `save_course` | `learning` |
| `save_platform_reference_parameters` | `platform_reference_parameters` |
| **`delete_project_aggregate`** | **ninguno** → nuevo `project_deletion_conflict.test.sql` |

El contrato nuevo cubre los cuatro casos:

- una revisión vieja es un conflicto `P0001` **y no borra nada**;
- la revisión vigente borra;
- la revisión 0 es el borrado incondicional que la papelera confirma con la
  persona;
- otro usuario no borra un proyecto ajeno aunque conozca su revisión.

**Escrituras sin revisión, y por qué se aceptan:**

- **Sólo añaden:** `append_agent_action`, `record_artifact_review_decision`
  (`on conflict do nothing`), `record_arb_decision` y el registro de archivos.
  No hay nada que pisar.
- **Registros propios de un usuario, por clave:** progreso, contexto y notas
  del LMS, fichas de agentes, comentarios. Gana la última escritura, a
  granularidad de un registro pequeño que sólo edita su dueño.
- **Administración:** rol, estado y alta de usuarios. Lo gobiernan el
  permiso y la auditoría, no la revisión.

**Una que no se acepta, y queda como hallazgo: `save_chat_history`.** Reescribe
la lista **entera** de mensajes de un proyecto, sin revisión. Con dos pestañas
en el mismo proyecto, la que guarda última borra los mensajes de la otra, y
nadie se entera. Arreglarlo exige una migración (revisión, o añadir mensajes en
lugar de reescribir la lista), que requiere la aprobación del propietario
antes de aplicarse a `ArkyDB-US`. Se propone para F6-08 (§5).

## 4. Recuperación

| Mecanismo | Qué lo prueba |
|---|---|
| Proyección del grafo perdida con la pestaña cerrada | `projection_outbox.test.sql` (base real), `graphProjectionRecovery.test.ts`, `graphProjectionSync.test.tsx` y, desde F6-04, el recorrido E2E con la aplicación cerrada |
| Reprocesar no duplica; un evento viejo no pisa | `projection_outbox.test.sql` (`already-processed`, `stale`) |
| Base de datos inalcanzable → borrador local visible | `mirroredList.test.ts`, `localDraftStore.test.ts` |
| Runner: un punto de recuperación no persistido detiene la ejecución (H07) | `OfficeEngagementRunner.test.ts` |
| Chunk que no llega o que se resuelve sin módulo | `lazyWithRetry.test.ts` (F6-04), y ahora `e2e/chunks.spec.ts` |

## 5. Rendimiento del pipeline

Medido en la ejecución de `ci.yml` sobre `main` tras #81:

| Trabajo | Duración |
|---|---:|
| Gates estáticos (typecheck, lint, presupuestos, build) | 97 s |
| Vitest, cuatro shards | 49–69 s cada uno |
| Cobertura unida | 23 s |
| Despliegue | 69 s |
| E2E (Playwright, 18 recorridos) | 5 min 19 s |

Para comparar: el paso único de pruebas llegó a 8 min 49 s antes de los shards.

## 6. Lo que queda, con propuesta

1. **La IA en el primer uso.** Ocho rutas descargan unos 600 KB gz de IA y ELK
   para un botón que quizá nadie pulse. La captura asistida y el asistente
   pueden cargar su servicio con `import()` al primer clic. La medida está
   lista y el gate impedirá que empeore.
2. **`save_chat_history` con revisión, o como anexión.** Necesita migración y
   aprobación. Candidata a F6-08.
