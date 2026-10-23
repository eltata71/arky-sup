# Runbook — diagnosticar un agente

Tres síntomas, en el orden en que se ven. Antes de nada: `npm run eval:agents`
dice si el comportamiento medido cambió; si el banco está en verde, el defecto
es de una configuración o de un caso que el banco no cubre.

## «El agente ignoró mi ficha»

1. Abrir `/agents` → la hoja del agente → sección de contrato: ¿la ficha está
   **vigente**, **derivada** o **sin registrar**? Una derivada se escribió contra
   un contrato anterior (`describeContractDrift`).
2. «Ver instrucción efectiva» (16.6) muestra la instrucción compuesta. Si la
   frase de la ficha no está, mirar si el agente está desactivado: Arky responde
   en su lugar (`resolveMentionedSpeaker`).
3. La instrucción de la ficha **añade** y va subordinada: si choca con el
   contrato o las reglas de la Oficina, ganan éstas. No es un fallo.
4. Si la ficha está y el agente no la sigue, buscar el sello del prompt
   (`id@vN#hash`) en el evento de coordinación y comprobar la versión de plantilla.
5. Un camino nuevo que habla como agente debe estar en
   `agentProfileParity.test.ts`; si no, es el defecto.

## «El revisor aprobó algo malo»

1. En el tablero, la revisión dice su `basis`. `evidence-only` significa que
   nadie revisó el contenido: la tarea se queda en `awaiting-review` hasta que
   una persona pulsa «Confirmar revisión» (queda en la auditoría con el actor).
2. Si el contenido se recortó (`truncated`), el revisor no vio todo.
3. Reproducir con un caso en `tests/fixtures/agent-evals/revision.json` con el
   defecto sembrado; si la métrica de recall no lo detecta, el caso es el
   entregable del arreglo.

## «La operación costó demasiado»

1. `buildAgentQualityReport` (panel en `/agents`) da llamadas, coste estimado y
   latencia por agente; el coste es una **estimación** con tabla de precios fechada.
2. La traza de la operación (`officeOperationTrace`) lista cada invocación con
   tokens y modelo.
3. Si el tope se alcanzó, hay un `HandoffBudgetExhausted`; el manifiesto de
   contexto (`describeContextManifest`) dice qué se recortó o se descartó.
4. Una operación con el máximo de especialistas pide aprobación antes de gastar
   (20.2); si se cancela no hay estado.
5. Cambiar `modelTier` en la ficha mueve el agente de modelo dentro de su proveedor.
