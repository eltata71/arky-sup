# Para revisión de José — no publicar sin su aprobación

Borrador de reporte de defecto a github.com/NousResearch/hermes-agent.
Escrito para que José decida si lo envía tal cual, lo edite, o no lo envíe.
No se ha publicado nada.

---

## Título propuesto

Decomposed child tasks never get `max_runtime_seconds`, so the runtime
watchdog never evaluates them

## Versión

v0.22.2+3.g788dcdc (commit `788dcdccbf7349330c5cd1d16073a8b40b20069a`)

## Resumen

`_insert_decomposed_child()` in `hermes_cli/kanban_db_graph.py` (line 200,
the `INSERT INTO tasks` statement) copies `title`, `body`, `assignee`,
`workspace_kind`/`workspace_path` and `tenant` from the parent row, but does
**not** copy or set `max_runtime_seconds` or `max_retries`. Every
auto-decomposed child is therefore created with `max_runtime_seconds = NULL`.

The dispatcher's own runtime killer — the query that finds and terminates
workers that have exceeded their time budget — explicitly excludes rows
where this column is `NULL`:

```python
# hermes_cli/kanban_db_dispatch.py, line 726
"WHERE t.status = 'running' AND t.max_runtime_seconds IS NOT NULL "
```

The effect is not that a decomposed child gets a generous or inherited
timeout — it gets **no timeout evaluation at all**. It can run for an
unbounded amount of time with nothing in the dispatcher noticing or acting
on it. `max_retries` has a working fallback chain (per-task override →
`kanban.failure_limit` → `DEFAULT_FAILURE_LIMIT`), so the retry side is not
affected — this report is specifically about `max_runtime_seconds`.

## Por qué importa

A fan-out that fails to converge, or a child task that goes off-script, has
no structural ceiling on how long it can keep running. We hit this in
practice: an auto-decomposed child was dispatched to modify source code
outside the scope it was given, and nothing in the dispatcher would have
stopped it on a timeout basis — it happened to exhaust its own turn/model
budget first. On a task with more budget, or a cheaper model, the outcome
would have been different.

This affects anyone running `kanban.auto_decompose: true` (the default),
not just our setup — any decomposed graph inherits the same gap.

## Reproducción

1. `auto_decompose: true` (default).
2. Create a task with a body that fans out into multiple children (triage
   or explicit `hermes kanban decompose <id>`).
3. Inspect a child row: `max_runtime_seconds` is `NULL`.
4. Let the child's worker run past whatever duration would normally trigger
   the runtime killer for a task that *does* have `max_runtime_seconds`
   set — it is never evaluated, because the killer's query excludes NULL.

## Arreglo sugerido

Have `_insert_decomposed_child()` copy `max_runtime_seconds` and
`max_retries` from the parent row (`root_row["max_runtime_seconds"]` /
`root_row["max_retries"]`) into the child `INSERT`, the same way it already
copies `workspace_kind`/`tenant`. If the parent itself has no explicit
value, a conservative default (even just the dispatcher's existing
`dispatch_stale_timeout_seconds`-scale ceiling) would at least put a bound
where there is currently none.

We are not proposing a patch ourselves — flagging it so the maintainers can
decide the right default and avoid two definitions of "reasonable timeout"
diverging.

## Lo que NO estamos reportando

The `kanban.max_in_progress` fail-open behavior ("non-Linux / read error →
no cap", documented in the code itself) is a separate, deliberate design
choice, not a bug — we are not raising it here.
