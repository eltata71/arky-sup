# Backlog

**Estados:** `pendiente` · `en curso` · `bloqueada` · `completada`.
Una tarea pasa a `completada` sólo con implementación **y** evidencia ejecutada.

> El marcador `SQL-no-ejecutado` existió mientras los contratos pgTAP estaban
> escritos y sin correr —este entorno no tiene Docker—. Ya no hace falta:
> `supabase.yml` los ejecutó contra una base real y pasaron, y las dos
> migraciones están aplicadas en `ArkyDB-US`.

**Tamaños:** S (≤½ día) · M (1–2 días) · L (3–5 días) · XL (>1 semana).

---

## Fase 1 — Modelo de dominio y línea base

### F1-01 · Línea base medida
- **Prioridad** P0 · **Tamaño** S · **Estado** `completada`
- **Objetivo.** Sustituir las cifras de `CLAUDE.md` por medición sobre `fd590e7`.
- **Alcance.** `docs/ddd-transformacion/00-linea-base.md`, `evidencias/`.
- **Aceptación.** Cada cifra con su comando; discrepancias con `CLAUDE.md` registradas.
- **Evidencia.** `00-linea-base.md` §1–§5; `evidencias/*.md`.

### F1-02 · Grafo de dependencias con ciclos transitivos
- **Prioridad** P0 · **Tamaño** S · **Estado** `completada` · **Depende de** F1-01
- **Objetivo.** Medir lo que el gate no mide.
- **Aceptación.** SCC calculados sobre el mismo grafo del gate, con sus aristas internas.
- **Evidencia.** `evidencias/scc-linea-base.md` — SCC de 9 módulos de dominio, 22 aristas.

### F1-03 · Verificación de los doce hallazgos
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada`
- **Aceptación.** Cada hallazgo clasificado, con fichero y línea, y con el tipo de evidencia diferenciado.
- **Evidencia.** `01-hallazgos.md`. 10 confirmados, 2 parciales, 0 descartados.

### F1-04 · Matriz de propiedad de tablas, RPC y datos
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada`
- **Aceptación.** Toda tabla `api.*` con contexto dueño, RPC de entrada y consumidores; los datos derivados marcados como reconstruibles.
- **Evidencia.** `06-propiedad-datos.md`.

### F1-05 · Lenguaje ubicuo y la colisión «Project / Attention / Proyecto / Atención»
- **Prioridad** P1 · **Tamaño** S · **Estado** `completada`
- **Aceptación.** Un nombre por concepto, con la decisión y el coste de cambiarlo.
- **Evidencia.** `04-lenguaje-ubicuo.md`, ADR-100.

### F1-06 · Catálogo de invariantes con autoridad de validación
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada`
- **Aceptación.** Cada invariante dice dónde se aplica (UI / TS / RPC / restricción SQL) y si esa autoridad basta.
- **Evidencia.** `07-invariantes.md`.

### F1-07 · Mapa de contextos y contratos
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada`
- **Evidencia.** `05-mapa-contextos.md`.

### F1-08 · ADR de la transformación
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada`
- **Evidencia.** `adr/ADR-100`…`ADR-104`.

### F1-09 · Backlog de las seis fases
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` — este documento.

---

## Fase 2 — Consistencia y gobernanza

### F2-01 · `DecideEngagement` como caso de uso, y su equivalente SQL transaccional
- **Prioridad** P0 · **Tamaño** L · **Estado** `completada` · **Resuelve** H01, H02 (parcial)
- **Evidencia.** `api.decide_engagement(text, jsonb, bigint, jsonb)` en
  `supabase/migrations/20260920160000_decide_engagement_atomic.sql`: bloquea la
  fila, comprueba permiso `arb:decide`, estado previo **leído de la fila** (no
  del documento que llega), correspondencia veredicto↔estado nuevo, firma de la
  sesión y revisión vigente; inserta la decisión con `on conflict do nothing`
  —idempotente, así que un reintento no firma dos veces— y transiciona, todo en
  una transacción. El espejo `arbDecisions` lo **reconstruye el servidor** desde
  el registro: uno que el cliente pueda escribir es uno que puede decir algo
  distinto del rastro inmutable, y la pantalla lee el espejo.
  `decideEngagementOperation` pasa de dos escrituras a una. 16 afirmaciones
  pgTAP con sus cinco casos negativos; 7 pruebas de aplicación y 3 de contexto.
