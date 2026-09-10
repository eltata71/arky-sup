# Plan — De monolito modular declarado a monolito modular dirigido por dominio

**Fecha:** 2026-09-02 · **Rama:** `claude/ddd-refactor-analysis-plan-ep26lz`
**Estado:** **Olas 1–5 ejecutadas.** §10 es la auditoría de cierre: cada promesa
del §2 contrastada contra el repositorio, incluidas las que no se cumplieron.

Este documento continúa donde terminó `docs/top-10-monolito-modular-ddd-2026-09-01.md`
y las cuatro olas que cerró el PR #231. Aquella entrega hizo lo primero que había
que hacer: **declarar** los módulos (`modules.json`), **defenderlos** con un gate
(`check:module-boundaries`), romper los cuatro ciclos entre contextos de dominio y
construir el primer agregado con invariante (`createArchitectureProject`).

Lo que queda no es más de lo mismo. La frontera existe pero está dibujada alrededor
de carpetas, no de dominios; y el modelo sigue siendo, en su mayor parte, **datos sin
comportamiento manipulados por servicios** — que es la definición de modelo anémico.

---

## 0. Línea base medida hoy

Todas las cifras salen de ejecutar los gates, no de leer el código.

| Medida | Valor | Comando |
|---|---|---|
| Suite | **3 423 pasando, 59 skipped, 380 ficheros** | `npm run test:ci` |
| Fronteras | **OK** contra el presupuesto grabado | `npm run check:module-boundaries` |
| Tamaño de módulo | **OK** | `npm run check:module-size` |
| `any` | **23 / 23** (16 en `geminiService.ts`) | `npm run check:any-budget` |
| Ciclos entre módulos | **14** | presupuesto grabado |
| Imports que apuntan hacia arriba | **3 pares / 5 imports** | presupuesto grabado |
| Imports que atraviesan un `index.ts` | **63 pares / 290 imports** | presupuesto grabado |
| Pantallas por encima del fan-out | **12** (máximo: 8) | presupuesto grabado |
| Módulos en la frontera estricta | **22 entradas** | `tsconfig.strict.json` |

**El gate está verde y el problema sigue ahí.** Eso es exactamente lo que un
presupuesto monótono debe hacer: detener la hemorragia sin fingir que la herida
está cerrada. El trabajo pendiente es bajar los números, no volver a medirlos.

---

## 1. Hallazgos

### A. Modularidad — la frontera está dibujada, pero rodea carpetas

**A1 · La raíz de `services/` sigue siendo el mayor módulo del repositorio, y no es un módulo.**

20 ficheros sueltos, **9 923 líneas**, que `modules.json` agrupa bajo la etiqueta
`services (raíz)` precisamente porque no pertenecen a ninguna parte:

```
5 498  geminiService.ts              1 379  firestoreService.ts
  377  guidedProjectCreationService     296  runtimeValidation.ts
  284  trainingService.ts               284  geminiModels.ts
  282  artifactGenerationPipeline       243  aiCallControlService.ts
  223  lucidService.ts                  212  artifactReviewService.ts
  204  userProvisioningService.ts       166  authService.ts
  105  artifactClassificationService     95  artifactGovernanceService.ts
   89  userService.ts                    55  artifactExportService.ts
   52  artifactValidationService.ts      36  contextBudgetService.ts
   27  aiProvider.ts                     16  openRouterApiKey.ts
```

Este pseudo-módulo es la causa directa de:

- **9 de los 14 ciclos** (`services (raíz) <-> agent | ai | architectureOffice |
  artifacts | businessInitiatives | chat | export | quality`, más `lib` y `utils`),
- **los 3 pares de imports hacia arriba** (`lib -> services (raíz)`,
  `utils -> services (raíz)`, `lib -> services/export`),
- **60 de los 290 imports profundos**.

No hay que refactorizar nada para arreglar la mayor parte: hay que **mover 18 de
esos ficheros al módulo cuyo lenguaje ya hablan**. Los otros dos son proyecto propio.

**A2 · 290 imports atraviesan un `index.ts`, y 165 (57 %) vienen de la capa de UI.**

| Origen | Imports profundos |
|---|---|
| `components` / `pages` / `hooks` / `context` | **165** |
| `services (raíz)` | 60 |
| dominio → dominio | 65 |

`components -> services/architectureOffice` son 47 por sí solos;
`components -> services/diagram`, 24. Una pantalla que entra 47 veces por debajo
de la puerta de un contexto **no está usando ese contexto: lo está reimplementando**.

**A3 · No existe capa de aplicación, y las pantallas ocupan su lugar.**

12 pantallas superan el límite de fan-out. `ArtifactCanvas.tsx` importa de **8
módulos de servicio** — IA, diagrama, observabilidad, validación, calidad,
compilador, revisión, artefactos — y decide entre dos ramas de JSX qué política de
compilación, validación, calidad, revisión y exportación se aplica. Ese fichero *es*
la capa de aplicación del workspace, escrita en un componente de React.

### B. DDD — el modelo es anémico salvo en un agregado

**B1 · Un agregado de cuatro tiene fábrica con invariantes.**

`createArchitectureProject` es el modelo a seguir: se niega a construir un proyecto
sin iniciativa y devuelve un rechazo tipado. Los otros tres se construyen con
literales de objeto **dentro de contextos de React**:

- `context/OfficeContext.tsx:274` construye un `OfficeEngagement` completo. El caso
  de uso `createEngagement` ocupa ~60 líneas dentro de un `useCallback` y hace, en
  este orden: buscar el proyecto (repositorio), planificar el charter, refinarlo con
  IA (orquestación), construir el agregado con sus invariantes (dominio), heredar
  iniciativas del padre (regla de negocio), escribir dos entradas de auditoría
  (dominio) y persistir. Ninguna de esas reglas es verificable sin montar React.
