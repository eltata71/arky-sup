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
- **Verificaciones, ya ejecutadas en CI:**
  1. **Contratos pgTAP — ejecutados y en verde** (`supabase.yml`, paso *Positive
     and negative pgTAP contracts*), junto con el lint de SQL y los advisors de
     seguridad. Fue su primera ejecución: aquí no hay Docker. **Las migraciones
     salieron bien a la primera**; lo que falló fueron tres defectos de las
     propias pruebas, corregidos en `fee10f7`.
  2. **Playwright E2E — en verde**, sobre `main` y sobre la rama.
  3. **CI (typecheck, lint, presupuestos, build, bundle, cobertura) — en verde**
     sobre Node 24, que es lo que el repositorio declara y lo que este entorno
     no tiene.
- **Sigue sin verificar:** nada de lo entregado. La única medición hecha sobre
  Node 22 en vez de 24 son las cifras locales de la línea base; CI las repitió
  sobre 24 sin discrepancia.
- **Bloqueos:** F2-03 espera decisión de negocio (ADR-101, D-1).

### El riesgo que había, y cómo se cerró

`api.decide_engagement` era una RPC nueva que el cliente ya llamaba y que no se
había ejecutado nunca. La regla aditiva del repositorio —la migración va antes
que el código— se aplicó al pie de la letra:

1. `supabase.yml` ejecutó los contratos contra una base real: **en verde**.
2. Las dos migraciones se aplicaron a `ArkyDB-US` **antes** de fusionar, con
   autorización explícita del usuario.
3. Se verificó el resultado en la base: `delete_engagement` con una sola firma,
   `decide_engagement` ejecutable por `authenticated`, `decided_revision`
   presente, y **cero privilegios de tabla** para `anon`/`authenticated`.
4. El historial de migraciones se realineó con los nombres de fichero del
   repositorio (`20260920120000`, `20260920160000`), para que un `db push`
   futuro no las vea como pendientes.

Queda una deuda pequeña y nombrada: `api.record_arb_decision` ya no la llama
ningún código de este repositorio, pero sí los clientes desplegados hasta que
el despliegue nuevo los reemplace. Su retirada es una migración posterior.

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
