# Registro de avance y punto de reanudación

**Última actualización:** 2026-09-22
**Rama:** `feat/fase-2-consistencia-reanudacion` · **Base:** `2344cf9`

---

## Punto de reanudación

- **Última tarea completada:** **Fase 2 — Consistencia y gobernanza completada íntegramente.**
- **Estado de los cambios:** 22 archivos modificados, 403 inserciones, 160 eliminaciones. Pendiente de commit y push.
- **Siguiente paso exacto:** Commit, push, PR contra `main`, y arranque de Fase 3 desde F3-02.
- **Verificaciones ejecutadas localmente:**
  1. **Test focalizados de arquitectura Office y agente** — 75 pruebas en verde (OfficeEngagementRunner, agentExecutor, supabaseFileStorage, rpcSurface, OfficeContext).
  2. **Contratos pgTAP contra PostgreSQL 16 nativo** — `decide_engagement_atomic` (24/24), `office_engagement_transitions` (6/6).
  3. **Lint, module-boundaries, any-budget** — todos en verde.
  4. **Module-size** — `OfficeEngagementRunner.ts` quedó bajo los techos por defecto tras extraer `officeRunResumption`, `officeRunnerState` y `officeRunnerContracts`; `agentExecutor.ts` conserva una deuda registrada (1007 vs 1001 líneas).
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

### Lo que la fase 2 ha enseñado

- **Los defectos no son sueltos: son patrones repetidos en tres contextos.** El mapa global de revisiones estaba en los tres repositorios; la tabla de códigos de error, en dos. Arreglar uno y no buscar los otros habría dejado el mismo fallo con dos nombres.
- **Una prueba puede afirmar el defecto.** Dos lo hacían —«keeps running when persistence fails» y «elimina con la revisión que leyó»— y ambas pasaban.
- **Mover una regla a su sitio la pone a prueba de verdad.** Al bajar `canRunEngagement` al runner, las dieciocho pruebas del motor se pusieron en rojo: corrían sobre charters sin aprobar y nada lo notaba.
- **Un arreglo puede destapar el siguiente.** El `23503` de F2-08 no habría llegado a la pantalla porque dos repositorios tenían su propia tabla de códigos, y ninguna lo conocía.
- **La separación autor/aprobador es una decisión de negocio, no técnica.** La opción C (permiso `arb:decide` + prohibición de autoaprobación) es el mínimo que hace la regla expresable sin un modelo de equipos.

---

## Fase 3 — siguiente

| Tarea | Estado | Nota |
|---|---|---|
| **F3-01** gate transitivo | ✅ | Adelantada. 4 cycles, 2 SCCs (3 + 9 modules). 36 pruebas, 6 negativas. |
| **F3-02** ampliar alcance verificador | ⏳ | Siguiente. |
| **F3-03** declarar dependencias permitidas | ⏳ | |
| **F3-05** iniciativas como contexto piloto | ⏳ | |

---

## Decisiones pendientes (no son supuestos)

| # | Pregunta | Quién decide | Bloquea |
|---|---|---|---|
| D-1 | ¿Quién debe poder ver y firmar un encargo ajeno? | **negocio** | **Resuelta 2026-09-20: opción C** |
| D-2 | ¿Hay política de archivado y retención? | negocio | F6-08 |
| D-3 | ¿«Revisión» se renombra a «versión de fila» en la UI? | producto | F3-05 |
| D-4 | ¿`Artefacto` pasa a raíz de agregado? | arquitectura, con datos de F4-01 | F4-02 |

---

## Supuestos explícitos (revisables con evidencia)

| # | Supuesto | Por qué |
|---|---|---|
| S-1 | El proyecto Supabase es una PoC sin datos productivos | `CLAUDE.md`, decisión de usuario 2026-09-12 |
| S-2 | Ningún cliente desplegado llama `delete_engagement/2` | único llamante en el repositorio pasa 3 args |
| S-3 | El volumen de artefactos por proyecto es de decenas, no miles | a medir en F4-01 antes de decidir D-4 |

---

## Deuda técnica controlada

1. **`agentExecutor.ts` (1007 líneas, techo 1001)** — se extrajeron `deterministicArtifactReuse` y `agentExecutorContracts`. Mismo criterio.
2. **Typecheck completo no verificado en entorno local (OOM)** — CI tiene runners con 4 GiB; local 2 GiB. No es un defecto de código.
3. **`mark_file_object_ready` no invocable desde navegador** — intencional; la coreografía de subida usa trigger server-side. Si un flujo futuro lo necesita, se añadirá un backend confiable, no se abrirá la RPC.