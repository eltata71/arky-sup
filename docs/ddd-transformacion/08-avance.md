# Registro de avance y punto de reanudación

**Última actualización:** 2026-09-23
**Estado integrado:** Fase 2 completa, **fases 3 y 4 cerradas** (`09-cierre-fase-3.md`, `10-cierre-fase-4.md`) y **fase 5 en curso**, todo en `main` y publicado por CI en el destino canónico `arky-sup`.
**Producción:** `https://arky-sup.vercel.app` · contrato: `docs/operacion/contrato-despliegue.md`

---

## Punto de reanudación

- **Última tarea completada:** **F4-05 y F4-06** — la coordinación de
  artefactos sale de React a `services/artifacts/application/` (el hook y cuatro
  pantallas dejan de decidir; fan-out 10 → 6) y `api.save_project_aggregate` se
  retira: el Proyecto tiene una sola ruta de escritura. Antes: **F4-07 y F4-04**
  (#53) — la revisión del proyecto
  viaja con el registro (sin mapa global ni fuga al contrato público) y el
  Proyecto se separa en raíz (`ProjectRoot`), documento persistido y modelo de
  lectura (`Project`). Antes: **cierre de la fase 3** — F3-03 (dependencias
  declaradas), F3-04 (presupuestos con objetivo y fecha), F3-05 (Iniciativas como
  contexto piloto) y F3-06 (puertas pequeñas). Ver `09-cierre-fase-3.md`. Antes:
  F3-07 (#51), F4-03 (#50), F4-02 (#49), F4-01 (#48).
- **Aviso que este arreglo deja escrito:** la PR #42 se fusionó con la suite E2E
  en rojo —cinco ejecuciones fallidas seguidas en `feat/fase-2-consistencia-reanudacion`—
  y la PR siguiente heredó el rojo. El gate funcionó: detectó que F2-03 había
  dejado un fixture que ya no podía existir. Lo que falló fue leerlo.
- **Estado de la tanda anterior:** integrada en `main` y publicada por CI. Las
  cuatro PR de esta tanda: **#43** (contrato del destino Vercel + el fixture E2E
  de dos identidades), **#44** (F3-02, alcance del verificador), **#45** (F3-07
  parcial, F3-08 y la elegibilidad del comité) y **#46** (tres presupuestos
  fijados en lo medido).
- **Siguiente paso exacto:** fase 5 — **F5-01** (romper
  `services/ai -> services (raíz)`, vertical a vertical, con el patrón de
  `learningService`). Las seis pantallas que siguen sobre el fan-out son de
  **F5-02**. Pendiente de decisión del propietario: aplicar la migración de
  F4-06 a `ArkyDB-US` (`supabase db push`).
- **Despliegue verificado:** CI publicó el commit `6f7c418` en `arky-sup`; usar el alias estable `https://arky-sup.vercel.app`.
- **Verificaciones previas a la integración:**
  1. **Test focalizados de arquitectura Office y agente** — 75 pruebas en verde (OfficeEngagementRunner, agentExecutor, supabaseFileStorage, rpcSurface, OfficeContext).
  2. **Contratos pgTAP contra PostgreSQL 16 nativo** — `decide_engagement_atomic` (24/24), `office_engagement_transitions` (6/6).
  3. **Lint, module-boundaries, any-budget** — todos en verde.
  4. **Module-size** — `OfficeEngagementRunner.ts` quedó bajo los techos por defecto tras extraer `officeRunResumption`, `officeRunnerState` y `officeRunnerContracts`; `agentExecutor.ts` también quedó por debajo, y su techo se fijó en 988 el 2026-09-22.
  5. **Typecheck** — OOM en el proceso completo (heap 2 GiB); validación focalizada pasó con las pruebas. Se documenta la limitación del entorno.
- **Bloqueos resueltos:** F2-03 decisión de negocio adoptada (opción C, ADR-101). No quedan bloqueos de negocio en Fase 2.

---

## Fase 1 — completada