- `context/InitiativeContext.tsx:158` construye un `BusinessInitiative` igual.
- `runEngagementNow` comprueba la invariante «el charter debe aprobarse antes de
  ejecutar» **en el componente**, no en el agregado.

Es literalmente el defecto que `CLAUDE.md` ya documenta para `addProject` —
«la regla se cumplía sólo porque los dos llamadores pasaban por la puerta correcta»—
sin corregir en los otros tres agregados.

**B2 · `firestoreService.ts` es un monolito de persistencia compartido por seis contextos.**

Los seis repositorios (`architectureProjects`, `artifacts`, `businessInitiatives`,
`architectureOffice`, `chat`, `agent`) delegan en él, y además **cinco hooks de
`context/app/` lo llaman directamente**, saltándose el repositorio de su propio
contexto (`useAppBootstrap`, `useArtifactsState`, `useSettingsState`,
`usePersistenceReporter`, y `utils.ts`).

Consecuencia medible: **ningún repositorio puede entrar en la frontera estricta**,
porque `tsc` comprueba el cierre transitivo y este fichero tiene 57 errores bajo
`strict`. La frontera estricta está bloqueada por un solo fichero.

**B3 · El núcleo compartido todavía contiene un agregado.**

`types.ts` (533 líneas) sigue declarando `Artifact` **y todo su vocabulario de
traza de generación** — `ArtifactGenerationTrace`, `…Stage`, `…PhaseEvent`,
`…ModelEffective`, `…GraphUsage`: unas 150 líneas que pertenecen a
`services/artifacts` y que hoy cualquier módulo puede importar sin pedir permiso.
Un *shared kernel* debe ser pequeño e inerte; éste contiene el ciclo de vida de
una generación de IA.

**B4 · Sin objetos de valor: obsesión por primitivos en todas las claves del dominio.**

Cada id es `string`. El código `NEG-YYYY-NNN` — la clave de negocio que la gente
cita en un comité— es `string`. Nada impide pasar un `initiativeId` donde se espera
un `projectId`: el compilador no distingue las cuatro claves del portafolio.
Además `BUSINESS_PROJECT_ID_PATTERN` vive en `services/architectureOffice/officeShared.ts`,
cuando el concepto pertenece a `businessInitiatives`.

**B5 · El lenguaje ubicuo se detiene en la capa de etiquetas.**

`lib/eaTerminology.ts` fija los nombres para la UI y lo hace bien. Pero el mismo
agregado tiene **tres nombres**: el tipo es `Project`, la UI dice «Proyecto de
Arquitectura», y el código de UI y de dominio dice `Attention`
(`components/attentions/`, `AttentionInitiativeGate`, `useCreateAttention`,
`ProjectAttentionTracking`, `portfolioResolver`). 113 apariciones. En DDD el
lenguaje ubicuo *es* el modelo; si el modelo tiene tres nombres, las conversaciones
sobre él tendrán tres significados.

**B6 · Sin eventos de dominio.**

Lo que ocurre en un agregado se registra a mano en cada punto de llamada
(`withAuditEntry(withAuditEntry(engagement, …), …)`). Un hecho de dominio que hay
que acordarse de escribir es un hecho de dominio que algún día no se escribirá.

### C. Calidad y mantenibilidad

**C1 · La frontera estricta está bloqueada** (ver B2): 22 entradas, y las que faltan
son precisamente los repositorios.
**C2 · `any`: 23**, de los cuales 16 en `geminiService.ts` — se van con él.
**C3 · Ficheros de UI grandes** que no tienen gate de contenido, sólo de tamaño:
`ReactFlowCanvas.tsx` 1 946, `ArtifactCanvas.tsx` 1 124, `ProjectHub.tsx` 1 068,
`MemoryCenterModal.tsx` 1 057, `ProjectsPage.tsx` 923.

---

## 2. El plan — cinco olas

Cada ola es **independientemente entregable**, termina con `npm run quality` en
verde, y **baja un número grabado**. Ninguna ola depende de que se aprueben las
siguientes.

### Ola 1 — Vaciar la raíz de `services/` *(riesgo bajo · alto rendimiento)*

Mover 18 de los 20 ficheros sueltos al módulo cuyo dominio ya habla. Son movimientos
de fichero más el `index.ts` correspondiente, sin cambiar lógica.

| Fichero | Destino |
|---|---|
| `aiCallControlService`, `aiProvider`, `geminiModels`, `openRouterApiKey` | `services/ai` |
| `artifactGenerationPipeline`, `artifactClassificationService`, `artifactGovernanceService` | `services/artifacts` |
| `artifactReviewService` | `services/review` |
| `artifactValidationService` | `services/artifactCompiler` |
| `artifactExportService` | `services/export` |
| `contextBudgetService` | `services/contextGraph` |
| `authService`, `userService`, `userProvisioningService` | **`services/identity`** (módulo nuevo) |
| `trainingService` | **`services/learning`** (módulo nuevo) |
| `lucidService` | **`services/lucid`** (módulo nuevo) |
| `guidedProjectCreationService` | `services/architectureProjects` |
| `runtimeValidation` | se parte: reglas puras a `lib/validation`, la parte que toca Firestore a `services/persistence` |

Quedan **dos** en la raíz: `geminiService.ts` (interno de `services/ai`, se mueve en
la ola 5) y `firestoreService.ts` (ola 2).

**Nuevo gate:** `SERVICES_ROOT_BUDGET` — número de ficheros permitidos en la raíz de
`services/`, monótono, 20 → 3.

**Resultado esperado:** ciclos **14 → 5**; imports hacia arriba **3 pares → 0**;
imports profundos ≈ **290 → 235**.

