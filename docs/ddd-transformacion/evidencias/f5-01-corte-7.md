# F5-01, corte 7 — el asistente sin persona

**Fecha:** 2026-09-23 · **Rama:** `claude/repo-review-status-p6artd` · **Base:**
`origin/main` en `60dcc25` (arreglo del proxy fusionado, #62).

De los siete miembros de `assistantService`, salen del motor los cuatro que no
componen una persona. Viven en `services/ai/generation/assistant/` y entran
por `aiGateway`:

| Fichero | Contenido |
|---|---|
| `architectureConsultation.ts` | `consultArchitecture` — la sala de consultoría del Centro de Formación, con la persona del tutor |
| `conversationAnalysis.ts` | `analyzeChatForContext` y `runConsistencyCheck` |
| `multimodalChat.ts` | `processMultimodalChat` — creación guiada, análisis de documentos y asistente general |
| `assistantPorts.ts` | `AssistantConversationTurn` y `AssistantCourseSummary` |

Prompts, temperaturas, reintentos y tope de tiempo se conservaron. Dos cambios
que no son sólo mover:

- **Puertos en vez de tipos ajenos.** `services/chat` y el LMS importan
  `services/ai`; nombrar `ChatMessage` o `Course` desde la vertical cerraría un
  ciclo aunque el import fuera de tipo. Los puertos declaran los campos que el
  prompt lee y nada más, y `ChatMessage` y `Course` los cumplen
  estructuralmente: ningún llamante convierte nada.
- **El chequeo de consistencia comprueba que recibió una lista.** Antes
  devolvía lo que `JSON.parse` diera; un objeto suelto llegaba al modal como
  si fuera la lista de sugerencias. Ahora es `[]`, lo mismo que ante un fallo.

| Medida | Antes | Después |
|---|---:|---:|
| Importadores directos de `geminiService` dentro de `services/ai` | 2 | 2 |
| Líneas del motor según el gate | 2 809 | **2 631** |
| Tipos `any` | 15 | **14** |
| Imports profundos y dependencias declaradas | — | sin cambios |

## Por qué el importador no se retira

`chatWithProject`, `processAssistantChat` y `processAssistantChatStream`
componen la persona de la Oficina y —los dos del agente— su instrucción de
sistema. `services/agent` y `services/architectureOffice` importan
`services/ai`, así que llevarlos a la vertical tal cual añadiría dos ciclos
(`ai ↔ agent`, `ai ↔ architectureOffice`), exactamente los que las olas 1–2
rompieron y `moduleBoundaries.test.ts` afirma por nombre. Salen en el corte 8,
cuando la composición se les entregue en vez de buscarla (patrón
`AgentPersonaBriefing`). `agentExecutor` es el caso delicado: no puede importar
la Oficina, y la persona tiene que llegarle por su puerto.

## Pruebas

`__tests__/services/ai/assistantVertical.test.ts`: el motor ya no declara los
cuatro métodos; la vertical no importa ni el motor ni `chat`/`agent`/
`architectureOffice`; la fachada sólo delega al motor los tres turnos con
persona; la consulta lleva la persona del tutor; la nota de contexto devuelve
`null` ante `NO_CONTEXT` y ante un fallo; el chequeo de consistencia degrada a
`[]` ante algo que no es lista o ante un fallo; los ficheros subidos viajan sólo
con el último turno del usuario; y el asistente general recibe proyectos y
cursos como contexto.