- **Reparto de responsabilidad, deliberado.** El cliente manda el documento ya
  transicionado y el servidor **comprueba**. Recalcular en SQL qué veredicto
  lleva a qué estado crearía dos definiciones de la misma regla, que es el
  defecto D-4 otra vez.
- **Orden de despliegue, obligatorio.** La migración va **antes** que el código
  que llama la RPC nueva — la regla aditiva que el repositorio ya tiene escrita.
- **Verificado.** Los contratos pgTAP **corrieron y pasaron**, y la migración se
  aplicó a `ArkyDB-US` antes de fusionar, en el orden que el repositorio exige.
- **Pendiente.** Retirar `api.record_arb_decision`, que ya no llama ningún código
  de este repositorio pero sí los clientes desplegados hasta que el despliegue
  nuevo los reemplace: es una migración posterior, no ésta.
- **Alcance.** `services/architectureOffice/application/decideEngagement.ts` (nuevo),
  `context/OfficeContext.tsx`, `services/architectureOffice/OfficeEngagementRepository.ts`,
  `SupabaseOfficeEngagementRepository.ts`, migración nueva `api.decide_engagement`.
- **Cambios.** Una sola RPC que valida, transiciona, registra decisión y audita
  en una transacción, y devuelve la fila con su revisión. El caso de uso deja de
  hacer dos escrituras.
- **Aceptación.** Un fallo no deja encargo entregado sin decisión; el resultado
  distingue `success | conflict | permission-denied | failed`; la RPC rechaza un
  encargo que no está en `awaiting-arb`.
- **Pruebas.** Unitaria del caso de uso con puerto doblado (conflicto, permiso,
  éxito); pgTAP con caso negativo por cada guarda.
- **Riesgo/reversión.** La RPC nueva convive con las dos antiguas hasta F2-09; revertir es dejar de llamarla.

### F2-02 · Guardas de servidor: transición, estado previo, evidencia
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H02
- **Hecho.** Función `private.office_engagement_transition_allowed` con matriz
  cerrada (18 de 64 pares permitidos). `save_engagement` rechaza `delivered`;
  `decide_engagement` es la única puerta que produce `delivered`. Pruebas pgTAP 6/6.
- **Evidencia.** Migración `20260920224928_phase_2_governance_guards.sql` y
  `supabase/tests/database/office_engagement_transitions.test.sql`.

### F2-03 · Separación autor/aprobador — decisión de modelo
- **Prioridad** P0 · **Tamaño** L · **Estado** `completada` · **Resuelve** H02
- **Decisión de negocio adoptada (2026-09-20): opción C**.
  - `arb:decide` concede bandeja global de encargos ajenos (`api.load_arb_engagements`).
  - Autoaprobación prohibida aunque el autor tenga el permiso (`current_row.owner_id = actor`).
  - El revisor no puede alterar título, charter, tareas, presupuesto ni auditoría previa.
- **Evidencia.** Migración `20260920224928_phase_2_governance_guards.sql`,
  `supabase/tests/database/decide_engagement_atomic.test.sql` (24/24 pgTAP).
- ADR-101 actualizado a `aceptada — opción C para el PoC`.

### F2-04 · `PersistenceResult` evaluado en toda la Oficina
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H01 (parcial), H07
- **Alcance.** `context/OfficeContext.tsx` (`persistAndTrack`, las seis operaciones),
  `OfficeEngagementRunner.ts` (`ports.persist` pasa a devolver `PersistenceResult`).
- **Aceptación.** Ninguna operación de `OfficeContext` devuelve `ok: true` tras
  una escritura no confirmada; el runner se detiene ante un fallo no recuperable
  y lo reporta.
- **Evidencia.** Las seis operaciones salieron de React a
  `services/architectureOffice/application/engagementOperations.ts`, con dos
  puertos (`EngagementWritePort`, `CharterRefinementPort`). El puerto
  `OfficeRunnerPorts.persist` pasa de `Promise<void>` a
  `Promise<PersistenceResult<OfficeEngagement>>` — el tipo era la mitad más cara
  del defecto: un fallo **sin** excepción era indistinguible del éxito.
  `services/architectureOffice/officeRunCheckpoint.ts` decide qué fallos
  detienen la ejecución (`offline` no, porque el espejo local es la degradación
  prevista; `conflict` y `permission-denied` sí).
  **16 pruebas nuevas sin React** + 10 en `OfficeContext.test.tsx` + 5 en el
  runner. Una prueba existente, llamada literalmente «keeps running when
  persistence fails», **afirmaba el defecto**: se sustituye por cuatro que
  cubren su mitad legítima —lo generado no se tira— y la que faltaba.
