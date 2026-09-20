# Registro de avance y punto de reanudación

**Última actualización:** 2026-09-20
**Rama:** `claude/arky-ddd-modular-transform-lowfh7` · **Base:** `fd590e7`

---

## Punto de reanudación

- **Última tarea completada:** F2-10 (la revisión viaja con el snapshot), en
  encargos e iniciativas. Commit `76636bf`.
- **Estado de los cambios:** árbol limpio, todo commiteado y empujado a
  `origin/claude/arky-ddd-modular-transform-lowfh7`.
- **Siguiente tarea exacta:** **F2-06** — idempotencia y reanudación ante fallo
  de persistencia. El runner ya se **detiene** ante un fallo (F2-04); falta que
  la reanudación sea idempotente por tarea y que el `runId` distinga el intento
  detenido del siguiente. Después: F2-11 (pruebas de concurrencia), luego fase 3
  desde F3-02.
- **Verificaciones pendientes, y ninguna está declarada validada:**
  1. **Contratos pgTAP** — tres ficheros nuevos/tocados sin ejecutar. Este
     entorno no tiene Docker ni la CLI de Supabase. Corren en
     `.github/workflows/supabase.yml`.
  2. **Playwright E2E** — no ejecutado en toda la sesión.
  3. **Node 24** — todo lo medido va sobre Node 22.22.2. El repositorio declara
     `engines.node: 24.x`.
- **Bloqueos:** F2-03 espera decisión de negocio (ADR-101, D-1).

### Riesgo abierto que conviene no perder de vista

`api.decide_engagement` es una RPC nueva que el cliente ya llama, y **no se ha
ejecutado nunca**. La migración tiene que aplicarse antes de desplegar el
código — es la regla aditiva que el repositorio ya tiene escrita— y el primer
sitio donde se sabrá si el SQL es correcto es `supabase.yml`.

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

- **10 hallazgos confirmados, 2 parciales, 0 descartados.** Todos con evidencia
  estática salvo H03, reproducido.
- **El hallazgo más grave no estaba en la lista de doce**: la separación
  autor/aprobador no está relajada, es **estructuralmente imposible** porque
  `owner_id` es a la vez autor y frontera de autorización (ADR-101).
- **33 invariantes catalogadas; 8 sin ninguna autoridad efectiva.**
- **Tres cifras de `CLAUDE.md` estaban desactualizadas** — suite, bundle y
  ciclos. La línea base es la autoridad.

---

## Fase 2 — en curso

| Tarea | Estado | Qué quedó |
|---|---|---|
| F2-01 decisión ARB atómica | ✅ SQL-no-ejecutado | `api.decide_engagement`, 16 afirmaciones pgTAP |
| F2-02 guardas de servidor | 🔶 parcial | hecho en la ruta de decisión; falta la tabla de transiciones de `save_engagement` |
| F2-03 separación autor/aprobador | ⛔ bloqueada | ADR-101 — decisión de negocio |
| F2-04 `PersistenceResult` evaluado | ✅ | 6 operaciones fuera de React, el puerto del runner devuelve resultado |
| F2-05 la regla en la puerta | ✅ | `runEngagement` rechaza un charter sin aprobar |
| F2-06 idempotencia y reanudación | ⏳ siguiente | |
| F2-07 sobrecarga retirada | ✅ SQL-no-ejecutado | + gate estático de sobrecargas |
| F2-08 borrado de iniciativa | ✅ SQL-no-ejecutado | bloqueo en los dos lados, como una FK real |
| F2-09 auditoría de RPC | 🔶 parcial | el gate de sobrecargas existe; falta cotejar concesiones |
| F2-10 revisión con el snapshot | ✅ | encargos e iniciativas; proyectos → F4-07 |
| F2-11 pruebas de concurrencia | ⏳ | |
| **F3-01** gate transitivo | ✅ | adelantada desde la fase 3 |

### Lo que la fase 2 ha enseñado hasta ahora

- **Los defectos de este repositorio no son sueltos: son patrones repetidos en
  tres contextos.** El mapa global de revisiones estaba en los tres
  repositorios; la tabla de códigos de error, en dos. Arreglar uno y no buscar
  los otros habría dejado el mismo fallo con dos nombres.
- **Una prueba puede afirmar el defecto.** Dos lo hacían —«keeps running when
  persistence fails» y «elimina con la revisión que leyó»— y ambas pasaban.
- **Mover una regla a su sitio la pone a prueba de verdad.** Al bajar
  `canRunEngagement` al runner, las dieciocho pruebas del motor se pusieron en
  rojo: corrían sobre charters sin aprobar y nada lo notaba.
- **Un arreglo puede destapar el siguiente.** El `23503` de F2-08 no habría
  llegado a la pantalla porque dos repositorios tenían su propia tabla de
  códigos, y ninguna lo conocía.

---

## Decisiones pendientes (no son supuestos)

| # | Pregunta | Quién decide | Bloquea |
|---|---|---|---|
| D-1 | ¿Quién debe poder ver y firmar un encargo ajeno? | negocio | F2-03 |
| D-2 | ¿Hay política de archivado y retención? | negocio | F6-08 |
| D-3 | ¿«Revisión» se renombra a «versión de fila» en la UI? | producto | F3-05 |
| D-4 | ¿`Artefacto` pasa a raíz de agregado? | arquitectura, con datos de F4-01 | F4-02 |

## Supuestos explícitos (revisables con evidencia)

| # | Supuesto | Por qué |
|---|---|---|
| S-1 | El proyecto Supabase es una PoC sin datos productivos | `CLAUDE.md`, decisión de usuario 2026-09-12 |
| S-2 | Ningún cliente desplegado llama `delete_engagement/2` | único llamante en el repositorio pasa 3 args |
| S-3 | El volumen de artefactos por proyecto es de decenas, no miles | a medir en F4-01 antes de decidir D-4 |
