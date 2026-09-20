# ADR-102 — La decisión del ARB es una sola operación transaccional

**Fecha** 2026-09-20 · **Estado** aceptada · **Contexto** Encargos y Gobernanza

## Problema

Decidir sobre un encargo son hoy dos escrituras desde React
(`OfficeContext.decideEngagement`): `save_engagement` mueve el estado y escribe
el espejo `arbDecisions` dentro del documento; `record_arb_decision` escribe el
registro inmutable. Entre ambas no hay transacción, y **ningún resultado se
evalúa**: la función devuelve `ok: true` pase lo que pase.

Los dos estados intermedios son ambos malos, y el segundo es peor que perder el
dato: el encargo aparece decidido en pantalla porque el **espejo** se guardó,
mientras el registro a prueba de manipulación —el único que una auditoría
acepta— no tiene nada.

## Decisión

1. Una RPC `api.decide_engagement(p_engagement_id, p_expected_revision, p_decision)`
   hace en **una transacción**: comprobar permiso y estado, insertar la decisión
   inmutable, transicionar el encargo, escribir la entrada de auditoría, y
   devolver la fila con su nueva revisión.
2. **El espejo se deriva del registro, nunca al revés.** `load_engagements` ya
   reemplaza `arbDecisions` al leer; la RPC de decisión deja de aceptarlo del
   cliente.
3. El caso de uso `decideEngagement` en
   `services/architectureOffice/application/` es puro y devuelve un resultado
   tipado que distingue `success | conflict | permission-denied | invalid-state | failed`.
   React lo renderiza; no lo decide.
4. El veredicto se ata a la **revisión del encargo evaluada** (`decided_revision`),
   para que una firma sobre una versión que ya cambió sea detectable.

## Alternativas descartadas

- **Reintentar la segunda escritura.** Un reintento sobre una operación no
  idempotente que ya dejó el espejo escrito no arregla el estado intermedio.
- **Quitar el espejo.** Es útil para leer rápido. Lo que sobra no es el espejo
  sino que decida.

## Consecuencia

Tres RPC de encargo pasan a cuatro. `save_engagement` deja de ser la vía para
llegar a `delivered`; se mantiene su guarda `arb:decide` como defensa en
profundidad hasta el cierre de la fase 6.