- **Efecto secundario medido.** `context -> services/architectureOffice` baja de
  **9 a 7** imports profundos, y `OfficeContext.tsx` de 553 a 401 líneas. La
  carga inicial sube 1,3 KB gz (323,9 → 325,2 de 340).

### F2-05 · La regla de gobierno vive en la puerta, no en el llamante
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H06
- **Cambios.** En vez de añadir un `StartEngagement` por encima —que sería otra
  puerta que alguien puede rodear— la regla baja a `runEngagement`, que es la
  única puerta que existe. Devuelve `status: 'refused'` sin tocar ningún puerto.
  La exclusión de concurrencia sigue entrando por `options.isRunning`: «ya se
  está ejecutando» es un hecho de la sesión que ejecuta, no del agregado, y
  entre sesiones la exclusión la da la revisión optimista.
- **Aceptación.** Llamar al runner sin charter aprobado es imposible; cuatro
  pruebas lo demuestran sin React.
- **Evidencia, y es la mejor del lote.** Al mover la regla, **las dieciocho
  pruebas del motor pasaron a fallar**: los fixtures construían charters sin
  aprobar y el motor los ejecutaba sin que nada protestara, porque la regla la
  aplicaba `OfficeContext` y no la puerta. Eso es exactamente el agujero, medido.
  Los fixtures ahora aprueban el charter, con el comentario que dice por qué.

### F2-06 · Idempotencia y reanudación ante fallo de persistencia
- **Prioridad** P1 · **Tamaño** L · **Estado** `completada` · **Depende de** F2-04 · **Resuelve** H07
- **Implementación.**
  - `executionId` por tarea: identidad estable del intento que sobrevive a la reanudación.
  - Reanudación de tareas `in-progress` huérfanas: se revierten a `ready` preservando `attempts`.
  - Checkpoint fail-closed: pre-efecto (marca `in-progress`) y terminales (presupuesto, cancelación, bloqueo, `awaiting-arb`) — si falla el `save`, no se ejecutan puertos y el resultado es `not-persisted`.
  - Identidad determinista de artefacto: `deterministicArtifactId` derivado de `executionId`; reutiliza artefacto existente en vez de duplicar.
  - Auditoría `run-resumed` emitida al reanudar desde otro `runId`.
- **Evidencia.**
  - `OfficeEngagementRunner.ts` 57/57 pruebas focalizadas.
  - `agentExecutorIdempotency.test.ts` 1/1.
  - Contratos de extracción: `officeRunResumption.ts`, `officeRunnerState.ts`, `officeRunnerContracts.ts`, `deterministicArtifactReuse.ts`, `agentExecutorContracts.ts`.

### F2-07 · Retirar la sobrecarga `api.delete_engagement(text, text)`
- **Prioridad** P0 · **Tamaño** S · **Estado** `completada` · **Resuelve** H09
- **Evidencia.** Migración `20260920120000_engagement_overload_and_initiative_references.sql`
  (`revoke` + `drop function if exists`). Contrato pgTAP
  `engagement_overload_and_initiative_references.test.sql`: la función tiene
  **una** firma y es la de tres argumentos. Y una prueba estática nueva,
  `__tests__/supabase/rpcOverloads.test.ts`, que **reprodujo el defecto en su
  origen** antes del arreglo — señaló `20260912181347: crea
  api.delete_engagement/3 y deja viva api.delete_engagement/2` — y vuelve a
  fallar si se quita el `drop` (comprobado).
- **Verificado.** Los contratos pgTAP **corrieron en `supabase.yml` y pasaron**,
  y la migración se aplicó a `ArkyDB-US`. Comprobado en la base real: antes había
  **dos** firmas de `delete_engagement`, ambas ejecutables por `authenticated`;
  ahora hay una.
- **Cambios.** Migración correctiva con `drop function`; contrato pgTAP que
  afirma que la firma de dos argumentos **no existe**; y una prueba de
  repositorio que afirma que el cliente pasa siempre tres argumentos.
