# Registro de avance y punto de reanudación

**Última actualización:** 2026-09-20
**Rama:** `claude/arky-ddd-modular-transform-lowfh7` · **Base:** `fd590e7`

---

## Punto de reanudación

- **Última tarea completada:** F1-09 (backlog de las seis fases).
- **Estado de los cambios:** Fase 1 cerrada y commiteada. Sin cambios sin commitear.
- **Siguiente tarea exacta:** **F3-01** — Tarjan en `scripts/checkModuleBoundaries.mjs`.
  Se adelanta desde la fase 3 a propósito: es la herramienta que mide si la
  fase 5 avanza, y sin ella toda la fase 2 se ejecuta a ciegas sobre fronteras.
  Después: F2-07 → F2-08 → F2-10 → F2-04 → F2-05 → F2-01/F2-02.
- **Verificaciones pendientes:** los contratos pgTAP (sin Docker en este entorno);
  Playwright E2E (no ejecutado); medición sobre Node 24.
- **Bloqueos:** F2-03 espera decisión de negocio (ADR-101).

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
