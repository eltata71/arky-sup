# Transformación DDD / monolito modular de ARKY — ubicación canónica

Esta carpeta es **el** registro de esta transformación. Todo lo demás bajo
`docs/` que hable de olas, fases o planes anteriores es **histórico** y se lee
como antecedente, no como estado.

| Documento | Qué contiene |
|---|---|
| `00-linea-base.md` | Cifras medidas hoy, con comando y salida. La autoridad sobre el estado. |
| `01-hallazgos.md` | Los doce hallazgos del encargo, clasificados y con evidencia. |
| `02-plan-maestro.md` | Las seis fases, su objetivo y su criterio de cierre. |
| `03-backlog.md` | Todas las tareas, con identificador, criterios y estado. |
| `04-lenguaje-ubicuo.md` | El vocabulario, y las colisiones resueltas. |
| `05-mapa-contextos.md` | Contextos, relaciones proveedor/consumidor y contratos publicados. |
| `06-propiedad-datos.md` | Matriz de propiedad: tabla, RPC, contexto dueño, consumidores. |
| `07-invariantes.md` | Catálogo de invariantes y **dónde se aplica cada una**. |
| `08-avance.md` | Registro de avance y punto de reanudación. |
| `adr/` | Decisiones arquitectónicas de esta transformación (ADR-1xx). |
| `evidencias/` | Salidas de comandos, censos y capturas de medición. |

## Antecedentes (histórico, no estado)

- `docs/top-10-monolito-modular-ddd-2026-09-01.md` — censo original.
- `docs/plan-ddd-monolito-modular-2026-09-02.md` — olas 1–5, ejecutadas.
- `docs/plan-transformacion-supabase-ddd.md` + `docs/fase-*/` — la migración a Supabase (F0–F9).
- `docs/auditoria-f0-f8-2026-09-18.md` — auditoría de cierre de esas fases.

## Reglas de este registro

1. **Una tarea no se cierra por estar documentada.** Exige implementación,
   evidencia ejecutada y commit.
2. **Una cifra sin comando es una opinión.** Toda métrica lleva el comando que
   la produjo.
3. **Una comprobación que no se pudo ejecutar se registra como no ejecutada**,
   con el motivo exacto. Nunca se declara validada.