**Resultado real:** ver §5. Los imports ascendentes llegaron a 0 como se esperaba;
los ciclos bajaron a 9 y no a 5, porque cinco de ellos son de `firestoreService`
y `geminiService`, que son las olas 2 y 5.

---

### Ola 2 — Partir `firestoreService.ts` por contexto *(riesgo medio · desbloquea la frontera estricta)*

1. Cada repositorio deja de delegar y **posee su propio mapeo Firestore** sobre
   `services/persistence` (que ya tiene `PersistenceResult`, la clasificación de
   errores y `writeLocalDraft`).
2. Los cinco hooks de `context/app/` y `utils.ts` dejan de importar
   `firestoreService` y llaman al **repositorio de su contexto**. Un contexto de
   React no debe conocer la forma de un documento.
3. Los mapeos compartidos (`sanitizeForFirestore`, la clasificación de errores de
   seguridad, `PermissionDeniedError`) bajan a `services/persistence`.
4. `firestoreService.ts` se borra.
5. **Se enrolan los seis repositorios en `tsconfig.strict.json`.**

`firestore.rules` no cambia (las rutas son las mismas), pero se ejecuta
`npm run test:rules` contra el emulador antes y después, porque este cambio toca
todos los caminos de escritura.

**Resultado esperado:** frontera estricta **22 → ~28 entradas**;
`services (raíz)` desaparece del grafo; ciclos **5 → 0**.

---

### Ola 3 — Agregados, invariantes y objetos de valor *(el corazón DDD)*

1. **Tres fábricas nuevas**, calcadas de `createArchitectureProject`, cada una con
   rechazo tipado y prueba unitaria sin React:
   - `createOfficeEngagement` — exige proyecto e iniciativas, hereda del padre,
     emite las entradas de auditoría de creación.
   - `createBusinessInitiative`.
   - `createArtifact` — hoy no hay ningún punto único de construcción.
2. **Las transiciones de estado se mueven al dominio.** `runEngagementNow`,
   `approveCharter` y las comprobaciones equivalentes de artefactos pasan a ser
   funciones puras del tipo `reviewTransitions.ts`, que ya es el patrón correcto
   en este repositorio.
3. **Objetos de valor con tipos marcados** (`branded types`) en `lib/ids.ts`:
   `InitiativeId`, `ArchitectureProjectId`, `EngagementId`, `ArtifactId`, y
   `BusinessInitiativeCode` con su patrón `NEG-YYYY-NNN` movido a
   `services/businessInitiatives`, que es quien posee el concepto.
4. **El agregado `Artifact` sale de `types.ts`** hacia `services/artifacts`, junto
   con las ~150 líneas del vocabulario de traza. `types.ts` queda como núcleo
   compartido real: `Settings`, `MemoryEntry`, `AIConfig`, y poco más.

**Nuevo gate:** un test que falla si un literal de agregado se construye fuera de su
fábrica (mismo mecanismo que `__tests__/authz/noRoleStrings.test.ts`).

---

### Ola 4 — La capa de aplicación *(el número que más pesa en mantenibilidad)*

Introducir casos de uso explícitos —`services/<contexto>/application/`— que las
pantallas invocan **una vez**, y bajar el fan-out.

Orden por impacto medido:

1. `ArtifactCanvas.tsx` (8 módulos) → `artifactWorkspaceService`: compilar, validar,
   puntuar calidad, decidir exportabilidad y estado de revisión en un solo objeto de
   resultado que el canvas renderiza.
2. `ProjectCopilotChatModal.tsx` (5) → caso de uso de conversación.
3. Las cuatro pantallas de 4: `ArtifactInspectorPanel`, `ArtifactExportModal`,
   `AssistantPanel`, `InitiativesPage`, `ProjectsPage`, `Workspace`.
4. En paralelo, los 47 imports profundos `components -> services/architectureOffice`
   y los 24 de `services/diagram` se enrutan por su barrel **salvo los que
   `check:bundle-budget` rechace** — el conflicto barrel/bundle que `CLAUDE.md`
   documenta y que ya ha costado cuatro builds. Cada excepción se deja anotada como
   tal.

**Resultado esperado:** fan-out **máximo 8 → 4**, 12 pantallas → ~4;
imports profundos desde UI **165 → <90**.

---

### Ola 5 — Lenguaje ubicuo y eventos de dominio *(cierre)*

1. **Un nombre por agregado.** Se elige `ArchitectureProject` (el nombre del
   dominio, el que usa `eaTerminology`) y se renombra `Project` →
   `ArchitectureProject` y `Attention*` → `ArchitectureProject*` en dominio y UI,
   con `lib/eaTerminology.ts` como única fuente de las etiquetas. Es un renombrado
   mecánico grande (113 apariciones) y por eso va al final, cuando ya no se está
   moviendo nada más.
2. **Eventos de dominio.** `withAuditEntry` a mano se sustituye por eventos que las
   fábricas y transiciones de la ola 3 emiten: el rastro de auditoría pasa a ser
   consecuencia del cambio de estado, no una llamada que hay que recordar.
3. **`geminiService.ts` entra en `services/ai/`** como motor interno. Se lleva
   consigo los 16 `any`: presupuesto **23 → 7**.

---

## 3. Recomendación de alcance

Si hay que elegir, **las olas 1 y 2 son las que hay que hacer**: son las de mayor
relación resultado/riesgo, eliminan los 14 ciclos y los 3 imports hacia arriba, y
desbloquean la frontera estricta —que es el mecanismo con el que este repositorio
convierte «activar strict» en un hábito en vez de un proyecto.

La **ola 3** es la que hace que esto sea DDD y no sólo carpetas ordenadas.

La **ola 4** es la que más mejora la mantenibilidad percibida y la más laboriosa;
puede hacerse pantalla a pantalla durante meses sin bloquear nada.

La **ola 5** es cosmética en riesgo pero grande en diff: conviene hacerla sola.