- **Riesgo.** Un cliente desplegado llamando la firma vieja fallaría. Mitigación:
  `grep` del repositorio confirma que sólo `SupabaseOfficeEngagementRepository`
  la invoca y siempre con `p_expected_revision`.

### F2-08 · Proteger el borrado de iniciativas referenciadas
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H08
- **Cambios.** `delete_business_initiative` rechaza si algún proyecto la cita
  (`errcode` propio, no `42501`); alternativa de archivado.
- **Aceptación.** Borrar una iniciativa citada falla con un mensaje que nombra los
  proyectos; ningún proyecto queda imposible de guardar.
- **Evidencia.** Misma migración. `delete_business_initiative` cuenta los
  proyectos que la citan y falla con `23503` nombrando hasta cinco. La ventana de
  carrera se cierra en los **dos** lados: `save_project_aggregate` toma
  `for key share` sobre las iniciativas citadas y el borrado toma `for update`
  antes de contar — el mecanismo de una clave foránea real, escrito a mano porque
  el enlace vive en una columna de array. Seis afirmaciones pgTAP, incluidas las
  tres negativas y la que comprueba que el proyecto **sigue siendo guardable**
  después del borrado rechazado, que es lo que el defecto rompía.

### F2-09 · Auditoría de sobrecargas y RPC sin consumidor
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada` · **Depende de** F2-07
- **Hecho.**
  - 4 RPC huérfanas revocadas a `authenticated`:
    `record_arb_decision`, `load_platform_reference_parameters`,
    `save_platform_reference_parameters`, `mark_file_object_deleted`.
  - `mark_file_object_ready` reservada a `service_role` + trigger
    `private.confirm_registered_file_object` que promueve `pending → ready`
    en la inserción validada (el navegador no llama RPC de `service_role`).
  - Gate `rpcSurface.test.ts` (catálogo ↔ consumidores) 3/3.
  - Gate `rpcOverloads.test.ts` (una firma por función) 5/5.
- **Evidencia.** Migración `20260920224928_phase_2_governance_guards.sql`,
  `__tests__/supabase/rpcSurface.test.ts`, `__tests__/supabase/rpcOverloads.test.ts`,
  `supabase/tests/database/platform_reference_parameters.test.sql` actualizado.

### F2-10 · La revisión viaja con el snapshot
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` (Oficina; proyectos e iniciativas pendientes) · **Resuelve** H10
- **Alcance.** `SupabaseOfficeEngagementRepository.ts`, `OfficeEngagementRepository.ts`,
  `OfficeTypes.ts`, y la auditoría del mismo patrón en proyectos e iniciativas.
- **Aceptación.** Guardar desde un snapshot obsoleto produce `conflict`; el `Map`
  global deja de decidir la revisión.
- **Evidencia.** El `Map<string, number>` del cierre del repositorio —un
  singleton de módulo— desaparece. `OfficeEngagement.revision` es el testigo y
  viaja con el agregado; un campo funciona donde un `WeakMap` no, porque cada
  derivación es un spread y el campo va solo. Se quita del documento antes de
  enviarlo (`asDocument`): es una columna, y una copia dentro del JSON nacería
  obsoleta. Ausente significa 0, que es «espero que no exista» — el fallo va
  hacia el conflicto, nunca hacia la escritura.
  La reproducción está en `supabaseOfficeEngagementRepository.test.ts`: leer en
  revisión 3, recargar la lista (que viene en 7), guardar el snapshot viejo.
  Antes salía con 7 y el servidor lo aceptaba; ahora sale con 3. **Comprobado
  que falla contra el código anterior.**
- **Auditado: el defecto estaba en los tres contextos.** Iniciativas lo tenía
  línea por línea igual y **queda corregido aquí** (`BusinessInitiative.revision`,
  el mapa fuera, la revisión del snapshot en `InitiativeContext`, y lo confirmado
  —no lo enviado— de vuelta al estado). Proyectos va a F4-07.
- **Y una segunda copia que el arreglo destapó.** Los dos repositorios llevaban
  su propia tabla de códigos de PostgreSQL en vez de
  `services/persistence/supabaseErrors.ts`, y **ninguna conocía `23503`** — el
  código de F2-08. Ambas se sustituyen por `supabaseFailure`, que además propaga
  el mensaje del servidor: el que nombra los proyectos a desvincular.

