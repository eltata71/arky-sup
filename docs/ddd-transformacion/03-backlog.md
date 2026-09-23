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
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada` · **Depende de** F3-01
- **Hecho (2026-09-22).** `modules.json` → `allowedDependencies`: las 246 aristas
  entre los 39 módulos, medidas sobre el grafo completo. `checkDeclaredDependencies`
  falla una arista no declarada y un módulo sin lista, y avisa de una declarada
  que ya no existe, para que la lista sólo encoja. Cinco pruebas, tres negativas;
  una sexta afirma que el contexto piloto sólo depende de `persistence` y
  `adapters` en el dominio.

### F3-04 · Presupuestos decrecientes con objetivo y fecha
- **Prioridad** P2 · **Tamaño** S · **Estado** `completada`
- **Hecho (2026-09-22).** `scripts/budgetTargets.mjs`: seis números con objetivo,
  fecha y la fase que los cumple (componente de dominio → 0, ciclos → 3, ficheros
  sueltos → 0, pantallas sobre el fan-out → 0, pares profundos → 30, `any` → 7).
  `check:module-boundaries` y `check:any-budget` los evalúan: antes de la fecha
  informan, después fallan si no se cumplieron. Las fechas son propuesta de la
  fase 3 sobre el plan; moverlas se hace ahí, con la razón. `BUDGET_TODAY` permite
  probarlo (`budgetTargets.test.ts`).

### F3-05 · Iniciativas como contexto piloto — dominio puro
- **Prioridad** P0 · **Tamaño** L · **Estado** `completada`
- **Cambios.** `services/businessInitiatives/domain/` con reglas puras;
  puertos de repositorio; comandos/consultas/DTO publicados; objetos de valor
  para identificador, código y revisión; operaciones de negocio explícitas en
  lugar de `update(partial)`.
- **Aceptación.** Las reglas se prueban sin React ni Supabase; los consumidores
  no importan infraestructura; el presupuesto de descarga no empeora.
- **Hecho (2026-09-22).** `domain/` (tipos, identidades, revisión como objeto de
  valor, lectura de lo almacenado, fábrica, cálculos y **20 operaciones con
  nombre** en `applyInitiativeCommand`) e `infrastructure/` (adaptador y
  repositorio). `updateInitiative(partial)` desapareció: el contexto expone
  `runInitiativeCommand`, y los paneles emiten comandos. Las reglas que vivían
  en los paneles —fechar una medición de KPI, fechar el cierre de un hito,
  ordenar los hitos— son ahora del dominio. Un panel importaba el repositorio
  (infraestructura) para acuñar ids; ya no. Pruebas: `initiativeCommands.test.ts`
  (14, sin mocks), `domainPurity.test.ts` (4), `initiativeCommandContext.test.tsx`
  (3). Carga inicial 309,5 KB gz: los comandos se cargan en diferido.
- **D-3** deja de bloquear: el contador no se muestra en ninguna pantalla (ver
  `09-cierre-fase-3.md`).

### F3-06 · Entradas públicas pequeñas compatibles con carga diferida
- **Prioridad** P1 · **Tamaño** M · **Estado** `completada` · **Depende de** F3-05
- **Hecho (2026-09-22).** `modules.json` admite varias puertas por módulo
  (`api` como lista); el gate las acepta como entrada. Iniciativas publica tres:
  el barril, `domain` (sin infraestructura) y `commands` (para el `import()`
  diferido del proveedor, que devolvió 1,2 KB gz a la carga inicial). Efecto: los
  19 imports que entraban por ficheros internos del contexto usan su puerta, y
  los pares profundos bajan de 60 a 57.

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
- **Prioridad** P1 · **Tamaño** L · **Estado** `completada` · **Depende de** F4-02, F4-03
- **Hecho (2026-09-22).** Tres formas con nombre, cada una con un solo
  productor:
  - **`ProjectRoot`**: el agregado. Lo que `save_project` guarda y lo que su
    revisión protege. **No tiene `artifacts`**: la fábrica lo construye, y
    `createProject`, `persistProjectRoot` y el repositorio sólo aceptan esto, así
    que ninguna escritura del proyecto puede llevar, ni borrar, un artefacto
    (ADR-106 §6).
  - **`PersistedProjectDocument`**: el documento de la fila. `toProjectDocument`
    es el único que lo produce, y ya no emite `lastArtifactUpdatedAt` ni ningún
    campo derivado. Una prueba lo afirma aunque se le pase una vista entera.
  - **`Project`** (`extends ProjectRoot`): el modelo de lectura. Añade los
    artefactos, el índice, el contador y el grafo, que llegan de sus propias
    tablas. Conserva el nombre porque lo leen cuarenta módulos.
    `toProjectView` compone la vista y `newProjectView` da la de un proyecto
    recién creado: cargado y vacío.
- **Lo que cambia de comportamiento.** Crear un proyecto ya no escribe un grafo
  de conocimiento vacío: es dato derivado con su propia RPC y el primer
  reconstruido lo crea.

### F4-05 · Sacar de React la coordinación de artefactos
- **Prioridad** P0 · **Tamaño** XL · **Estado** `completada` · **Depende de** F4-03
- **Hecho (2026-09-23).** Tres servicios de aplicación en
  `services/artifacts/application/`, declarados como puertas del módulo en
  `modules.json`:
  - **`artifactWorkflow`** — lo que decidía `useArtifactsState` entre dos
    `setState`: qué versión sigue a cuál, qué se recompila, qué comando lleva
    cada intención, qué revisión se compara y qué se revierte cuando la base no
    confirma (`planArtifactIntent` → `executeArtifactWrite` →
    `settleArtifactWrite`). Puro salvo la escritura, que recibe el repositorio.
    Entra en `typecheck:strict` con todo su cierre transitivo. El hook queda en
    estado optimista, escritura y aviso; `artifactCoordinationOutOfReact.test.ts`
    impide que vuelva a importar la fábrica o el compilador.
  - **`artifactImprovement`** — lo que decidía el lienzo: la auto-mejora
    determinista del diagrama (y cuándo *no* mejoró nada), los artefactos
    derivados y la mejora con sugerencias.
  - **`generationFailure`** — cómo se le cuenta al Workspace un fallo de
    generación, que era su única razón para importar la capa de IA.
- **Pantallas.** `ArtifactCanvas` (5 → 2), `ArtifactExportModal` (4 → 1),
  `ArtifactInspectorPanel` (3 → 2) y `Workspace` (3 → 2) salen de la tabla de
  fan-out: **10 → 6**. `artifactAssessment` publica el vocabulario de lo que
  devuelve y asume la regla del grafo de conocimiento del inspector.
- **El intercambio, medido.** `components -> services/diagram` 20 → 16,
  `components -> services/quality` 7 → 3, `components -> services/artifacts`
  13 → 11, `components -> services/ai` 3 → 2, `context -> services/artifacts`
  desaparece y `context -> services/artifactCompiler` también; suben
  `services/artifacts -> services/diagram` 14 → 17 y `-> services/ai` 1 → 2, y
  aparece `services/artifacts -> services/review` (sólo tipo). Es el patrón de
  la Ola 4: las decisiones bajan al dominio.
- **Lo que no es de esta tarea.** Las seis pantallas que quedan sobre el fan-out
  son de la Oficina, las iniciativas y el asistente, no de artefactos. Su
  objetivo (0 antes del 2027-01-31) pasa a **F5-02** sin mover la fecha.
  La publicación ya estaba fuera de React: sus transiciones son funciones puras
  de `publicationPipeline` y `PublicationCenter` no pasa del fan-out por defecto.

### F4-07 · El mapa de revisiones de proyectos, y su fuga al contrato público
- **Prioridad** P0 · **Tamaño** M · **Estado** `completada` · **Resuelve** H10 (resto), H04
- **Hecho (2026-09-22).** El `Map` de `SupabaseProjectRepository` desapareció,
  y con él `knownProjectRevision` y `forgetProjectRevisions` del `index.ts`.
  `save`, `saveRoot` y `remove` exigen `expectedRevision`: el llamante la trae
  del registro que está viendo. `Project.revision` la lleva desde la lectura,
  `createProject` y `updateProject` devuelven la confirmada y
  `useProjectsState` la escribe de vuelta. La comprobación por
  `expectedUpdatedAt` —el reloj del cliente— se retiró: la revisión es la única
  autoridad de concurrencia.
- **El mismo defecto que F4-03 encontró en artefactos.** `updateProject` y
  `deleteProject` tomaban su instantánea **dentro** del actualizador de
  `setProjects`; la segunda edición consecutiva no tenía instantánea, ni rollback,
  ni revisión que comparar. Leen ahora `projectsRef`.
  `projectRevisionFlow.test.tsx` lo fija y `noRevisionCache.test.ts` escanea que
  ningún repositorio vuelva a guardar revisiones en un mapa.
- **Problema.** `SupabaseProjectRepository` tiene el mismo `Map` global que
  encargos e iniciativas tenían, y además lo **publica**: `knownProjectRevision`
  y `forgetProjectRevisions` salen por el `index.ts` del contexto, así que la
  caché de concurrencia es parte del contrato del módulo.
- **Por qué va en la fase 4.** Corregirlo toca la ruta de escritura del agregado
  Proyecto–Artefacto, que es lo que F4-02 decide. Hacerlo antes sería fijar el
  testigo sobre una frontera que va a cambiar.

### F4-06 · Migración por cortes verticales con ruta de escritura única
- **Prioridad** P0 · **Tamaño** L · **Estado** `completada` · **Depende de** F4-03, F4-04
- **Hecho (2026-09-23).** ADR-106 §5: `api.save_project_aggregate` se retira
  cuando migra su último llamante. Era la creación de proyectos, siempre con la
  lista vacía; ahora crear es `api.save_project` con revisión esperada 0, la
  misma puerta que actualizar. Migración
  `20260923090000_retire_save_project_aggregate.sql` (`revoke` + `drop`, con su
  nota de compatibilidad y de reversión) y tipos generados sin la RPC.
- **Tres gates para que no vuelva.** `rpcSurface.test.ts` falla con una
  concesión sin consumidor; `retiredRpcs.test.ts` —nuevo— falla si una migración
  posterior la recrea, si un fichero del cliente la llama o si el tipo generado
  la ofrece (comprobado: sin la migración, los dos primeros fallan); y el
  contrato pgTAP afirma `hasnt_function`.
- **Contratos.** `projects_artifacts`, `artifact_commands` y
  `engagement_overload_and_initiative_references` se reescribieron sobre
  `save_project` + comandos de artefacto, conservando todos los casos
  negativos (forma, tipo, vista, versión, secreto anidado, id repetido,
  revisión obsoleta) y añadiendo dos: un segundo «crear» con el mismo id y una
  edición de la raíz sobre una copia vieja. La sonda remota también.
  Verificado en PostgreSQL 16 nativo: 15 contratos, dos reconstrucciones,
  `plpgsql_check` sin hallazgos.

---

## Fase 5 — Oficina, IA y proyecciones

### F5-01 · Romper `services/ai -> services (raíz)`
- **Prioridad** P0 · **Tamaño** XL · **Estado** `en curso` · **Resuelve** H12, H03
- **Nota.** Es la arista que cierra el SCC de nueve. La estrangulación va
  vertical por vertical, cortando primero la dependencia ascendente de cada una
  (patrón `learningService`). Medido al empezar: **12** ficheros bajo
  `services/ai` importaban `geminiService` (la cifra de 20 era de antes de la
  vertical del LMS).
- **Corte 1 — el transporte (2026-09-23).** Proxy, reintentos, tope de tiempo y
  cambio de modelo salen del motor a `services/ai/generation/legacyTransport.ts`,
  tal cual y con el cliente inyectado; el motor delega. `aiGateway` y las cuatro
  fachadas que sólo envían su propio prompt —captura asistida, guía de la
  plataforma, asistente de iniciativas y edición de diagramas— dejan de
  importar el motor: **12 → 7**. `engineImporters.test.ts` lista los siete
  restantes y sólo deja encoger. De paso: el transporte sale tipado (`any`
  23 → 18), entra en `typecheck:strict` con su cierre (dos `override` que
  faltaban en `cause`), el motor baja a 5 110 líneas y
  `services (raíz) -> services/ai` de 17 a 11 imports.
- **Corte 2 — el resto del LMS (2026-09-23).** `evaluateChallenge`, el último
  método que la vertical del LMS había dejado en el motor, sale a
  `services/ai/generation/learning/challengeEvaluation.ts` y entra por
  `aiGateway`. Sale tipado: el motor devolvía `Promise<any>` y la fachada
  afirmaba una forma sin comprobarla; `toChallengeEvaluation` reduce la
  respuesta campo a campo (una nota que no es número no se pinta, se acota a
  0–100). `learningService` deja de importar el motor: **7 → 6**; `any`
  18 → 17; el motor baja a 5 081 líneas.
- **Corte 3 — sugerencias de mejora (2026-09-23).**
  `suggestArtifactImprovements` sale a
  `services/ai/generation/artifactSuggestions.ts`. El prompt y el esquema se
  conservan; la inferencia pasa por `aiGateway`, y
  `artifactSuggestionService` sigue validando el informe. Importadores directos
  del motor **6 → 5**; el método de 131 líneas desaparece del motor. Las
  pruebas focalizadas cubren la llamada al gateway, el esquema y JSON inválido.
- **Corte 4 — la vertical de recomendaciones (2026-09-23).**
  `recommendCustomArtifactTemplate` y `getSuggestedActions`, con el ranker
  local, el análisis de intención, el normalizador de la respuesta y las
  reglas de nombre y confianza, salen a `services/ai/generation/recommendation/`
  (cinco ficheros, todos bajo 20 KB y en `typecheck:strict`).
  `recommendationService` deja de importar el motor: **5 → 4**; el motor pierde
  935 líneas (4 950 → 4 015). Dos cosas que no eran sólo mover:
  la recomendación construía su propio cliente Gemini y se saltaba el proxy, el
  guardarraíl de entrada y el enrutado —en producción, con las claves en el
  servidor, nunca llegaba a un modelo—; ahora entra por `aiGateway` con su
  presupuesto (35 s, dos reintentos, un solo modelo). Y `emitGenerationPhase`,
  que el motor y la vertical comparten, baja a `lib/artifacts/generationPhase.ts`
  junto a su evento: dejarlo en `services/ai` era un import profundo nuevo desde
  el motor. Se declara la arista `services/ai -> constants.ts` (el catálogo de
  plantillas), que no cierra ningún ciclo: `constants.ts` sólo importa `types.ts`.
- **Corte 5 — la vertical de documentos (2026-09-23).**
  `convertDiagramToDocument`, `synthesizeSmartNote`, `generateSDDProcessPlan`,
  `generateSDDHealthReport` y `extractMemoryEntriesFromDocument` salen a
  `services/ai/generation/documents/` (tres ficheros por lo que hacen: SDD,
  conversiones y extracción de memoria) y entran por `aiGateway`, con los
  mismos prompts, temperaturas y reintentos. `documentGenerationService` deja
  de importar el motor: **4 → 3**; el motor pierde 243 líneas (3 904 → 3 661).
  Ninguno de los cinco tenía prueba propia: `documentsVertical.test.ts` fija
  temperatura, prompt y —para la extracción— qué sobrevive de la respuesta.
  Corrección: `synthesizeSmartNote` no usaba la persona del tutor del LMS; sólo
  `consultArchitecture` la usa.
- **Corte 6 — la vertical de diagramas (2026-09-23).** Los seis métodos de
  `diagramGenerationService` y sus tres privados salen a
  `services/ai/generation/diagram/` (seis ficheros), con el constructor de
  configuración, los presupuestos de razonamiento y el tope de temperatura que
  la generación de artefactos del motor sigue leyendo. Importadores **3 → 2**;
  el motor pierde 852 líneas (3 661 → 2 809) y sus imports profundos hacia
  `services/diagram` bajan 6 → 3: los guardarraíles y el gate de calidad los
  toma la vertical por el barril de `services/diagram`.
  **Hallazgo, no arreglado aquí:** `legacyTransport.generateTextWithFallback`
  no intenta el proxy; con la clave de operador sólo en el servidor, sin clave
  personal lanza y la IR acaba siempre en el esqueleto determinista. Afecta
  también a la generación de artefactos del motor. Se registra como tarea
  propia porque el corte es de movimiento.
- **Corte 7 — el asistente sin persona (2026-09-23).** `consultArchitecture`,
  `analyzeChatForContext`, `runConsistencyCheck` y `processMultimodalChat`
  salen a `services/ai/generation/assistant/` y entran por `aiGateway`, con los
  mismos prompts, temperaturas y reintentos; el motor pierde 178 líneas
  (2 809 → 2 631) y la persona del tutor del LMS sale con `consultArchitecture`.
  La conversación y el curso se leen por **puertos declarados**
  (`AssistantConversationTurn`, `AssistantCourseSummary`): `services/chat` y el
  LMS importan `services/ai`, así que nombrar sus tipos desde aquí cerraría un
  ciclo aunque el import fuera de tipo. El contexto de cursos deja de leerse por
  `any` (15 → 14). `assistantService` **sigue importando el motor**, sólo por
  sus tres turnos con persona.
- **Corte 8 — el asistente con persona (2026-09-23).** `chatWithProject`,
  `processAssistantChat` y su variante en streaming salen del motor partidos
  por donde apunta la dependencia: `services/ai/generation/assistant/` pregunta
  al modelo sobre una instrucción que recibe compuesta (`runAgentTurn`,
  `streamAgentTurn`, `generateProjectChatReply`, más el prompt propio del
  proyecto); `services/agent/agentConversation` compone el turno del agente
  con la persona que le entregan (su puerto `AgentPersonaBriefing`), y la
  Oficina decide quién responde (`chatWithProject`, `officePersonaForMessage`).
  El ejecutor recibe la persona por `resolvePersona`; las pantallas juntan las
  tres mitades en `hooks/useAssistantTurns`, sin subir su fan-out.
  `assistantService` deja de importar el motor: **2 → 1**. El motor deja de
  importar `services/agent` y `services/chat` (dos dependencias declaradas
  menos), baja a 2 443 líneas, y los pares con import profundo 56 → 54;
  `any` 14 → 13.
- **Corte 9 — nombres iniciales de artefactos (2026-09-23, #66).**
  `getInitialArtifactsForTemplate` sale a
  `generation/artifactTemplateSuggestions.ts` y pasa por `aiGateway`; conserva
  prompt, esquema JSON y respaldo determinista. El motor baja a 2 431 líneas.
- **Corte 10 — crítica y refinamiento previo a persistir (2026-09-23).**
  `critiqueArtifactContent` y `refineArtifactContent` salen a
  `generation/artifactQualityRefinement.ts` y pasan por `aiGateway`. El
  orquestador conserva la decisión de cuándo pedir IA y qué candidato aceptar.
  El motor baja a 2 330 líneas según el gate; `any` 13 → 11 al tipar la
  configuración legacy que el escáner léxico dejó visible. Evidencia en
  `evidencias/f5-01-corte-10.md`.
- **Lo que queda.** La vertical de artefactos (`artifactGenerationService`),
  que es el grueso del motor. La arista `services/ai -> services (raíz)` y el
  SCC de catorce no desaparecen hasta que salga.

### F5-02 · Políticas de negocio a su contexto propietario
- **Prioridad** P1 · **Tamaño** L · **Estado** `pendiente` · **Depende de** F5-01
- **Hereda de F4-05** las seis pantallas que siguen sobre el fan-out por
  defecto —`ProjectCopilotChatModal`, `InitiativesPage`,
  `EngagementIntakeWizard`, `OfficeCapabilitiesPanel`, `AssistantPanel`,
  `ProjectsPage`— y su objetivo: 0 antes del 2027-01-31. Un ejemplo de lo que
  hay debajo: el asistente de alta de un entregable calcula el espejo de códigos
  `NEG-YYYY-NNN` en la pantalla, cuando es una regla de la fábrica del encargo.

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