| Tarea | Estado | Evidencia |
|---|---|---|
| F1-01 línea base | ✅ | `00-linea-base.md` |
| F1-02 grafo y SCC | ✅ | `evidencias/scc-linea-base.md` |
| F1-03 hallazgos | ✅ | `01-hallazgos.md` |
| F1-04 propiedad de datos | ✅ | `06-propiedad-datos.md` |
| F1-05 lenguaje ubicuo | ✅ | `04-lenguaje-ubicuo.md`, ADR-100 |
| F1-06 invariantes | ✅ | `07-invariantes.md` |
| F1-07 mapa de contextos | ✅ | `05-mapa-contextos.md` |
| F1-08 ADR | ✅ | `adr/ADR-100`…`104` |
| F1-09 backlog | ✅ | `03-backlog.md` |

### Resultado de la fase

- **10 hallazgos confirmados, 2 parciales, 0 descartados.** Todos con evidencia estática salvo H03, reproducido.
- **El hallazgo más grave no estaba en la lista de doce**: la separación autor/aprobador no está relajada, es **estructuralmente imposible** porque `owner_id` es a la vez autor y frontera de autorización (ADR-101).
- **33 invariantes catalogadas; 8 sin ninguna autoridad efectiva.**
- **Tres cifras de `CLAUDE.md` estaban desactualizadas** — suite, bundle y ciclos. La línea base es la autoridad.

---

## Fase 2 — completada

| Tarea | Estado | Evidencia |
|---|---|---|
| **F2-01** decisión ARB atómica | ✅ | Migración `20260920213000_reject_arb_decision_id_collisions.sql` + contrato pgTAP `decide_engagement_atomic.test.sql` (24/24). Colisión global de ID aborta la transacción; idempotencia de reintento preservada. |
| **F2-02** guardas de servidor | ✅ | Función `private.office_engagement_transition_allowed` con matriz cerrada (18/64 pares). `save_engagement` rechaza `delivered`; `decide_engagement` es la única puerta. Pruebas pgTAP 6/6. |
| **F2-03** separación autor/aprobador | ✅ | Opción C adoptada: `arb:decide` concede bandeja global (`api.load_arb_engagements`), prohibe autoaprobación aunque el autor tenga el permiso, y el revisor no puede alterar título/charter/tareas/presupuesto. La evidencia inmutable de la decisión se canoniza en servidor (perfil activo, fila bloqueada, gates persistidos y `now()`); el contrato pgTAP añade cinco aserciones contra evidencia falsificada. ADR-101 actualizado a `aceptada — opción C para el PoC`. |
| **F2-04** `PersistenceResult` evaluado | ✅ | 6 operaciones fuera de React; runner con `ports.persist` devolviendo `PersistenceResult`. 16 pruebas nuevas + 10 existentes + 5 runner. |
| **F2-05** regla en la puerta | ✅ | `runEngagement` rechaza sin charter aprobado (`charter-not-approved`). 4 pruebas. |
| **F2-06** idempotencia y reanudación | ✅ | `executionId` por tarea, reanudación de `in-progress` huérfano, checkpoint fail-closed (pre-efecto y terminal), identidad determinista de artefacto (`deterministicArtifactId`). 57 pruebas runner + 1 idempotencia artefacto. |
| **F2-07** sobrecarga retirada | ✅ | `drop function api.delete_engagement(text, text)`. Gate estático `rpcOverloads.test.ts` 5/5. |
| **F2-08** borrado de iniciativa protegido | ✅ | `delete_business_initiative` con `for update`/`for key share`, `23503` nombrando proyectos. 6 pgTAP. |
| **F2-09** auditoría de RPC | ✅ | 4 RPC huérfanas revocadas a `authenticated` (`record_arb_decision`, `load/save_platform_reference_parameters`, `mark_file_object_deleted`). `mark_file_object_ready` reservada a `service_role` + trigger `private.confirm_registered_file_object` que promueve `pending → ready` en la inserción validada. Gate `rpcSurface.test.ts` 3/3. |
| **F2-10** revisión con snapshot | ✅ | `OfficeEngagement.revision` viaja con el agregado; `Map` global eliminado. Corregido en Oficina e Iniciativas. |
| **F2-11** pruebas de concurrencia | ✅ | Caso `dos sesiones desde la misma revisión solo permiten efectos a la ganadora` (optimistic lock), colisión de ID de decisión, autoaprobación prohibida, revisor no altera contenido ajeno, reanudación idempotente. Cubierto por pruebas unitarias y pgTAP. |
| **F2-12** fixture E2E con dos identidades | ✅ | `decide_engagement` aborta con `42501` si el autor firma su propio encargo, y el recorrido del comité hacía exactamente eso: la cuenta dueña del fixture pulsaba «Aprobar entrega». `scripts/seedE2E.mjs` siembra ahora dos cuentas —`architect@arky.e2e` (`superadmin`, autor) y `reviewer@arky.e2e` (`reviewer`, firmante)—, `seed_e2e_profile` recibe el rol, y el recorrido firma en la sesión de la revisora y **verifica en la del autor**: la bandeja `load_arb_engagements` sólo trae `awaiting-arb`/`blocked`, así que tras la firma la revisora deja de ver el encargo y un reintento de Playwright no podría afirmar nada. |