## 4. Garantías en cada ola

- `npm run quality` en verde antes de cada commit (es exactamente lo que ejecuta CI).
- Ningún test se salta, desactiva ni borra para poner la suite en verde.
- Todo presupuesto grabado **baja o se mantiene**; si alguno sube, la razón va en el
  mensaje de commit.
- `firestore.rules` se actualiza en el mismo cambio que cualquier ruta o forma de
  documento, y `npm run test:rules` se ejecuta en la ola 2.
- `CLAUDE.md`, `AGENTS.md` y `modules.json` se actualizan en la misma ola que
  describe el cambio.


---

## 5. Ola 1 — ejecutada el 2026-09-02

Tres commits, cada uno con `npm run quality` en verde.

| Medida | Antes | Después |
|---|---|---|
| Ficheros sueltos en `services/` | 20 (9 923 líneas) | **3** |
| Ciclos entre módulos | 14 | **9** |
| Imports hacia arriba | 3 pares / 5 imports | **0** |
| Imports que atraviesan un `index.ts` | 63 pares / 290 | 60 pares / **277** |
| Pantallas sobre el fan-out | 12 (máx. 8) | **11** |
| Suite | 3 423 pasando | 3 423 pasando |
| Chunk inicial | 660,3 KB gz | **660,3 KB gz** |

### Lo que se movió

| Destino | Qué |
|---|---|
| **`services/identity`** (nuevo) | `authService`, `userService`, `userProvisioningService` |
| **`services/learning`** (nuevo) | `trainingService` |
| **`services/lucid`** (nuevo) | `lucidService` |
| `services/ai` | `aiProvider` → `providers/gemini/geminiClient`, `openRouterApiKey`, `aiCallControlService` y `contextBudgetService` → `callControl/`, `guidedProjectCreationService` → `generation/` |
| `services/review` | `artifactReviewService` |
| `services/export` | `artifactValidationService` → `artifactExportValidation`, `artifactExportService` → `artifactExportPayload` |
| `services/artifacts` | `artifactGenerationPipeline` |
| **`lib/ai`** (nuevo) | `geminiModels` → `modelCatalog` |
| `lib/artifacts` | `artifactClassificationService` → `artifactClassification`, `artifactGovernanceService` → `artifactGovernance`, el vocabulario del pipeline y cinco declaraciones de exportación |
| *(borrado)* | `lib/validation/` — reexportador muerto |

### Tres sitios donde el gate corrigió el plan

El plan de §2 decía «movimientos de fichero, sin cambiar lógica». En tres casos
eso habría sido un error, y `check:module-boundaries` lo dijo antes de que se
consolidara:

1. **`geminiModels` no cabe en `services/ai`.** Puesto ahí, cuatro pares nuevos
   y un ciclo `ai <-> chat`: cinco contextos necesitan resolver qué modelo
   implica un `Settings`, y tenerlo dentro de la capa de IA la convertía en
   dependencia de todos ellos. Bajó a `lib/ai/modelCatalog` — inerte, una sola
   dependencia, todo el mundo lo importa hacia abajo.
2. **`runtimeValidation` no es persistencia.** Llevarlo a `services/persistence`
   creó un ciclo con la Oficina de Arquitectura, porque conoce cuatro contextos
   de dominio. Se quedó en la raíz: su sitio lo decide la Ola 2, cuando se parta
   `firestoreService`, que es su único llamador. Colocarlo mal habría sido peor
   que dejarlo donde estaba.
3. **`guidedProjectCreationService` no es de `architectureProjects`.** Llama a
   `aiGateway`, compone prompts y parsea JSON: es una fachada de generación.
   Está en `services/ai/generation/` con las otras seis. `contextBudgetService`,
   por lo mismo, es de `callControl` y no de `contextGraph`: presupuesta el
   payload de una llamada, no el grafo de contexto de un proyecto.

### Dos hallazgos que no eran movimientos

- **`lib/validation/` era código muerto y causaba dos de las tres violaciones de
  capa.** Un reexportador que subía a `services/` para republicar tipos de
  dominio bajo nombres de `lib/`, y al que **no importaba ningún fichero del
  repositorio, ni siquiera una prueba**. Borrado.
- **`isDiagramFormat` / `isTabularFormat` estaban duplicadas** con dos
  implementaciones distintas: la de `exportRegistry` pregunta a
  `EXPORT_DEFINITIONS`, la de `artifactValidationService` llevaba la lista de
  formatos escrita a mano. Coincidían hoy y no las importaba nadie, pero eran
  una deriva esperando a que se añadiera un formato. Queda la del registro.

### Lo que queda en la raíz, y por qué

`firestoreService.ts` (Ola 2), `geminiService.ts` (Ola 5) y `runtimeValidation.ts`
(Ola 2, con `firestoreService`). `SERVICES_ROOT_BUDGET = 3` lo fija: el número
puede bajar y no puede subir.


---

## 6. Ola 2 — ejecutada el 2026-09-02

`services/firestoreService.ts` ya no existe. Sus 1 379 líneas guardaban siete
contextos; cada uno tiene ahora su adaptador sobre `services/persistence`.

| Medida | Antes de la Ola 2 | Después |
|---|---|---|
| Ciclos entre módulos | 9 | **4** — y ninguno entre contextos de dominio |
| Imports hacia arriba | 0 | 0 |
| Imports que atraviesan un `index.ts` | 60 pares / 277 | 61 pares / **275** |
| Módulos en la frontera estricta | 22 entradas | **27** |
| Ficheros sueltos en `services/` | 3 | **2** |
| Suite | 3 423 | **3 434** (11 pruebas nuevas) |
| Reglas contra el emulador | — | **59 pasando** |
| Chunk inicial | 660,3 KB gz | 660,8 KB gz |