### F2-11 · Pruebas de concurrencia y fallo parcial
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada` · **Depende de** F2-01, F2-10
- **Casos cubiertos.**
  - Dos sesiones desde la misma revisión: solo la ganadora del lock optimista ejecuta efectos.
  - Colisión de ID de decisión entre encargos distintos aborta la transacción (23505).
  - Autoaprobación prohibida aunque el autor tenga `arb:decide`.
  - Revisor no puede alterar título, charter, tareas ni presupuesto del encargo ajeno.
  - Reanudación idempotente tras fallo post-efecto: mismo `executionId` reutiliza artefacto.
  - Checkpoint terminal que falla no comunica `completed`/`blocked`/`cancelled`.
- **Evidencia.** Pruebas unitarias `OfficeEngagementRunner.test.ts` + pgTAP
  `decide_engagement_atomic.test.sql` (24/24) + `office_engagement_transitions.test.sql` (6/6).

---

## Fase 3 — Fronteras y contexto piloto

### F3-01 · El gate detecta componentes fuertemente conexos
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H03
- **Adelantada** desde la fase 3: es la herramienta que mide si la fase 5 avanza.
- **Evidencia.** `scripts/checkModuleBoundaries.mjs` (Tarjan iterativo, `ALLOWED_SCCS`,
  `--report` imprime el presupuesto copiable); `__tests__/scripts/moduleBoundaries.test.ts`
  pasa de 19 a **36** pruebas, **seis de ellas negativas** (componente nuevo, componente
  que crece nombrando el módulo entrante, dos que se funden, uno que encoge, uno roto,
  uno sin cambios). Gate en verde: `4 cycles, 2 strongly connected components (3 + 9 modules)`.
- **Cambios.** Tarjan en `scripts/checkModuleBoundaries.mjs`; presupuesto
  monótono `ALLOWED_SCCS` con los dos componentes de hoy; `--report` los imprime.
- **Aceptación.** Un ciclo de tres módulos nuevo falla el gate; los dos
  componentes actuales quedan registrados y no pueden crecer.
- **Riesgo.** El gate no puede empezar en rojo. El presupuesto registra lo que hay.

### F3-02 · Ampliar el alcance del verificador
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada` · **Depende de** F3-01
- **Problema.** ADR-104 arregló *qué* pregunta hace el gate. Sobre qué grafo la
  hacía no se revisó, y al grafo le faltaban dos cosas: `import('…')` —21
  dependencias que la expresión regular no leía— y los ficheros de la raíz, que
  no son carpeta de nadie y **nunca se abrieron**. `types.ts` lo importan 25 de
  los 34 módulos.
- **Cambios.** `DYNAMIC_IMPORT_RE` en `localImports`; `modules.json` admite
  módulos declarados por fichero y declara cinco (`app`, `types.ts`,
  `constants.ts`, `utils.ts`, `types/`); presupuestos remedidos con la razón
  escrita al lado de cada uno.
- **Evidencia.** `__tests__/scripts/moduleBoundaries.test.ts` pasa de 36 a **42
  pruebas**, cuatro de ellas sobre el alcance mismo —un `import()` diferido, uno
  en posición de tipo, la atribución de un fichero de la raíz y la de un import
  que lo nombra sin extensión— contra dependencias reales del árbol, no contra
  un fixture.
- **Lo que se ve al mirar.** 4 → **11** ciclos, 3+9 → **3+27** módulos en los
  componentes, 0 → **7** pares ascendentes, 59 → **68** pares con import
  profundo. Ninguna subida es código nuevo. ADR-105.
- **Riesgo aceptado.** La regla monótona es sobre el código, no sobre la vista;
  se registra lo que se acaba de ver, fechado, y a partir de ahí sólo baja.

### F3-07 · Deshacer el reexportador `types.ts`
- **Prioridad** P0 · **Tamaño** L · **Estado** `completada` · **Depende de** F3-02, F4-02 (D-4)
- **Problema.** Seis de los once ciclos y el salto del componente de dominio de
  nueve a veintisiete módulos salen de un fichero: `types.ts` reexporta
  agregados desde el contexto de cada uno, y lo importan 25 de los 34 módulos.
  Arrastra dentro del componente a `lib` y `utils`, que son la capa de fundación.
- **Cambios.** Cada consumidor importa del contexto dueño en vez del
  reexportador; lo que no tiene dueño baja a una hoja (`lib/`). Es la regla que
  ya está en CLAUDE.md y que la Ola 2 aplicó tres veces.