### Lo que la fase 2 ha enseñado

- **Los defectos no son sueltos: son patrones repetidos en tres contextos.** El mapa global de revisiones estaba en los tres repositorios; la tabla de códigos de error, en dos. Arreglar uno y no buscar los otros habría dejado el mismo fallo con dos nombres.
- **Una prueba puede afirmar el defecto.** Dos lo hacían —«keeps running when persistence fails» y «elimina con la revisión que leyó»— y ambas pasaban.
- **Mover una regla a su sitio la pone a prueba de verdad.** Al bajar `canRunEngagement` al runner, las dieciocho pruebas del motor se pusieron en rojo: corrían sobre charters sin aprobar y nada lo notaba.
- **Un arreglo puede destapar el siguiente.** El `23503` de F2-08 no habría llegado a la pantalla porque dos repositorios tenían su propia tabla de códigos, y ninguna lo conocía.
- **La separación autor/aprobador es una decisión de negocio, no técnica.** La opción C (permiso `arb:decide` + prohibición de autoaprobación) es el mínimo que hace la regla expresable sin un modelo de equipos.

---

## Fase 3 — cerrada

| Tarea | Estado | Nota |
|---|---|---|
| **F3-01** gate transitivo | ✅ | Adelantada. 4 cycles, 2 SCCs (3 + 9 modules). 36 pruebas, 6 negativas. |
| **F3-02** ampliar alcance verificador | ✅ | ADR-105. Lee `import('…')` y abre los ficheros de la raíz. 42 pruebas. |
| **F3-07** deshacer el reexportador `types.ts` | ✅ | `types.ts` no importa nada. Componente 27 → 14, pares ascendentes 0. |
| **F3-08** `utils.ts` no es utilidades | ✅ | 290 líneas de composición de prompts a `services/ai`. |
| **F3-03** declarar dependencias permitidas | ✅ | 246 aristas declaradas en `modules.json`; una nueva falla. |
| **F3-04** presupuestos con objetivo y fecha | ✅ | `scripts/budgetTargets.mjs`: seis objetivos con fecha y fase. |
| **F3-05** iniciativas como contexto piloto | ✅ | `domain/` + `infrastructure/`, 20 operaciones con nombre, prueba de pureza. |
| **F3-06** entradas públicas pequeñas | ✅ | Varias puertas por módulo; pares profundos 60 → 57. |

---

## Fase 4 — cerrada (`10-cierre-fase-4.md`)