Los cuatro ciclos que quedan son tres de la forma normal de React
(`components ↔ context`, `components ↔ hooks`, `context ↔ hooks`) y
`services (raíz) ↔ services/ai`, que es `geminiService` — la Ola 5.

### Cómo quedó repartido

| Contexto | Su adaptador |
|---|---|
| Proyectos de Arquitectura | `projectReads.ts`, `projectWrites.ts`, `projectCache.ts`, `projectDocumentMapper.ts`, `artifactDocumentMapper.ts` |
| Artefactos | `artifactPersistence.ts` |
| Chat | `ChatHistoryRepository.ts` + `chatHistoryCap.ts` |
| Agente | `AgentActionRepository.ts` |
| Oficina de Arquitectura | `OfficeEngagementRepository.ts` |
| Iniciativas de negocio | `BusinessInitiativeRepository.ts` |
| **Ajustes** | **`services/settings`, módulo nuevo** |

Ajustes era el único de los siete contextos sin repositorio, y por eso
`context/app/` llamaba al monolito directamente: sin puerta a la que llamar, la
UI llamaba a la base de datos.

`services/persistence` gana dos piezas compartidas: `collectionPaths.ts` —los
segmentos de ruta escritos una sola vez, espejo de `firestore.rules`— y
`MirroredList`, el patrón «caché, Firestore, espejo local» que estaba escrito
cinco veces con diferencias que no eran decisiones. Repartir el fichero sin
extraerlo habría convertido cinco copias en seis, cada una en un módulo
distinto y ya sin nadie que las viera juntas.

### Tres defectos que aparecieron al mover

1. **El espejo local era de sólo escritura.** `writeLocalDraft` guardaba en
   `arky.offlineDraft.{k}` envolviendo el valor; `readLocal` leía `{k}` en
   crudo. Nunca coincidían, así que cada `readLocal(...) ?? []` del producto
   devolvía la lista vacía: la degradación que esta capa existe para dar
   guardaba el trabajo del usuario y luego no era capaz de enseñárselo. Venía
   de los dos métodos privados de `firestoreService`, y la prueba que lo cubría
   escribía la clave en crudo igual que el lector, así que no lo detectó nadie.
   Corregido de forma compatible: mira primero el borrador, después la clave
   antigua.
2. **`db` es `Firestore | null` y ningún repositorio lo asumía.** El `strict`
   lo dijo en cuanto entraron. En escritura no dolía porque
   `executeRemoteWrite` comprueba antes; en **lectura** `doc(null, …)` lanzaba
   un `TypeError` que el `catch` convertía en «no se pudo leer», ocultando que
   la causa era configuración ausente y no la red. Ahora hay `requireDb`.
3. **`Project['artifactIndex'][number]` indexaba un array opcional.** Otro
   hallazgo del `strict`.

### Dos sitios donde el gate volvió a corregir el plan

- **`runtimeValidation` no es persistencia.** Llevarlo a `services/persistence`
  metió a la persistencia en un ciclo con la Oficina: conoce cuatro contextos de
  dominio. Se queda en la raíz; su sitio se decide cuando alguien decida a qué
  contexto pertenece de verdad.
- **El mapeo de un artefacto a documento es del agregado Proyecto.** Ponerlo en
  `services/artifacts` creó un ciclo `architectureProjects ↔ artifacts`, porque
  `createProject` escribe los artefactos del proyecto entero mientras artefactos
  necesita el índice del proyecto. Está en `architectureProjects`, y la
  dirección es una sola: artefactos conoce proyectos, proyectos no conoce
  artefactos.

### Un comportamiento que se conservó a propósito

`ChatHistoryRepository.save` cachea los mensajes **sin compactar** aunque el
documento remoto guarde la versión compactada. Es lo que hacía
`firestoreService`. No es obviamente correcto —al caducar la caché el historial
se encoge a la vista del usuario— pero decidirlo es un cambio de comportamiento
y no cabe escondido dentro del reparto de un fichero de 1 379 líneas. Queda
anotado en el propio fichero.


---

## 7. Ola 3 — ejecutada el 2026-09-02

La ola que hace que esto sea DDD y no carpetas ordenadas.

| Medida | Antes | Después |
|---|---|---|
| Agregados con fábrica e invariantes | 1 de 4 | **4 de 4** |
| Agregados construidos dentro de React | 3 | **0** |
| `types.ts` | 533 líneas | **339** — deja de necesitar excepción de tamaño |
| Definiciones del código `NEG-YYYY-NNN` | 2 | **1**, y es un objeto de valor |
| Suite | 3 434 | **3 524** (42 pruebas nuevas) |
| Ciclos / imports ascendentes | 4 / 0 | 4 / 0 |
| Chunk inicial | 660,8 KB gz | 661,5 KB gz |

### Las cuatro fábricas

| Agregado | Fábrica | Qué rechaza |
|---|---|---|
| `Project` (atención) | `architectureProjectFactory` *(ya existía)* | sin nombre, sin iniciativa |
| `OfficeEngagement` | **`officeEngagementFactory`** | sin título, sin atención, sin vínculo a iniciativa |
| `BusinessInitiative` | **`businessInitiativeFactory`** | sin título, sin necesidad declarada, sin dueño |
| `Artifact` | **`artifactFactory`** | impone identidad y versionado en vez de rechazar |

Lo que se movió no es código: es la posibilidad de comprobarlo.
`createEngagement` era un `useCallback` de sesenta líneas que planificaba el
charter, llamaba al modelo, montaba el agregado, heredaba las iniciativas del
padre, escribía dos entradas de auditoría y persistía. Ninguna de esas reglas se
podía probar sin renderizar un proveedor de React. Ahora las 42 pruebas nuevas
corren sin DOM.

### El gate