- **Aceptación.** `types.ts` sale del componente de dominio y con él `lib` y
  `utils`; ningún par ascendente sale ya de la raíz; el presupuesto de descarga
  no empeora.
- **Por qué antes que la fase 5.** No toca comportamiento: mueve declaraciones.
  El núcleo de nueve módulos cuesta estrangular un motor de 5 400 líneas.
- **Hecho (2026-09-22).** Cuatro de los seis ciclos. Al medir los consumidores
  resultó que el andamio ya no sostenía nada: las **19 declaraciones de diagrama
  reexportadas no tenían un solo consumidor**, y de presentación, revisión y
  chat los únicos consumidores eran **los propios módulos dueños**, importando
  sus tipos por la raíz del repositorio en vez de por el fichero de al lado.
  Se repuntaron 11 ficheros y se retiraron los cuatro bloques.
- **Lo que falta, y por qué no es repuntar imports.** `Artifact` (178 ficheros)
  y `Project` (133). Repuntarlos cambiaría un ciclo contra `types.ts` por uno
  **entre dos contextos de dominio reales** —`services/artifacts` necesita
  `Project` y `services/architectureProjects` necesita `Artifact`—, que es
  justo lo que `moduleBoundaries.test.ts` afirma que no puede pasar. Debajo
  está la frontera del agregado Proyecto–Artefacto: **bloqueado por D-4, que
  decide F4-02 con los datos de F4-01.**
- **Efecto medido.** 11 → 7 ciclos, 7 → 4 pares ascendentes, 68 → 66 pares con
  import profundo. El componente de 27 no se mueve: `types.ts` sigue dentro por
  esas dos aristas, y arrastra a `lib`.
- **Cerrada (2026-09-22), con D-4 resuelta por ADR-106.** Las dos aristas no
  se repuntaron al contexto dueño —eso era el ciclo directo que la medición
  predecía—, y la segunda medición dijo por qué: **`Artifact` lo lee la
  fundación** (`lib/artifacts/contracts`, `utils/artifactExploration`) y quince
  contextos, y `services/diagram`, `export`, `quality` y otros son importados
  por `services/artifacts`. Repuntar creaba `diagram ↔ artifacts` y compañía, y
  subía doce pantallas por encima del fan-out. Así que:
  - **`Artifact` bajó a `lib/artifacts/artifactModel.ts`** con su vocabulario de
    generación, `ArtifactSummary`, `GroupedArtifacts`, `ArtifactReviewStatus` y
    el resumen de compilación persistido (`artifactCompilationSummary.ts`). Es
    forma sin comportamiento; la fábrica, los comandos y el compilador siguen
    en sus contextos.
  - **`Project` se importa de `services/architectureProjects`**; las pantallas
    lo reciben de `context/AppContext`, que es quien les entrega los proyectos,
    y así ningún fan-out sube.
  - **`types.ts` no importa nada.** Las declaraciones del brief de generación
    viven en él porque `ArtifactTemplate` las transporta.
  - **Tres ciclos directos que esto destapaba, cerrados con puertos**, no con
    presupuesto: el grafo de conocimiento (`ArchitectureGraphProjectSource`,
    `ArchitectureGraphHost`), la publicación (`PublicationPackageHost`) y la
    Oficina (`normalizeBusinessProjectIds` bajó a `lib/eaTerminology` como
    `toInitiativeCodes`, porque sólo habla de códigos).
- **Efecto medido (final).** 6 → 4 ciclos (quedan el de UI y
  `services (raíz) <-> services/ai`), componente de dominio **27 → 14**
  módulos, pares ascendentes **2 → 0**, pares con import profundo 64 → 60.
  Carga inicial 309,4 / 340 KB gz. Doce techos de tamaño suben unos bytes
  —el import nombra `lib/artifacts` en vez de `types`— y cada uno lo dice en
  su línea.

