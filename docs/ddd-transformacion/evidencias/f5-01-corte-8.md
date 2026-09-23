# F5-01, corte 8 — el asistente con persona

**Fecha:** 2026-09-23 · **Rama:** `claude/repo-review-status-p6artd` · **Base:**
`origin/main` en `dbebc05` (corte 7 fusionado, #63).

Los tres turnos que el corte 7 dejó en el motor —`chatWithProject`,
`processAssistantChat` y `processAssistantChatStream`— componían su instrucción
con el compositor del agente y una persona de la Oficina, y `services/agent` y
`services/architectureOffice` importan `services/ai`. Moverlos tal cual habría
añadido dos ciclos. Se partieron por donde apunta la dependencia:

| Mitad | Dónde | Qué sabe |
|---|---|---|
| Preguntar al modelo sobre una instrucción compuesta | `services/ai/generation/assistant/agentTurn.ts`, `projectChat.ts` | el transporte, la herramienta `modifyArtifact`, el prompt propio del proyecto |
| Componer el turno del agente | `services/agent/agentConversation.ts` | su instrucción de sistema y su presupuesto de historial, y una persona que **recibe** |
| Decidir quién responde | `services/architectureOffice/application/projectConversation.ts`, `officePersonaForMessage` | las personas y los estándares de la Oficina |

Quién entrega la persona:

- **Pantallas** (`ChatInterface`, `AssistantPanel`): `hooks/useAssistantTurns`,
  que junta agente y Oficina. Así ninguna de las dos sube de dos módulos de
  servicio (una habría pasado a 3 y la otra a 4).
- **Ejecutor del agente** (el parche): `resolvePersona` en su entrada. Lo
  pasan `useAgentActions` y `OfficeRunnerAdapters`. El agente sigue sin saber
  que la Oficina existe.
- **Oficina** (`AssistantDock`, `ProjectCopilotChatModal`, `OfficeContext`,
  el invocador de coordinación): `chatWithProject` de la Oficina.
  `OfficeContext` lo sigue cargando en diferido, **por su fichero y no por el
  barril**: el provider está en el arranque, y el `import()` del barril subía
  la carga inicial de 309,6 a 310,7 KB gz porque arrastraba `agentDefinition`
  al chunk de entrada (medido comparando los sourcemaps de las dos
  construcciones). Es el séptimo caso de la tabla del barril en `CLAUDE.md`.

El comportamiento se conserva: la persona sale de la mención en el texto
(Arky si no hay ninguna), `personaOverride` sigue mandando sobre la mención,
y el turno en streaming sólo reintenta la apertura.

| Medida | Antes | Después |
|---|---:|---:|
| Importadores directos de `geminiService` dentro de `services/ai` | 2 | **1** |
| Líneas del motor según el gate | 2 631 | **2 443** |
| Dependencias declaradas del motor | 15 | **13** (sin `agent` ni `chat`) |
| `context -> services/ai` | declarada | **retirada** |
| Pares con import profundo | 56 | **54** (`context -> services/ai` se va; `context -> services/architectureOffice` 10 → 11 por la regla del barril) |
| Tipos `any` | 14 | **13** |
| `agentExecutor.ts` | 990 líneas | **982** (el parche a `requestArtifactPatch`) |
| Carga inicial | 309,5 KB gz | 309,6 KB gz |

Un techo sube, y su razón está al lado: `AssistantPanel.tsx` gana 77 bytes
por tomar el turno del agente de `useAssistantTurns`. La alternativa era un
tercer módulo de servicio en la pantalla.

## Pruebas

- `assistantVertical.test.ts`: el motor no declara ninguno de los siete turnos;
  ningún fichero de la vertical importa el motor, `chat`, `agent` ni la
  Oficina; la fachada no importa el motor. El turno del agente usa la
  instrucción que recibe y lee `modifyArtifact`; sin artefacto no ofrece la
  herramienta; el streaming emite deltas, conserva la primera llamada y
  reenvuelve un fallo a mitad. El chat del proyecto lleva el historial dentro
  del prompt. La Oficina enmarca con la persona nombrada y sus estándares, y
  `personaOverride` manda sobre la mención.
- `agentExecutor.test.ts`: el parche habla con la persona que resuelve
  `resolvePersona` a partir de su instrucción y ofrece la herramienta. Los
  mocks van ahora al límite de la IA (`runAgentTurn`), no al motor.
- `OfficeContext.test.tsx`: el refinamiento del charter falla en la respuesta
  del modelo (`generateProjectChatReply`), y el charter determinista se
  mantiene.
- `engineImporters.test.ts`: la lista queda en `artifactGenerationService`.