`__tests__/services/aggregates/noAggregateLiterals.test.ts` falla si aparece un
`: Agregado = {` fuera de su fábrica. Hace falta un escáner porque el compilador
no puede ayudar: un literal de objeto satisface el tipo. Las propagaciones
(`{ ...engagement, status }`) se permiten a propósito — modificar un agregado
existente es lo que hacen las reglas de transición.

Se verificó que detecta: con un fichero sonda que declaraba un `OfficeEngagement`
en `components/`, el gate falló nombrándolo.

### Transiciones

`officeEngagementTransitions.ts` sigue el patrón de `reviewTransitions.ts`:
funciones puras del estado a un veredicto. Recoge la regla de gobierno de la
Oficina —*nadie ejecuta un charter sin aprobar*—, que vivía dentro de un
`useCallback` junto al `AbortController`.

### El objeto de valor

`NEG-YYYY-NNN` se validaba con **dos expresiones regulares idénticas**, en
`lib/eaTerminology.ts` y en `services/architectureOffice/officeShared.ts`. Ahora
es `BusinessInitiativeCode`, una cadena marcada con un único constructor
(`toInitiativeCode`) que normaliza antes de validar. Marcarla sacó 13 errores de
tipo, 3 en producción, y todos eran el caso que la marca existe para detectar.

`BusinessInitiative.code` quedó como `BusinessInitiativeCode | ''`: un código
malformado degrada a vacío, y la unión deja ese caso escrito en vez de fingir
que no existe.

**Los ids de entidad no se marcaron.** Habría tocado cada fixture de la suite
para prevenir una confusión que las fábricas ya evitan, y las cuatro claves del
portafolio se resuelven en un solo sitio. Es una decisión de alcance, no un
olvido.

### Una corrección durante la ejecución

La primera versión de `createOfficeEngagement` exigía `initiativeIds`. Las
pruebas de `OfficeContext` fallaron con un proyecto que sólo tenía el código
`NEG-`, sin ids — que es exactamente el registro heredado que
`portfolioResolver` migra de forma perezosa. La invariante correcta es «vínculo
por id **o** por código»: exigir el id habría convertido una migración correcta
y silenciosa en un error de cara al usuario.

### Un defecto más de `db` nulo

Al entrar `ArtifactTypes` en el cierre del `strict`, apareció
`services/review/firestoreArtifactReviewRepository.ts` con el mismo problema que
la Ola 2 corrigió en los demás repositorios: `doc(db, …)` con `db` posiblemente
nulo. Corregido con `requireDb`.


---

## 8. Ola 4 — primera pasada, ejecutada el 2026-09-02

La capa de aplicación no existía. Esta ola la construye y mueve a ella las
cuatro pantallas de mayor fan-out. **Es incremental por diseño**: el resto puede
hacerse pantalla a pantalla sin bloquear nada.

| Medida | Antes | Después |
|---|---|---|
| Fan-out máximo de una pantalla | 8 (`ArtifactCanvas`) | **5** |
| Imports profundos desde la UI | 168 | **157** |
| Imports profundos desde pantallas | 138 | **127** |
| Suite | 3 524 | **3 545** (21 pruebas nuevas) |
| Chunk inicial | 661,5 KB gz | 661,5 KB gz |

### Las pantallas

| Pantalla | Módulos de servicio |
|---|---|
| `ArtifactCanvas` | 8 → **5** |
| `ProjectCopilotChatModal` | 5 → **4** |
| `AssistantPanel` | 4 → **3** |
| `ArtifactExportModal` | 4 → **2** |

### Lo que se creó

- **`services/artifacts/application/artifactAssessment`** — la cadena de
  derivación del lienzo: calidad con posiciones reales, preflight, presentación
  compilada, formatos de exportación, exportabilidad y la puerta visual.
- **`hooks/artifacts/useArtifactAssessment`** — sólo las fronteras de
  memoización, con las mismas dependencias que tenía el componente.
- **`services/architectureOffice/application/assistantConsultation`** — qué sabe
  la Oficina de un proyecto al responder y quién firma la respuesta.
- **`hooks/useAgentMemoryStore`** — el adaptador de memoria del agente, que
  estaba escrito **dos veces línea por línea** con un comentario en cada copia
  diciendo que era «la misma forma que la otra».

### Por qué el servicio y el hook están separados

Era tentador exponer un `assessArtifact(todo)` que devolviera las seis cosas.
Habría sido más corto y peor: el lienzo memoiza cada etapa con sus propias
dependencias, y colapsarlas obligaría a recalcular `analyzeDiagramQuality` —lo
más caro que hace esa pantalla— cada vez que el usuario cambia de pestaña.
Modularidad a cambio de trabajo desperdiciado en cada clic no es buen trato.

Así que la composición se declara sin React, etapa a etapa, y el hook conserva
los arrays de dependencias exactos.

### Un número que sube, y por qué está bien

Sacar la orquestación de una pantalla mueve sus imports a la capa de dominio:
`components -> services/diagram` bajó de 24 a 20 mientras
`services/artifacts -> services/diagram` subió de 10 a 14. El total de imports
profundos apenas se mueve; lo que cambia es **dónde viven las decisiones**, y el
total desde la UI baja de 168 a 157.

### Una prueba que descubrió una regla

Al escribir las pruebas de `assessVisualGate` supuse que una puerta en estado
`ready` no enseña aviso. Falla: con `contentNodeCount: 0` el bloqueo duro
`EMPTY_DIAGRAM` se dispara igualmente, porque exportar cero nodos produce un
fichero vacío que parece un entregable. El código tenía razón; la prueba quedó
corregida y ese caso ahora está fijado.

### Lo que queda de la Ola 4