### F3-08 · `utils.ts` no es un fichero de utilidades
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada` · **Depende de** F3-02
- **Problema.** `buildGlobalPrompt`, `buildBasePrompt`, `buildArtifactsContext` y
  `buildSiblingDiagramsPromptBlock` son composición de prompts —capa de IA—
  escrita en la raíz del repositorio, y por eso el fichero importa `services/ai`
  y `services/memory`: dos de los siete pares ascendentes y el ciclo
  `services/ai <-> utils.ts`.
- **Aceptación.** La composición de prompts vive en `services/ai`; lo que quede
  en `utils.ts` no alcanza ningún módulo de dominio.
- **Riesgo.** Lo importan diez módulos: es una migración, no un renombrado.
- **Hecho (2026-09-22).** 290 líneas a `services/ai/prompts/projectPrompts.ts`,
  seis consumidores repuntados. El riesgo resultó menor de lo temido: los diez
  módulos importan `utils.ts`, pero sólo seis ficheros importaban **estas**
  funciones. Desaparecen los dos pares ascendentes y el ciclo
  `services/ai <-> utils.ts`.
- **El único número que sube.** `services (raíz) -> services/ai`: 16 → 17,
  porque `geminiService` importaba esta composición desde `utils.ts` y ahora la
  importa de donde vive. Se cambia un import dentro de un ciclo **ya
  registrado** —que F5-01 disuelve— por dos violaciones de capa que ninguna
  fase tenía planeado arreglar. La razón queda escrita junto al presupuesto.

### F3-03 · Declarar dependencias permitidas entre contextos
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F3-01

### F3-04 · Presupuestos decrecientes con objetivo y fecha
- **Prioridad** P2 · **Tamaño** S · **Estado** `pendiente`

### F3-05 · Iniciativas como contexto piloto — dominio puro
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente`
- **Cambios.** `services/businessInitiatives/domain/` con reglas puras;
  puertos de repositorio; comandos/consultas/DTO publicados; objetos de valor
  para identificador, código y revisión; operaciones de negocio explícitas en
  lugar de `update(partial)`.
- **Aceptación.** Las reglas se prueban sin React ni Supabase; los consumidores
  no importan infraestructura; el presupuesto de descarga no empeora.

### F3-06 · Entradas públicas pequeñas compatibles con carga diferida
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F3-05

---

## Fase 4 — Proyectos y Entregables

### F4-01 · Medir volumen y conflictos del agregado Proyecto–Artefacto
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H05
- **Medición estructural (2026-09-22).** Una edición envía y actualiza los `N`
  artefactos del proyecto; dos ediciones de hijos distintos compiten por la
  misma revisión. Evidencia y consulta agregada de lectura en
  `evidencias/f4-01-proyecto-artefacto.md` y `evidencias/f4-01-volumen.sql`.
- **Volumen observado.** La consulta `supabase db query --linked --file ...`
  devolvió **0 proyectos y 0 artefactos** en el proyecto vinculado. La tasa de
  conflictos es **no estimable** con una población vacía y sin serie de errores
  por operación; no se atribuye una tasa a partir de pruebas sintéticas.
- **Condición para revisar F4-02.** Si aparece carga real, medir en una ventana
  definida percentiles de volumen e intentos/rechazos `P0001` antes de
  extrapolar la decisión. El vacío actual es un resultado medido.

### F4-02 · ADR: ¿Artefacto es raíz de agregado?
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Depende de** F4-01 · **Resuelve** D-4
- **Decisión (2026-09-22).** Sí: `adr/ADR-106-artefacto-raiz-de-agregado.md`.
  Ninguna invariante necesita el contenido de dos artefactos en la misma
  transacción; P-04 (índice) y A-02 (versionado) son de conjunto y pasan a
  sostenerlas el servidor. El Proyecto deja de contener artefactos y su
  índice es una proyección que sólo escriben los comandos de artefacto.
- **Sin volumen.** La decisión no depende de la tasa de conflictos que F4-01 no
  pudo estimar; el ADR dice por qué y qué la haría revisar.

### F4-03 · Revisión y comandos por artefacto
- **Prioridad** P0 · **Tamaño** L · **Estado** `completada` · **Depende de** F4-02 · **Resuelve** H05, A-02, A-03
- **Hecho (2026-09-22).** Migración `20260922180000_artifact_commands.sql` y
  contrato `artifact_commands.test.sql` (61 aserciones, dos reconstrucciones en
  PostgreSQL 16 nativo, `plpgsql_check` sin hallazgos). Cliente:
  `SupabaseArtifactCommands`, `artifactPersistence` reescrito, `updateProject`
  por `save_project`, y la revisión viajando en el artefacto.