| Tarea | Estado | Nota |
|---|---|---|
| **F4-01** medir Proyecto–Artefacto | ✅ | #48. Amplificación `N:1`, contención por revisión del proyecto, borrado por omisión. Base vacía: tasa de conflictos no estimable. |
| **F4-02** ¿Artefacto es raíz? | ✅ | ADR-106: sí. Ninguna invariante lee el contenido de dos artefactos; P-04 y A-02 son de conjunto y las sostiene el servidor. |
| **F4-03** comandos por artefacto | ✅ | Cinco comandos + `save_project`, índice único por versión, revisión en las lecturas. 61 aserciones pgTAP. |
| **F4-04** raíz, documento y modelo de lectura | ✅ | `ProjectRoot` sin artefactos; `PersistedProjectDocument`; `Project` es la vista. |
| **F4-05** coordinación de artefactos fuera de React | ✅ | `artifactWorkflow`, `artifactImprovement`, `generationFailure`. Fan-out 10 → 6; las seis restantes, a F5-02. |
| **F4-06** ruta de escritura única | ✅ | `save_project_aggregate` retirada: `revoke` + `drop`, contratos reescritos, `retiredRpcs.test.ts`. |
| **F4-07** mapa de revisiones de proyectos | ✅ | Sin `Map` ni exportación; la revisión viaja en `Project.revision`. Mismo defecto del actualizador que F4-03. |

### Lo que F3-02 hizo visible

El gate llevaba toda la transformación midiendo un grafo al que le faltaban dos
cosas: una sintaxis —`import('…')`, 21 dependencias— y los ficheros de la raíz,
que no son carpeta de nadie y por eso no se abrieron nunca. Con las dos dentro:

| | antes | después |
|---|---|---|
| Ciclos | 4 | **11** |
| Componentes fuertemente conexos | 3 + 9 módulos | **3 + 27** |
| Pares ascendentes | 0 | **7** (9 imports) |
| Pares con import profundo | 59 | **68** |

Ninguna subida es código nuevo, y casi todo sale de un fichero: `types.ts` lo
importan 25 de los 34 módulos y él importa seis, así que cierra el grafo entero
—incluidos `lib` y `utils`, que son la capa de fundación y no deberían poder
volver—. `utils.ts` pone los otros dos pares ascendentes: tiene nombre de
utilidad y contiene composición de prompts.

### Lo que F3-07 y F3-08 deshicieron, y lo que no

| | tras F3-02 | hoy |
|---|---|---|
| Ciclos | 11 | **6** |
| Pares ascendentes | 7 | **2** |
| Pares con import profundo | 68 | **64** |
| Componentes fuertemente conexos | 3 + 27 | 3 + 27 |

**Casi todo era andamio que ya no sostenía nada.** `types.ts` reexportaba 19
declaraciones de diagrama que **no tenía un solo consumidor**, y las de
presentación, revisión y chat sólo las consumían **los propios módulos dueños**,
que importaban sus tipos por la raíz del repositorio en vez de por el fichero de
al lado. Once ficheros repuntados y cuatro bloques retirados: cuatro ciclos y
tres imports ascendentes menos. Nada de eso era una decisión de diseño; era una
nota de «reexportado para que los imports existentes sigan funcionando» que
sobrevivió a los imports que iba a proteger.

`utils.ts` era el otro: 290 líneas que componen prompts —leen el contexto y la
memoria de un proyecto para redactar lo que se manda a un modelo— viviendo en la
raíz bajo un nombre que promete utilidades. Están en
`services/ai/prompts/projectPrompts.ts`.

**El componente de 27 no se mueve, y ésa es la información.** `types.ts` sigue
dentro por dos aristas, `Artifact` y `Project`, y arrastra con él a `lib`.
Repuntarlas cambiaría un ciclo contra `types.ts` por uno **entre dos contextos
de dominio reales**: `services/artifacts` necesita el proyecto y
`services/architectureProjects` necesita el artefacto. Eso no es un problema de
imports sino la frontera del agregado Proyecto–Artefacto — **D-4**, que decide
F4-02 con los datos de F4-01. La consecuencia de orden es que F4-01 deja de ser
«la fase siguiente» y pasa a ser el desbloqueo de ésta.

**Es la lección de ADR-104 repetida un nivel más abajo.** Allí el gate estaba
verde porque medía una propiedad más débil que la que decía medir; aquí, porque
medía un árbol más pequeño que el que decía medir. Un grafo incompleto no se ve
incompleto: se ve sano. La cabecera del script ahora declara qué abre y qué deja
fuera, para que la próxima ampliación empiece por leerlo.