Siete pantallas siguen por encima del límite de dos, todas en 3 o 4:
`InitiativesPage`, `EngagementIntakeWizard`, `OfficeCapabilitiesPanel`,
`ArtifactInspectorPanel`, `DashboardPage`, `ProjectsPage`, `Workspace`. Ninguna
tiene la concentración de política que tenía el lienzo; son casos de tres o
cuatro capacidades legítimas, y bajarlas pide más juicio por pantalla que
mecánica.


---

## 9. Ola 5 — ejecutada el 2026-09-02

Esta ola entrega dos de sus tres partes y **descarta la tercera con razón
medida**. Conviene leer primero lo que no se hizo.

### Lo que el plan pedía y el gate refutó

**Mover `geminiService.ts` a `services/ai/` no rompe el último ciclo: lo
empeora.** El movimiento se hizo, se midió y se revirtió.

Reubicar el fichero no elimina sus dependencias. El motor alcanza *hacia arriba*
a ocho contextos de dominio para componer sus prompts —`agent`, `chat`,
`artifacts`, `architectureOffice`, `quality`, `contextGraph`,
`architectureKnowledgeGraph`, `review`— y cuatro de ellos importan
`services/ai` de vuelta. Al mover el fichero, el gate reportó exactamente eso:

```
cycle: services/agent <-> services/ai is new
cycle: services/ai <-> services/architectureOffice is new
cycle: services/ai <-> services/artifacts is new
cycle: services/ai <-> services/chat is new
```

Es decir: se cambia **un** ciclo registrado —`services (raíz) <-> services/ai`,
donde `services (raíz)` es por definición «los ficheros que no pertenecen a
ningún módulo»— por **cuatro ciclos entre contextos de dominio reales**. Eso es
justo lo que las Olas 1 y 2 gastaron su esfuerzo en eliminar, y lo que
`moduleBoundaries.test.ts` afirma por nombre.

El sitio del motor no es un movimiento: es la migración por estrangulamiento
siguiendo vertical a vertical, cortando cada dependencia ascendente antes.
`learningService` es el ejemplo de una vertical ya hecha.

**Y el presupuesto de `any` no baja por mover un fichero.** El plan decía
«se lleva consigo los 16 `any`: 23 → 7». Falso: mover código no borra sus
`any`. Bajarlos es trabajo de tipado sobre 5 498 líneas, no una reubicación.

### El renombrado del lenguaje ubicuo, también descartado

El plan pedía renombrar `Project` → `ArchitectureProject` y `Attention*`, 113
apariciones. Dos razones para no hacerlo, y las dos son datos:

1. **El repositorio ya lo había decidido.** `types.ts` dice, desde antes de este
   trabajo: «reexportado aquí porque 71 ficheros importan `Project` de este
   fichero y un renombrado de ese tamaño no compra nada».
2. **`attention` es un campo persistido de Firestore**
   (`projectDocumentMapper` lo escribe y lo lee). Renombrarlo es una migración
   de datos, no un renombrado.

Lo que sí era un defecto real y está corregido: el propio
`lib/eaTerminology.ts` —la fuente única del vocabulario— llevaba un ejemplo que
decía `Iniciativa › Atención › Entregable` mientras la constante de al lado
produce `Iniciativa › Proyecto › Entregable`. Un ejemplo que contradice a su
propia constante es la forma más barata de que el vocabulario se bifurque.

### Lo que sí se entregó

**Un cambio de estado lleva su propio motivo.** Eran dos pasos que resultaban
estar juntos:

```ts
engagement = { ...engagement, status: 'blocked' };
engagement = withAuditEntry(engagement, 'engagement-blocked', '…');
```

Dos pasos adyacentes no son uno. `transitionEngagement` los une, y el escáner
`officeEngagementTransitions.gate.test.ts` impide que vuelvan a separarse —el
compilador no puede, porque una propagación con `status` satisface el tipo igual
de bien—. **El gate encontró un sitio que la reescritura se había saltado**, y
el defecto que motivó todo esto era real: el arranque del runner cambiaba a
`in-progress` y el `run-started` llegaba dos líneas después.

**Un import dinámico se saltaba la regla del motor.**
`services/artifacts/artifactBriefExtractionService` hacía
`await import('../geminiService')`: `no-restricted-imports` no ve los imports
dinámicos, así que la regla «nadie fuera de `services/ai` toca el motor» se
cumplía en todas partes menos ahí, en silencio. Ahora entra por
`artifactGenerationService`, la fachada, y sigue siendo diferido.

| Medida | Antes | Después |
|---|---|---|
| Suite | 3 545 | **3 550** (5 pruebas nuevas) |
| Ciclos / imports ascendentes | 4 / 0 | 4 / 0 |
| Chunk inicial | 661,5 KB gz | 661,5 KB gz |

### Lo que queda, y es honesto decirlo

`services/geminiService.ts` sigue en la raíz con sus 5 498 líneas y sus 16
`any`. Sacarlo es la migración por estrangulamiento, vertical a vertical, y es
una ola entera —o varias— por sí misma. El presupuesto
`SERVICES_ROOT_BUDGET = 2` lo tiene contado.


---

## 10. Auditoría de cierre — 2026-09-02

Cada promesa del §2 contrastada contra el repositorio, medida y no afirmada.
Las tres columnas que importan son la última: qué queda y por qué.

### Ola 1 — vaciar la raíz de `services/`

| Promesa | Estado |
|---|---|
| 18 ficheros a su módulo | ✅ **19**. La raíz pasó de 20 ficheros a **1** |
| Módulos nuevos `identity`, `learning`, `lucid` | ✅ |
| Gate `SERVICES_ROOT_BUDGET` | ✅ hoy vale **1** |
| Partir `runtimeValidation` | ✅ **cerrado en esta auditoría** (ver abajo) |
| Ciclos 14 → 5 | ⚠️ llegó a 9 en la Ola 1; hoy son **4** |
| Imports ascendentes 3 pares → 0 | ✅ |