- **Dos defectos vivos que salieron al hacerlo.** (1) Ni `load_project_aggregate`
  ni `list_project_aggregates` devolvían la revisión: tras recargar, la primera
  edición de un proyecto existente era un `P0001` falso. (2) `useArtifactsState`
  decidía qué persistir desde variables asignadas **dentro** del actualizador de
  `setProjects`; React sólo lo ejecuta en el acto para la primera actualización,
  así que la segunda edición consecutiva de un artefacto no se escribía nunca,
  sin error. Reproducido sobre `main` antes de corregirlo;
  `artifactRevisionFlow.test.tsx` lo fija.
- **Contrato.** ADR-106 §3: `create_artifact`, `create_artifact_version`,
  `update_artifact`, `delete_artifact` y `revise_artifacts` (varias versiones
  en una transacción, para `applyConsistencySuggestion`). Cada una con
  `project:write`, sesión viva, `revoke`, revisión **del artefacto** y contrato
  pgTAP con el caso negativo. Índice único
  `(project_id, version_group_id, version)`: A-02 gana autoridad de servidor.
- **Cliente.** `artifactPersistence` deja «lee, muta en memoria, guarda todo»;
  `expectedUpdatedAt` (reloj del cliente) se sustituye por la revisión.

### F4-04 · Separar dominio, documento persistido y modelo de lectura
- **Prioridad** P1 · **Tamaño** L · **Estado** `pendiente`

### F4-05 · Sacar de React la coordinación de artefactos
- **Prioridad** P0 · **Tamaño** XL · **Estado** `pendiente`

### F4-07 · El mapa de revisiones de proyectos, y su fuga al contrato público
- **Prioridad** P0 · **Tamaño** M · **Estado** `pendiente` · **Resuelve** H10 (resto), H04
- **Problema.** `SupabaseProjectRepository` tiene el mismo `Map` global que
  encargos e iniciativas tenían, y además lo **publica**: `knownProjectRevision`
  y `forgetProjectRevisions` salen por el `index.ts` del contexto, así que la
  caché de concurrencia es parte del contrato del módulo.
- **Por qué va en la fase 4.** Corregirlo toca la ruta de escritura del agregado
  Proyecto–Artefacto, que es lo que F4-02 decide. Hacerlo antes sería fijar el
  testigo sobre una frontera que va a cambiar.

### F4-06 · Migración por cortes verticales con ruta de escritura única
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F4-03

---

## Fase 5 — Oficina, IA y proyecciones

### F5-01 · Romper `services/ai -> services (raíz)`
- **Prioridad** P0 · **Tamaño** XL · **Estado** `pendiente` · **Resuelve** H12, H03
- **Nota.** 20 ficheros bajo `services/ai` importan `geminiService`. Es la arista
  que cierra el SCC de nueve. La estrangulación va vertical por vertical, cortando
  primero la dependencia ascendente de cada una (patrón `learningService`).

### F5-02 · Políticas de negocio a su contexto propietario
- **Prioridad** P1 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F5-01

### F5-03 · Eliminar las 22 aristas internas del SCC
- **Prioridad** P0 · **Tamaño** XL · **Estado** `pendiente` · **Depende de** F5-01

### F5-04 · Outbox transaccional para trabajo durable
- **Prioridad** P0 · **Tamaño** L · **Estado** `pendiente` · **Resuelve** H11
- **Aceptación.** Cerrar el navegador no pierde un trabajo declarado durable;
  reprocesar no duplica; un evento viejo no sobrescribe una proyección más nueva.

### F5-05 · Recuperación de la proyección del grafo de conocimiento
- **Prioridad** P1 · **Tamaño** M · **Estado** `pendiente` · **Depende de** F5-04

---

## Fase 6 — Consolidación y cierre

### F6-01 · Retirar rutas antiguas y adaptadores sin consumidor · P1 · M · `pendiente`
### F6-02 · Dependencias no autorizadas entre contextos a cero · P0 · L · `pendiente`
### F6-03 · Aplicar el patrón al resto de contextos · P1 · XL · `pendiente`
### F6-04 · Pruebas integrales de los flujos críticos · P0 · L · `pendiente`
### F6-05 · Verificar rendimiento, descarga, concurrencia y recuperación · P0 · M · `pendiente`
### F6-06 · Documentación, ADR, instrucciones y runbooks · P1 · M · `pendiente`
### F6-07 · Comparación final contra la línea base · P0 · S · `pendiente`
### F6-08 · Deuda residual con responsable y justificación · P1 · S · `pendiente`
### F6-09 · Informe técnico y gerencial de cierre · P1 · M · `pendiente`