---

## Decisiones pendientes (no son supuestos)

| # | Pregunta | Quién decide | Bloquea |
|---|---|---|---|
| D-1 | ¿Quién debe poder ver y firmar un encargo ajeno? | **negocio** | **Resuelta 2026-09-20: opción C** |
| D-2 | ¿Hay política de archivado y retención? | negocio | F6-08 |
| D-3 | ¿«Revisión» se renombra a «versión de fila» en la UI? | producto | **Ya no bloquea**: ninguna pantalla muestra el contador (2026-09-22) |
| D-4 | ¿`Artefacto` pasa a raíz de agregado? | arquitectura, con datos de F4-01 | **Resuelta 2026-09-22: sí, ADR-106** |

---

## Supuestos explícitos (revisables con evidencia)

| # | Supuesto | Por qué |
|---|---|---|
| S-1 | El proyecto Supabase es una PoC sin datos productivos | `CLAUDE.md`, decisión de usuario 2026-09-12 |
| S-2 | Ningún cliente desplegado llama `delete_engagement/2` | único llamante en el repositorio pasa 3 args |
| S-3 | El volumen de artefactos por proyecto es de decenas, no miles | F4-01 no pudo medirlo (base vacía); ADR-106 no depende de él |

---

## Deuda técnica controlada

1. ~~**El botón que siempre falla.**~~ **Resuelta el 2026-09-22.**
   `describeArbDecisionEligibility` (`services/architectureOffice/OfficeArbService`)
   responde «¿puede *este* actor firmar *este* encargo?» y devuelve el motivo, no
   un booleano: las dos negativas se explican distinto y un `false` habría
   obligado a la pantalla a adivinar cuál —que es como se escribe la regla por
   segunda vez—. La regla rechaza al autor **antes de la llamada**, el contexto
   la expone como `arbEligibility(engagement)` y `ArbDecisionPanel` sólo elige la
   frase. Cinco pruebas nuevas, incluida la precedencia: faltar el permiso se
   nombra antes que la autoría, porque es la razón que sigue siendo cierta si el
   encargo cambia de autor.

2. ~~**`agentExecutor.ts` (1007 líneas, techo 1001)**~~ **Ya no era deuda, y eso
   era el defecto.** Las extracciones de la fase 2 —`deterministicArtifactReuse`
   y `agentExecutorContracts`— lo habían dejado en **988 líneas y 41 175 bytes**,
   por debajo del techo, y nadie bajó el número: el gate estaba en verde y esta
   lista seguía diciendo que no. Fijado el 2026-09-22. Un presupuesto que no se
   baja cuando se gana es un presupuesto que permite volver a subir sin que se
   note.
3. **Typecheck y build completos no corren en este equipo, y ya está medido.**
   `tsc --noEmit` muere por OOM del sistema con **RSS máximo 2 076 MB** en tres
   intentos —incluido uno excluyendo `__tests__`, que sólo bajó a 2 044— frente a
   **~1 900 MB disponibles**; con el heap limitado a 1,5 GiB aborta dentro de V8.
   `npm run build` muere igual. La máquina tiene 7,9 GiB, **cero swap**, y un
   navegador ocupa ~2,5. No es un defecto de código y no se arregla en el
   repositorio: o se libera memoria durante la comprobación, o se añade swap.
   Lo que **sí** corre en local, y es la señal utilizable: `typecheck:strict`
   (497 MB, verde), lint, los cinco gates y las 4 419 pruebas.
   Node quedó en **24.21.0** (`.nvmrc`), que era el defecto real: con Node 20 el
   SDK de Supabase no encuentra `WebSocket` nativo y `supabaseIdentityAdapter`
   fallaba una prueba que en CI pasaba.
4. **`mark_file_object_ready` no invocable desde navegador** — intencional; la coreografía de subida usa trigger server-side. Si un flujo futuro lo necesita, se añadirá un backend confiable, no se abrirá la RPC.