**`runtimeValidation` quedaba pendiente desde la Ola 1 y se cierra ahora.** El
plan decía partirlo entre `lib/validation` y `services/persistence`. La Ola 2
intentó lo segundo y el gate lo rechazó —metía a la persistencia en un ciclo con
la Oficina— y se dejó en la raíz con la nota de que su sitio se decidiría al
partir `firestoreService`.

Ya partido, la respuesta la dio el reparto: sus **dos únicos llamadores** son
`projectReads` y `projectDocumentMapper`, los dos de `services/architectureProjects`.
No era código compartido; era código de ese agregado guardado fuera porque el
monolito de persistencia lo llamaba. Es `projectRuntimeValidation.ts` y los tres
pares que arrastra ya estaban registrados desde ese módulo, así que no añade
acoplamiento: lo reatribuye a quien lo tiene.

### Ola 2 — partir `firestoreService`

| Promesa | Estado |
|---|---|
| Cada repositorio posee su mapeo | ✅ |
| `context/app/` deja de importar el monolito | ✅ |
| Mapeos compartidos a `services/persistence` | ✅ + `collectionPaths` y `MirroredList` |
| `firestoreService.ts` borrado | ✅ |
| Enrolar **los seis** repositorios en strict | ⚠️ **parcial y bloqueado** |
| Frontera estricta 22 → ~28 | ✅ **27** |

**Los repositorios de chat y agente siguen fuera del `strict`, y seguirán
mientras el motor no se mueva.** Llegan al barril de `services/ai` vía
`chatCompactor` y `agentTypes`, y un barril es el módulo entero, `geminiService`
incluido. No es un olvido: es la misma dependencia que bloquea la Ola 5.

### Ola 3 — agregados, invariantes y objetos de valor

| Promesa | Estado |
|---|---|
| Tres fábricas nuevas | ✅ 4 de 4 agregados con fábrica |
| Transiciones al dominio | ✅ + `transitionEngagement` en la Ola 5 |
| Marcar `InitiativeId`, `ProjectId`, `EngagementId`, `ArtifactId` | ❌ **descartado con razón** |
| `NEG-YYYY-NNN` como objeto de valor | ✅ (en `lib/eaTerminology`, no en `businessInitiatives`) |
| `Artifact` fuera de `types.ts` | ✅ 533 → 339 líneas |
| Gate de literales de agregado | ✅ y verificado con una sonda |

**Los ids de entidad no se marcaron**, y la razón está en §7: habría tocado cada
fixture de la suite para prevenir una confusión que las fábricas ya evitan, y
las cuatro claves del portafolio se resuelven en un único sitio. El código
`NEG-YYYY-NNN` sí se marcó porque lleva formato y estaba definido dos veces.

Desviación menor: el patrón acabó en `lib/eaTerminology` y no en
`services/businessInitiatives`. Es donde vive el vocabulario del producto y
`officeShared` lo reexporta, así que la fuente sigue siendo una.

### Ola 4 — la capa de aplicación

| Promesa | Estado |
|---|---|
| `ArtifactCanvas` 8 → | ⚠️ **5** (objetivo 4) |
| `ProjectCopilotChatModal` 5 → | ✅ **4** |
| `ArtifactExportModal`, `AssistantPanel` | ✅ **2** y **3** |
| `ArtifactInspectorPanel`, `InitiativesPage`, `ProjectsPage`, `Workspace` | ❌ siguen en 3–4 |
| Enrutar los 47 imports profundos de la Oficina por barril | ❌ no hecho |
| Fan-out máx. 8 → 4, 12 pantallas → ~4 | ⚠️ **máx. 5**, **11 pantallas** |
| Imports profundos desde la UI → <90 | ❌ **157** (eran 168) |

Es la ola que menos cumplió su estimación, y la estimación era optimista. Lo
entregado es real —la capa de aplicación existe y las cuatro peores pantallas la
usan— pero «<90 imports desde la UI» pedía varias pasadas más.

**En esta auditoría se cerró una duplicación más**: cinco pantallas construían
el `CoordinationScope` a mano, y la regla de nombrar una iniciativa
(`NEG-… · título`) estaba escrita **tres veces**. Ahora vive en
`assistantConsultation`. No baja el fan-out —es el mismo módulo— pero saca
política de tres ficheros cuyo trabajo es pintar.

Y deja a la vista una divergencia que **no se ha unificado a propósito**: el
copiloto y el hub de proyecto le cuentan a la Oficina cosas distintas del mismo
proyecto (el hub incluye los artefactos existentes; el copiloto no). Cambiar lo
que viaja en un prompt cambia lo que responde el modelo, así que va en su propio
commit. Queda escrito en el código y pinchado por una prueba.

### Ola 5 — lenguaje ubicuo y eventos de dominio

| Promesa | Estado |
|---|---|
| Renombrar `Project` → `ArchitectureProject` | ❌ **refutado** — decisión previa del repo + campo persistido |
| Eventos de dominio | ✅ `transitionEngagement` + su gate |
| `geminiService` a `services/ai` | ❌ **refutado por el gate** — 4 ciclos nuevos entre dominios |
| `any` 23 → 7 | ❌ imposible por reubicación; es trabajo de tipado |

### Lo que queda abierto, en orden de valor

1. **Sacar `geminiService` de la raíz** — vertical a vertical, cortando cada
   dependencia ascendente antes de mover. Desbloquea de paso los dos
   repositorios que faltan en el `strict` y los 16 `any`. Es una ola entera.
2. **Seguir bajando el fan-out** — siete pantallas en 3–4, ninguna con la
   concentración que tenía el lienzo. Pantalla a pantalla, sin bloquear nada.
3. **Decidir la divergencia de los briefings** del copiloto y el hub.
4. **Decidir el caché de chat sin compactar** (§6), anotado desde la Ola 2.
