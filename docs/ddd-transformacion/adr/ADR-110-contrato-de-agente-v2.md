# ADR-110 — Contrato de agente v2: capas de instrucción, salidas estructuradas, presupuesto aplicado y herramientas de lectura

**Estado:** aceptado · **Fecha:** 2026-10-23 · **Plan:** `docs/plan-agentes-ia.md`, olas 15–19

## Contexto

ADR-004 declaró el agente como contrato (`version`, `scope`, `modelTier`) y el
registro como única puerta. Las auditorías del plan de agentes midieron lo que
el contrato todavía no garantizaba: la ficha configurada no llegaba a todos los
caminos, había dos composiciones de identidad, el texto de personas entraba sin
valla en los prompts, un revisor sin crítica aprobaba en silencio, los topes
estaban declarados pero no aplicados y los agentes no podían consultar el
sistema, sólo recibir texto.

## Decisión

1. **Una composición en capas.** `composeAgentInstruction` es el único sitio
   donde se escribe la identidad: contexto del llamante, contrato (no
   configurable), organización (la instrucción de la ficha *añade*, nunca
   reemplaza — D-A2), reglas de la Oficina al final. La ficha llega a los diez
   caminos en que un agente habla (`agentProfileParity.test.ts`).
2. **Lo no escrito por la aplicación va vallado** (`wrapUntrustedContent`),
   salvo la configuración que el agente debe seguir. El banco lo mide
   (`promptsConVallado`).
3. **Salidas estructuradas verificadas.** Las respuestas JSON se leen con
   `structuredOutput` y los esquemas de `orchestrationSchemas.ts`; lo que no
   cumple se descarta y se informa.
4. **El presupuesto se aplica.** `withHandoffBudget` corta con
   `HandoffBudgetExhausted` en vez de dejar que un topo declarado sea un deseo;
   `agentContextPolicy` limita qué lee cada rol y cuánto, y deja un manifiesto.
5. **Herramientas de lectura con molde.** `defineReadTool` rechaza descripciones
   pobres; `allowedToolsFor` fija por rol cuáles puede ver. Ninguna herramienta
   escribe: la escritura sigue siendo `modifyArtifact` con confirmación.
6. **Un revisor nunca aprueba en silencio** (D-A5): `evidence-only` con
   confirmación humana.
7. **Cada prompt tiene nombre, versión y huella**, y cada cambio se mide en el
   banco `eval:agents`, cuya línea base sólo mejora.

## Consecuencias

- Cambiar una plantilla sin subir su versión falla la suite.
- Una alternativa se adopta si el banco la mejora: 19.2 se midió y no se adoptó.
- La llamada estructurada de la coordinadora (18.0) tampoco pasó esa regla: el
  banco no puede mostrar su mejora, así que por D-A3 se aplicó B en la
  remediación 21.2. El encuadre es el plan determinista, sin llamada:
  `llamadasPorOperacion` 4,6 → 3,6 y menos tokens en cada caso del banco.
- No se construyó una política de memoria con ámbitos ni una de herramientas de
  escritura: serían superficie de gobierno sin nada que gobernar (ver ADR-004).
- El coste de un agente nuevo sube: ficha, esquema, caso de banco y entrada en
  el catálogo de prompts, en el mismo cambio.
