---
artifact_id: 02-ARCH-ADR-004
version: 1.0.0
status: Accepted
created: 2026-09-06
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
---

# ADR-004: Agent Definition y AgentRegistry

**Status:** Accepted
**Date:** 2026-09-06

---

## Context and Problem Statement

Las trece personas de la Oficina eran una buena *descripción* —rol, dominios,
capacidades, artefactos que producen y revisan, estándares— y no un *contrato*.
La diferencia se vio en cuatro defectos que compartían una sola avería: **la
ficha del agente declaraba gobierno y el motor leía otra cosa.**

- `maxConcurrentTasks` se validaba, se guardaba y se resolvía, y el runner leía
  el valor de fábrica.
- `modelTier` idem, y el invocador de coordinación no pedía nivel ninguno: los
  trece agentes corrían con el mismo modelo. `resolveAgentProfile` devolvía
  `applied?.modelTier ?? 'default'` — un literal, no la definición del agente.
- `requiresConfirmation` lo calculaban tres módulos y no lo leía nadie.
- Y la pregunta «¿qué agente?» se respondía en tres sitios: los buscadores de
  productor/revisor en `officeAgentPersonas`, la regla de workstream en
  `OfficeAgentRouter`, y filtrados en línea en cualquier otro. Tres puertas
  sobre una tabla es exactamente cómo la Oficina acabó con **dos tablas de
  enrutado que discrepaban** sobre si «Health Cloud» es trabajo de AWS.

Nada de eso lo podía detectar el compilador, porque no había contra qué
contrastarlo.

## Decision

**Un contrato (`agentDefinition.ts`), un registro (`agentRegistry.ts`), y la
ficha configurable como override validado encima.**

El contrato añade a la persona lo que hace falta para poder comprobarla:
`version`, `scope: { goals, nonGoals }` y `modelTier`. Cada campo entra porque
algo lo lee — no como hueco a rellenar:

- `nonGoals` **viaja al prompt**. Un especialista al que sólo se le dice lo que
  hace contesta a lo que le pongan delante, y el modo de fallo de una oficina de
  trece especialistas es uno contestando con seguridad fuera de su dominio.
- `modelTier` es de lo que la ficha hace override, en vez de un literal
  compartido: Carmen resuelve `deep` para una revisión regulatoria y Tomás
  `quick` para un informe de estado.
- `version` se estampa en la ficha resuelta (`definitionVersion`), para que una
  organización que personalizó a Sofía bajo la v1 pueda ver que su instrucción
  se ha reescrito desde entonces.

El registro es la única puerta: `get`, `list`, `findByCapability`,
`findByDomain`, `findThatProduce`, `findThatReview`, `canTakeWorkstream`,
`canDelegate`, `delegationTargets`, `validateDefinition`, `validate`.

**La topología de delegación se deriva de los roles, no se lista por agente.**
El coordinador reparte workstreams; el consolidador lee y firma; un especialista
responde el suyo. Escribir `delegatesTo` en trece registros sería el mismo hecho
dicho trece veces, y el decimocuarto agente sería el que lo dijera mal. Dos
reglas con dientes: **nadie delega en sí mismo** —la separación de funciones,
dicha para la delegación— y un especialista no delega, que es lo que mantiene la
profundidad de una operación en uno.

## El handoff, después

El contrato y el registro hicieron posible lo que faltaba para cerrar el
criterio «los handoffs inválidos son rechazados»: `agentHandoff.ts` declara el
envelope y el registro responde la topología con `canHandOff(source, target,
kind)`, del que `canDelegate` es el caso `workstream`. `AgentHandoffKind` vive
en `agentDefinition` —el contrato— para que ni el registro ni el envelope tengan
que importarse el uno al otro y el vocabulario tenga una sola definición.

Lo que el envelope compra, y que la cadena concatenada no podía dar: el rechazo
sucede antes de la llamada, el contexto viaja atribuido y acotado en número
—«no transfieras el historial entero» pasa de aspiración a comprobación— y el
rechazo se informa en el resultado en vez de desaparecer.

## Consequences

**La validación encontró dos incoherencias reales en su primera ejecución**, y
en la regla, no en los datos: Alejandro `consolidate` y Tomás `report` autoran
artefactos sin declarar `generate`. El vocabulario tiene **tres verbos de
autoría** y el contrato tenía que conocerlos todos. Que el primer uso de una
validación encuentre algo es la señal de que hacía falta.

**Lo que deliberadamente no se ha construido**, porque nada lo aplicaría y un
campo vacío en trece registros diría que el trabajo está hecho:

- **Tool policy.** Hay exactamente una herramienta en el producto. `allowedTools`
  y `requiresApproval` por agente serían una superficie de permisos con aspecto
  de gobierno que no gobierna nada. Va con el registro de herramientas, cuando
  haya herramientas que registrar.
- **Context policy.** El presupuesto de contexto es por llamada, no por agente,
  y ningún llamante puede expresar «este agente nunca ve el historial».
- **Memory policy** con scopes y TTL. El perfil lleva una lista de líneas; no hay
  scopes que conceder ni TTL que respetar.
