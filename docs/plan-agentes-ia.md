# Plan de agentes de IA: configuración, orquestación y generación de artefactos

**Fecha:** 2026-10-13
**Estado:** **aprobado por el propietario el 2026-10-13**, con D-A1 = A (las
fichas son de cada usuario) y D-A2…D-A5 según la recomendación (sección 7.2)
**Continúa:** `docs/plan-clase-mundial.md` (olas 9–14, cerrado el 2026-10-13 con
#234). La transformación DDD está cerrada desde el 2026-09-27.
**Numeración:** las olas siguen a las de los planes anteriores y empiezan en la
**15**. Las tareas se identifican `15.0`, `15.1`…
**Alcance:** todo lo que hace que un agente de IA *exista, se configure, se
coordine, actúe y produzca o revise un artefacto*: `services/architectureOffice/`,
`services/agent/`, `services/ai/` (en lo que toca a agentes), `hooks/` y
`components/` que los exponen, `pages/AgentsPage.tsx` y las RPC de
`api.agent_profiles` y `api.agent_actions`.

---

## 0. Cómo leer este documento

Las secciones 1 a 3 son el diagnóstico: qué se revisó, qué ya está a la altura y
no se toca, y qué se encontró, con evidencia `fichero:línea`. La sección 4 dice
contra qué referentes se mide «profesional» y lo traduce a cifras. Las secciones
5 a 8 son el plan: principios, olas y tareas con prioridad, complejidad y
criterios de aceptación, orden y seguimiento. La sección 9 es la plantilla con la
que un modelo de IA ejecuta cada tarea, y la 10 el glosario mínimo.

Cada tarea está escrita para que **una sesión de un asistente de código la
ejecute de principio a fin en una PR**, con el flujo del repositorio: rama desde
`main`, `npm run quality` en verde, PR, CI, *squash-merge* y comprobación del
despliegue.

**Escalas usadas en todo el documento.**

| Prioridad | Significado |
|---|---|
| **P0** | Corrige algo que hoy es falso o inseguro: el producto dice que hace X y no lo hace, o un dato de usuario puede gobernar a un agente. Va primero |
| **P1** | Sin esto no se alcanza el estándar profesional (medición, contratos, presupuesto real) |
| **P2** | Eleva la calidad o la experiencia de forma medible |
| **P3** | Opcional o condicionado a una decisión/medición previa |

| Complejidad | Esfuerzo orientativo | Señal |
|---|---|---|
| **S** | < 1 día | un módulo, sin cambio de contrato público |
| **M** | 1–2 días | dos o tres módulos, un contrato nuevo o cambiado |
| **L** | 3–5 días | atraviesa contextos, o añade un banco / una migración |
| **XL** | > 5 días | se parte en cortes, cada uno su PR |

---

## 1. Qué se revisó

Se siguió el recorrido de un agente desde que existe hasta que su trabajo queda
guardado, y en cada paso se leyó el código que lo atiende.

| Área | Ficheros principales |
|---|---|
| Definición y registro | `domain/agentDefinition.ts`, `domain/agentRegistry.ts`, `domain/officeAgentPersonas.ts` (13 personas) |
| Ficha configurable | `domain/officeAgentProfile.ts`, `infrastructure/OfficeAgentProfileRepository.ts`, `hooks/useAgentProfiles.ts`, `pages/AgentsPage.tsx`, `components/architectureOffice/agentProfile/*`, RPC `api.save_agent_profile` |
| Orquestación | `application/officeCoordination.ts`, `application/officeOrchestration.ts`, `application/officeCoordinationInvoker.ts`, `domain/agentHandoff.ts`, `domain/officeConsolidationReview.ts`, `domain/OfficeAgentRouter.ts`, `application/copilotTurn.ts` |
| Encargos (DAG) | `application/OfficeEngagementRunner.ts`, `infrastructure/OfficeRunnerAdapters.ts`, `application/agentConfiguration.ts`, `domain/OfficeEngagementPlanner.ts`, `context/OfficeContext.tsx` |
| Agente ejecutor | `services/agent/agentExecutor.ts` (900 líneas), `agentPlanner.ts`, `intentClassifier.ts`, `intentClassifierLLM.ts`, `agentConfirmationGate.ts`, `agentContextComposer.ts`, `memoryExtractor.ts` |
| Capa de IA | `services/ai/tools/`, `services/ai/guardrails/`, `services/ai/tracing/`, `services/ai/structuredOutput/`, `lib/ai/modelCatalog.ts`, `services/ai/generation/assistant/*` |
| Superficies | `hooks/useArtifactPersona.ts`, `hooks/useAgentActions.ts`, `hooks/useAssistantTurns.ts`, `components/architectureOffice/AssistantDock.tsx`, `TeamCoordinationPanel.tsx` |
| Pruebas y bancos | `__tests__/architectureOffice/` (36 ficheros), `__tests__/agent/`, `services/agent/__tests__/`, bancos `diagram-evals`, `artifact-evals`, `export-evals` |
| Documentación | `docs/agentes-anthropic-alineacion.md`, `docs/oficina-arquitectura.md`, `docs/arquitecto-agente.md`, ADR-004 |

---

## 2. Lo que ya está a la altura, y no se toca

Este plan **no** reabre trabajo bien hecho. Lo siguiente es la base sobre la que
construye; una tarea que lo degrade falla su criterio de aceptación.

- **Un registro como única puerta** (`agentRegistry`), con validación del roster
  completo (`validateAgentRegistry`) y escáner que impide filtrar personas
  fuera de él (`agentRegistrySingleDoor.test.ts`).
- **El handoff es un contrato** (`agentHandoff.ts`): objetivo, criterios,
  referencias atribuidas y valladas, salida esperada, presupuesto, `runId`; se
  rechaza *antes* de gastar una llamada si la topología no lo permite.
- **Enrutado determinista** sin llamada al modelo, con una sola tabla
  (`OfficeAgentRouter`) y límites declarados (4 especialistas, 3 en paralelo,
  1 corrección).
- **Evaluador-optimizador barato**: criterios mecánicos, una sola corrección,
  y se conserva la respuesta original si la corrección falla.
- **La coordinación se emite, no se reconstruye** (`CoordinationEvent`).
- **Separación de funciones** productor ≠ revisor, coordinador ≠ consolidador,
  aplicada en cliente **y** en servidor (`save_agent_profile` rechaza tocar
  `orchestrationRole`/`producesArtifactTypes`/`reviewsArtifactTypes`).
- **Puerta de confirmación en el ejecutor** (`agentConfirmationGate`), único
  sitio por el que pasan todos los llamantes.
- **Guardarraíles del kernel encima de reintentos y fallback**
  (`services/ai/guardrails`), con vallado `wrapUntrustedContent` en la mayoría
  de los caminos de generación.
- **Reconstrucción de una ejecución** (`runId`, `traceIds`, `describeRun`).
- **Tres patrones distintos donde corresponde**: captura asistida y guía de la
  plataforma son un agente y una llamada; la Oficina es orquestador-trabajadores.

**El hallazgo general.** La *arquitectura* de agentes es sólida y está bien
razonada; lo que falla es la **coherencia de extremo a extremo**: la ficha del
agente, que el producto presenta como «lo que el agente es en esta
organización», sólo llega a tres de los diez caminos por los que un agente
habla; los contratos (presupuesto, salida esperada) se declaran pero no se hacen
cumplir; y **no existe un banco de evaluación de agentes**, así que ninguna de
estas regresiones podía verse. Este plan cierra esa distancia antes de añadir
capacidades nuevas.

---

## 3. Hallazgos

Ordenados por gravedad dentro de cada bloque. **C** = corrección (el producto
dice algo que el código no hace), **S** = seguridad, **G** = gobierno, **Q** =
calidad de la salida, **O** = observabilidad/coste, **E** = experiencia.

### 3.1 La ficha del agente no llega a donde el agente habla *(C)*

CLAUDE.md afirma: *«The card reaches every place the agent speaks»*. Medido:

| Camino por el que habla un agente | ¿Lee la ficha? | Evidencia |
|---|---|---|
| Coordinación del dock (`AssistantDock` → `coordinateRequest`) | Parcial (ver A2) | `AssistantDock.tsx:101-103` |
| Captura asistida | Sí | `captureAssistance.ts:206` |
| Guía de la plataforma | Sí | `platformGuidance.ts:140` |
| Generación de artefactos (Workspace, cola) | **No** | `hooks/useArtifactPersona.ts:18` usa `composeArtifactPersonaInstruction` sobre la persona de fábrica |
| Ejecutor del agente (copiloto, acciones) | **No** | `hooks/useAgentActions.ts:393` `resolvePersona: officePersonaForMessage` |
| Chat del asistente | **No** | `hooks/useAssistantTurns.ts:90` |
| Encargo: producir artefacto | **No** (sí el *tier*) | `OfficeRunnerAdapters.ts:186`, `buildProductionInstruction` lee `OFFICE_AGENT_PERSONAS` |
| Encargo: revisar | **No** | `buildReviewPrompt` lee la persona de fábrica |
| Encargo: consolidar | **No** | `buildConsolidationPrompt`, `OfficeRunnerAdapters.ts:405-411` |
| Orquestación del copiloto (`runCopilotOrchestration`) | **No** (ni ficha, ni desactivados, ni tiers, ni eventos) | `copilotTurn.ts:89-96` |

| # | Hallazgo | Evidencia |
|---|---|---|
| **A1** | **La ficha llega a 3 de 10 caminos.** Cambiar la instrucción o el conocimiento de un agente no cambia los artefactos que produce, ni las revisiones que firma, ni el chat | Tabla anterior |
| **A2** | **Donde sí llega, llega duplicada y contradictoria.** El dock antepone la ficha personalizada al *mensaje* (`officeCoordination.ts:322-325`), mientras `chatWithProject` compone el *system prompt* con la persona **de fábrica** (`projectConversation.ts:38`). Un agente con instrucción reemplazada recibe la vieja en el sistema y la nueva en el turno; el comentario de `customizedAgentBriefings` dice justo lo contrario («decirle dos veces lo mismo enseña al modelo que la repetición es la señal») | `officeAgentProfile.ts:338-356`, `projectConversation.ts:29-40` |
| **A3** | **La ficha personalizada pierde el alcance.** `buildAgentProfileBriefing` no incluye `scope.goals` ni `scope.nonGoals` ni los estándares; la de fábrica sí (`buildOfficePersonaInstruction`). Personalizar un agente le quita la frontera de dominio que ADR-004 considera esencial | `officeAgentProfile.ts:317-336` frente a `officeAgentPersonas.ts:348-366` |
| **A4** | **Un agente desactivado sigue trabajando.** El planificador de encargos y el router no leen `enabled`; una mención `@Alias` resuelve aunque el agente esté apagado; sólo el plan del dock lo respeta | `OfficeEngagementPlanner.ts`, `OfficeAgentRouter.ts` (sin `enabled`), `officeAgentPersonas.ts:335-346` |
| **A5** | **El alias configurado no se ve.** 56 lecturas directas de `OFFICE_AGENT_PERSONAS[...]` en eventos, tablero y paneles muestran el nombre de fábrica aunque la organización lo haya renombrado | `officeCoordination.ts` (10), `TeamCoordinationPanel.tsx` (6), `OfficeEngagementRunner.ts` (6)… |
| **A6** | **Hay dos orquestaciones.** `coordinateRequest` (dock: eventos, ficha, desactivados, tiers) y `runCopilotOrchestration` (copiloto: nada de eso). La misma pregunta convoca equipos distintos según la superficie | `copilotTurn.ts:84-104` |

### 3.2 Un dato de usuario puede gobernar a un agente *(S)*

| # | Hallazgo | Evidencia |
|---|---|---|
| **A7** | **El agente de un encargo se elige por mención en el texto, nunca por la tarea.** `buildProductionInstruction` escribe `Solicitud original: ${engagement.brief}` *antes* de `Actúas como…`, y el ejecutor resuelve la persona con `officePersonaForMessage` (`@Alias`). Un brief que contenga «@Carmen» hace que la tarea de Felipe la firme Carmen: el mismo secuestro que `projectConversation.ts` documenta y evita con `personaOverride`. **Medido en 15.0, es más amplio:** sin mención, la persona activa del prompt de sistema es **Arky**, así que ninguna tarea de un encargo se produce con la persona de su asignado (`personaFijada` = 0 %); «Actúas como Felipe» sólo viaja en el texto del turno | `OfficeRunnerAdapters.ts:112`, `:186`; `officeShared.ts:23-30` |
| **A8** | **Campos de usuario sin vallar en prompts de agentes.** El brief del encargo (producir y consolidar), la solicitud en el prompt del coordinador y en el objetivo de cada handoff, el contenido revisado (`artifact.content.slice(0, 12_000)`), el conocimiento y la memoria de la ficha, la memoria del agente en `agentContextComposer` y el mensaje del clasificador LLM (entre `"""`) viajan sin `wrapUntrustedContent` | `OfficeRunnerAdapters.ts:112,292,411`; `officeOrchestration.ts:191`; `officeAgentProfile.ts:327-334`; `intentClassifierLLM.ts:69-71` |
| **A9** | **La memoria persistente no tiene procedencia ni caducidad.** Una línea extraída por el modelo de una conversación (que puede contener texto de un documento subido) se guarda y se inyecta en todos los turnos posteriores: es el vector de *memory poisoning*. No hay aprobación, supersesión ni TTL | `memoryExtractor.ts`, `agentContextComposer.ts:159-182`, `agentDefinition.ts:27-28` lo reconoce |
| **A10** | **El servidor acepta cualquier ficha.** `save_agent_profile` sólo veta las tres claves de gobierno: no limita longitudes (el cliente corta a 280/1 200 caracteres), ni claves desconocidas, ni el *tier*; no hay revisión optimista (último en escribir gana) ni bitácora. Una llamada directa a la RPC mete un prompt de cualquier tamaño en el agente | `supabase/migrations/20260919043543_retirement_completeness.sql:236-262` |

### 3.3 Los contratos se declaran pero no se cumplen *(G/O)*

| # | Hallazgo | Evidencia |
|---|---|---|
| **A11** | **El presupuesto del handoff no se aplica.** `budget.maxAiCalls` se valida ≥ 1 y nadie lo cuenta: el invocador no sabe que existe | `agentHandoff.ts` (sólo `validateHandoff`), `officeOrchestration.ts:240,309` |
| **A12** | **El encargo cuenta llamadas que no son las reales.** Producir un artefacto se cobra como `aiCalls: 1` aunque la generación haga brief, generación, crítica y refinamiento; el tope del encargo mide un número inventado | `OfficeRunnerAdapters.ts:197,209,441,448` |
| **A13** | **No se miden tokens, latencia ni coste por agente.** `AITrace.usage` existe en el kernel, pero ni la operación coordinada ni el encargo lo agregan; la telemetría de la Oficina sólo cuenta llamadas | `services/ai/tracing/AITraceBuilder.ts:122-161`, `officeTelemetry.ts:122-126` |
| **A14** | **La coordinación no se puede cancelar ni tiene tiempo máximo.** `CoordinateRequestInput` no acepta `AbortSignal`; el runner sí (`options.signal`) | `officeCoordination.ts:152-183` |
| **A15** | **El ejecutor anuncia éxito sin confirmación de persistencia.** `AgentArtifactStore.updateArtifact` devuelve `void`; «Cambios aplicados» se emite antes de saber si la base aceptó la escritura | `agentExecutorContracts.ts:15`, `agentExecutor.ts` (fase `persisting` → `done`) |

### 3.4 La salida de un agente no tiene forma *(Q)*

| # | Hallazgo | Evidencia |
|---|---|---|
| **A16** | **Un revisor inalcanzable aprueba.** Si la llamada al modelo falla o su JSON no se parsea, `critique` queda vacía y el veredicto es `approved` en cuanto la evidencia determinista no bloquea. El comentario dice «must not silently approve»; el código aprueba con el resumen «El entregable cumple su contrato» | `OfficeRunnerAdapters.ts:336-372` |
| **A17** | **La crítica del revisor se pide como JSON sin esquema y a temperatura 0,7.** Va por el chat del proyecto (`projectChat.ts:47`), sin `responseSchema`; se lee con un *cast* (`parseStructured<ModelCritique>`). El contenido revisado se trunca a 12 000 caracteres sin decirlo al revisor | `OfficeRunnerAdapters.ts:292,342` |
| **A18** | **Especialistas, coordinador y consolidador devuelven texto libre.** El evaluador de la consolidación tiene que buscar palabras («Conditional», alias) con expresiones regulares; el brief del coordinador se pasa como contexto pero **no puede cambiar nada** del plan (es decorativo: una llamada que no decide) | `officeOrchestration.ts:190-205`, `officeConsolidationReview.ts:59` |
| **A19** | **El evaluador-optimizador sólo existe en un camino.** La consolidación de un encargo (`createConsolidatePort`) no pasa por `evaluateConsolidation` | `grep evaluateConsolidation` → sólo `officeOrchestration.ts` |
| **A20** | **El clasificador de intención LLM no conoce la mitad del vocabulario.** `VALID_TYPES` no incluye `artifact.create`, `artifacts.batch` ni `memory.save.*`; el esquema declara `type` como cadena libre, sin `enum` | `intentClassifierLLM.ts:24-32`, `:73-87` |
| **A27** | **Nueve señales del router nunca coinciden** *(medido en 15.0)*. Son raíces con `\b` final —`integraci`, `modernizaci`, `suscripci`, `regulator`, `resilien`, `tarificaci`, `analitic`, `asegurad`, `artefact`— y la palabra sigue después de la raíz, así que «integración» no convoca a Mauricio, «suscripción» a Sofía ni «regulatorio» a Carmen | `OfficeAgentRouter.ts:82-89` |
| **A21** | **Los niveles de modelo no se distinguen.** `quick` y `default` resuelven al mismo modelo (`gemini-2.5-flash`), así que la ficha que «baja a Tomás a rápido» no cambia nada | `lib/ai/modelCatalog.ts:33-34` |

### 3.5 No se puede medir la calidad de un agente *(O/Q)*

| # | Hallazgo | Evidencia |
|---|---|---|
| **A22** | **No hay banco de evaluación de agentes.** Existen `diagram-evals`, `artifact-evals` y `export-evals`; no hay casos que digan si una solicitud convoca a los especialistas correctos, si una intención se clasifica bien, si un revisor detecta un defecto sembrado o si una consolidación cita a todos | `tests/fixtures/` y `package.json:20-22` |
| **A23** | **Los prompts de los agentes no tienen identidad.** Ninguna traza registra qué versión de qué prompt produjo una respuesta; mejorar una instrucción no deja rastro comparable | `buildOfficePersonaInstruction`, `buildReviewPrompt`, `buildConsolidationPrompt` son plantillas sin id |

### 3.6 Herramientas y contexto *(Q/E)*

| # | Hallazgo | Evidencia |
|---|---|---|
| **A24** | **Los agentes no pueden buscar contexto: se les precarga.** Hay una sola herramienta (`MODIFY_ARTIFACT_TOOL`); un especialista no puede leer otro artefacto, consultar el grafo de conocimiento o los estándares bajo demanda. ADR-004 dejó fuera la política de herramientas porque no había herramientas que gobernar: el diagnóstico es correcto, la consecuencia es que el contexto se decide por adelantado y sin medir | `services/ai/tools/artifactTools.ts:26`, `agentDefinition.ts:15-30` |
| **A25** | **No hay política de contexto por rol.** El especialista recibe el proyecto entero (carrier con `realProject.artifacts`), el consolidador los análisis, y nada declara qué *debe* y qué *no debe* ver cada rol, ni un presupuesto en tokens | `officeCoordinationInvoker.ts:45-66` |
| **A26** | **La ficha no se puede probar.** El editor permite cambiar la instrucción y restaurar valores de fábrica, pero no ver el *prompt efectivo* ni ensayar el agente antes de guardar; el error se descubre en un entregable real | `AgentProfileEditor.tsx` |

---

## 4. Qué significa «profesional» aquí

### 4.1 Referentes

Se citan por nombre; el entorno de revisión no descargó los textos, así que no
hay citas literales (igual que en `docs/agentes-anthropic-alineacion.md`). **La
tarea que dependa de una lectura concreta debe verificarla contra la versión
vigente del documento antes de implementar.**

| Referente | Principio | Dónde lo toma este plan |
|---|---|---|
| Anthropic — *Building effective agents* | El patrón más simple; flujos antes que agentes; orquestador-trabajadores y evaluador-optimizador con condiciones de parada | Se conserva (sección 2); 17.3 hace cumplir las paradas |
| Anthropic — *Writing effective tools for agents* / interfaz agente-computador | Herramientas pocas, bien descritas, con errores accionables y respuestas acotadas; evaluarlas con casos reales | Ola 19 |
| Anthropic — *Effective context engineering for AI agents* | El contexto es un recurso finito: lo mínimo de alta señal, recuperación bajo demanda, compactación | 19.1 |
| Anthropic — sistema multiagente de investigación | Delegación con objetivo, formato de salida, herramientas y límites explícitos; esfuerzo escalado a la complejidad; trazas para depurar | 18.0, 17.3, 20.0 |
| Anthropic — guía de ingeniería de prompts | *System prompt* para el rol, etiquetas para separar datos de instrucciones, salidas estructuradas, ejemplos | 16.0, 17.0, 18.0 |
| OpenAI — *A practical guide to building agents* | Agente = modelo + herramientas + instrucciones; guardarraíles en capas; intervención humana en acciones de alto riesgo; patrones gestor y descentralizado | 16.0, 17.x, 20.2 |
| OpenAI — Agents SDK (agentes, *handoffs*, guardarraíles, trazas, sesiones) | El handoff es una primitiva tipada; cada ejecución produce una traza de *spans* | Ya hay contrato de handoff; 20.0 añade la traza en árbol |
| OpenAI — *Structured Outputs* y *Evals* | La salida se valida contra esquema; la calidad se mide con conjuntos de casos y evaluadores | 18.x, 15.0 |
| OpenAI — *Model Spec* (jerarquía de instrucciones) | Plataforma > desarrollador > usuario; el contenido de herramientas/documentos no da órdenes | 16.0 (capas), 17.0 |
| OWASP — Top 10 para aplicaciones LLM (2025) | LLM01 inyección, LLM02 divulgación, LLM05 manejo de salida, LLM06 agencia excesiva, LLM07 filtración del *system prompt*, LLM10 consumo sin límite | 17.x |
| NIST AI RMF / ISO/IEC 42001 | Gobierno, trazabilidad de cambios, medición continua | 16.4, 15.x, 20.1 |

### 4.2 Cuadro de mando: línea base y objetivo

| Métrica | Hoy (medido en esta revisión) | Objetivo | Cómo se mide |
|---|---|---|---|
| Caminos donde la ficha llega al prompt | 3 de 10 → **10 de 10** (16.1 corte 1) | 10 de 10 | Prueba de paridad de caminos (16.1) |
| Prompts con capa de persona duplicada o contradictoria | ≥ 1 (dock) → **0** (16.0) | 0 | Prueba de 16.0 sobre el prompt compuesto |
| Agentes desactivados que pueden recibir trabajo | encargos y menciones → **0 caminos** (16.1) | 0 caminos | Prueba de 16.1 |
| Interpolaciones de texto de usuario sin vallar en prompts de agentes | 8 de 8 sitios medidos (15.0) → **0** (17.0) | 0 | `eval:agents` (`promptsConVallado`) y escáner de 17.0 |
| Revisiones aprobadas sin crítica del modelo y sin decirlo | 3 de 3 casos (15.0) → **0** (17.1) | 0 | `eval:agents` (`aprobacionesSinCritica`) |
| Presupuesto de handoff aplicado | 0 % | 100 % de las invocaciones | Prueba de 17.3 |
| Llamadas de IA contadas frente a reales en un encargo | 1 por tarea (literal) | igual a las reales | Prueba de 17.3 con transporte simulado |
| Tokens / coste por operación y por agente | sin medir | medidos y visibles | 15.2 |
| Roles con salida validada por esquema | 0 de 4 (especialista, coordinador, consolidador, revisor) | 4 de 4 | 18.0, 18.1 |
| Banco de evaluación de agentes | 69 casos, 5 familias + 8 sitios de vallado, en CI (15.0) | ≥ 60 casos | `npm run eval:agents` |
| Precisión del enrutado de especialistas | 81,5 % (15.0) → **100 %** (16.8) | ≥ 90 % de los casos del banco | `eval:agents` |
| Precisión del clasificador de intención | **60 %** (15.0) | ≥ 90 % | `eval:agents` |
| Recall del revisor sobre defectos sembrados | **100 %** (15.0; lo detecta la evidencia determinista) | ≥ 85 % (determinista + modelo simulado) | `eval:agents` |
| Tareas de encargo producidas con la persona de su asignado | 0 % (15.0) → **100 %** (16.2) | 100 % | `eval:agents` (`personaFijada`) |
| Prompts de agente con id y versión en la traza | 0 → **100 %** de las invocaciones del banco (15.1) | 100 % | `eval:agents` (`invocacionesConSello`) |
| `diagram-evals` / `artifact-evals` / `export-evals` | línea base vigente | sin regresión | sus comandos |

---

## 5. Principios de ejecución

1. **Lo que es falso va primero.** La ola 16 hace verdad lo que el producto ya
   promete (la ficha manda) antes de prometer nada nuevo.
2. **Medir antes de cambiar.** La ola 15 abre con el banco; toda tarea registra
   su cifra antes y después en la PR. Una mejora de prompt sin cifra del banco
   no se fusiona.
3. **Una sola definición de cada cosa.** Un compositor de persona, una
   orquestación, una forma de contar el presupuesto. Dos copias de una regla
   divergen: es lo que pasó con las dos tablas de enrutado y vuelve a pasar con
   los dos compositores.
4. **Capas de instrucción, nunca sustitución.** El *system prompt* de un agente
   se compone en capas fijas: **plataforma** (seguridad, honestidad, formato;
   no editable) → **contrato del agente** (rol, alcance, no-objetivos,
   estándares) → **organización** (ficha: conocimiento, memoria, instrucción
   adicional) → **tarea** (handoff). Una capa inferior nunca anula a una
   superior. Todo lo que no escribió la aplicación va vallado.
5. **El modelo propone, el código decide, la persona aprueba.** Los
   veredictos, los vetos y los topes son deterministas; el modelo aporta
   análisis dentro de un esquema; lo irreversible pide confirmación humana.
6. **Contratos que se cumplen o no se declaran.** Un campo del contrato (presupuesto,
   salida esperada, política de herramientas) entra cuando algo lo hace cumplir
   y una prueba falla si deja de hacerlo — la regla de ADR-004, aplicada a lo
   que ya se declaró.
7. **Ni una regla del repositorio se relaja.** Fronteras (`modules.json`), pureza
   del dominio, `any`, tamaño, presupuestos de bundle por ruta, «la IA bajo
   demanda» (`services/ai/lazy`). Subir un techo se justifica con lo medido.
8. **Coste explícito.** Toda llamada nueva a un modelo declara su tier, su tope
   y su motivo; ninguna ola puede subir las llamadas medias por operación sin
   que el banco muestre la ganancia.
9. **Migraciones sólo con aprobación** y antes del código que las usa
   (`docs/operacion/runbook-migraciones.md`).
10. **Documentación en el mismo commit.** Regla nueva → CLAUDE.md **y**
    AGENTS.md con su ancla en `assistantDocsParity.test.ts`; pantalla movida →
    `lib/platformGuide/platformGuideTopics.ts`; cifra nueva → esta tabla.

---

## 6. Olas y tareas

Además de los suyos, **todas** las tareas cumplen los criterios comunes:

> **CA-común:** `NODE_OPTIONS=--max-old-space-size=3072 npm run quality` en verde
> (typecheck, strict, lint 0/0, presupuestos de fronteras, tamaño, `any`,
> cobertura por encima de los suelos, build, bundle por ruta y secretos);
> pruebas nuevas que **fallan con el código anterior** (`.test.ts` sin DOM,
> `.test.tsx` con DOM); `eval:agents` (desde 15.0), `eval:diagrams`,
> `eval:artifacts` y `eval:exports` sin regresión; CLAUDE.md y AGENTS.md
> actualizados si cambia una regla; la fila de la sección 8 con el número de PR;
> una PR por tarea, fusionada y con el despliegue de producción en verde.

Formato de cada tarea: **Prioridad · Complejidad · Tipo · Depende de · Cierra**,
y después **Objetivo**, **Leer antes**, **Cambios**, **Fuera de alcance**,
**Criterios de aceptación (CA)**, **Métrica** y **Riesgos**.

---

### Ola 15 — Medir a los agentes *(fundación)*

**Meta:** que toda mejora posterior se demuestre con una cifra.
**Cierre de la ola:** `npm run eval:agents` corre en CI con línea base
registrada, y cada invocación de agente deja id de prompt, tokens y latencia en
su traza.

#### 15.P Reservar tareas de este plan *(P0 · S · operación · — · —)*
- **Objetivo:** que el protocolo multiagente funcione con este plan.
- **Cambios:** `scripts/agentes/nueva-tarea.sh` (y `estado.sh` si aplica) acepta
  el plan y el prefijo de rama por parámetro o variable (`PLAN=docs/plan-agentes-ia.md`,
  `PREFIJO=agentes`), conservando el comportamiento actual por defecto;
  `docs/operacion/multiagente.md` lo documenta.
- **CA:** reservar `15.0` crea `agentes/15.0-<tema>` y la PR en borrador; una
  tarea marcada «Hecha» en este plan se rechaza; el uso actual con
  `plan-clase-mundial.md` no cambia (prueba en `__tests__/scripts/`).

#### 15.0 Banco de evaluación de agentes *(P0 · L · medición · 15.P · A22)*
- **Objetivo:** medir enrutado, intención, handoff, revisión y consolidación sin
  llamar a ningún proveedor.
- **Leer antes:** `__tests__/diagram/evals/` y `__tests__/artifacts/evals/`
  (copiar su forma: fixtures escritos a mano, transporte reemplazado,
  `linea-base.json` monótona, `defectosConocidos` con la tarea que los cierra).
- **Cambios:**
  - `tests/fixtures/agent-evals/` con cinco familias, cada caso un JSON que dice
    que **mide la canalización, no el modelo**:
    1. **Enrutado** (≥ 20): solicitud + nivel → especialistas esperados y
       prohibidos (p. ej. «Health Cloud» no convoca a Felipe).
    2. **Intención** (≥ 15): mensaje + artefacto activo → tipo, impacto y
       `requiresConfirmation` esperados, incluidos ambiguos.
    3. **Handoff y topología** (≥ 8): handoffs válidos e inválidos, tope de
       referencias, agente desactivado, persona por argumento (caso A7).
    4. **Revisión** (≥ 10): artefactos con **defectos sembrados** (tabla sin
       criterios, ADR sin alternativas, C4 sin leyenda, PHI sin clasificar) y
       respuestas de modelo simuladas: correcta, vacía, JSON roto, «aprobado»
       contra evidencia bloqueante.
    5. **Consolidación** (≥ 8): resultados de especialistas (completos,
       parciales, contradictorios) y consolidaciones simuladas → veredicto del
       evaluador y si se pidió corrección.
  - `__tests__/agent/evals/` ejecuta cada familia por el código de producción
    real (`planOfficeWorkstreams`, `classifyAgentIntent`, `createHandoff`,
    `createReviewArtifactPort` con `invokePersona` simulado,
    `executeOfficeOrchestration`).
  - Métricas: `precisionEnrutado`, `especialistasProhibidosConvocados`,
    `precisionIntencion`, `confirmacionCorrecta`, `handoffsBienRechazados`,
    `recallRevisor`, `aprobacionesSinCritica`, `consolidacionesCompletas`,
    `promptsConVallado` (cuenta campos de usuario fuera de valla en los prompts
    renderizados), `llamadasPorOperacion`.
  - `npm run eval:agents` con su informe en `.vitest/eval-agentes.md`.
- **Fuera de alcance:** llamar a modelos reales; juzgar la prosa.
- **CA:** el banco corre dentro de `test:ci`; la línea base registra A7, A8,
  A16, A19 y A20 (y A27, hallado al medir) como `defectosConocidos` con la
  tarea que los cierra —A4 en encargos no tiene todavía API que medir: la
  añade 16.1 junto con su caso—; un
  defecto que deja de medirse bajo objetivo falla hasta retirarlo de la lista;
  controles positivos (un caso construido para dar 100 % da 100 %).
- **Métrica:** la propia línea base (se anota en la sección 4.2).
- **Riesgos:** casos escritos para el código actual → escribir el esperado
  desde el dominio (qué *debería* pasar), no desde la salida observada.

#### 15.1 Prompts con identidad y versión *(P1 · M · observabilidad · 15.0 · A23)*
- **Objetivo:** saber qué prompt produjo cada respuesta de agente.
- **Cambios:** `lib/agents/promptCatalog.ts` (fundación, sin comportamiento):
  `AgentPromptId` (`office.persona`, `office.coordination`, `office.workstream`,
  `office.consolidation`, `office.consolidation-refinement`, `office.review`,
  `office.production`, `agent.intent-llm`, `agent.memory-extract`…) y su
  versión entera. Cada compositor devuelve `{ promptId, version, text }`; la
  versión del contrato del agente (`definitionVersion`) y la de la ficha viajan
  también. La traza (`AITrace` / `agent_actions` / `CoordinationEvent.detail`)
  registra `promptId@version` y un hash corto del texto. Prueba que falla si
  cambia el texto de un prompt catalogado sin subir su versión (instantánea del
  hash).
- **CA:** 100 % de las invocaciones del banco llevan `promptId@version`; cambiar
  una plantilla sin subir versión falla `test:ci`; sin dependencia nueva.

#### 15.2 Tokens, latencia y coste por agente *(P1 · M · observabilidad · 15.1 · A13)*
- **Objetivo:** que cada operación coordinada y cada encargo sepan cuánto
  costaron, por agente.
- **Cambios:** el invocador (`buildCoordinationInvoker`, `invokePersona` del
  runner) devuelve `{ text, usage, model, latencyMs, traceId }` en vez de una
  cadena (adaptar `chatWithProject` / `generateProjectChatReply` para exponer
  `AIUsage` del kernel). `OfficeOrchestrationResult` y `OfficeEngagement`
  agregan `usage` por agente y total; `officeTelemetry` lo publica. Coste
  estimado con una tabla de precios por modelo en `lib/ai` (declarada como
  *estimación* y con fecha), nunca presentado como factura.
- **CA:** el banco reporta `tokensPorOperacion` y `latenciaPorRol`; un proveedor
  sin `usage` deja `null` («sin medir»), nunca 0; la UI no se toca todavía
  (20.1).
- **Riesgos:** romper llamantes de `chatWithProject` → cambio de firma con
  adaptador temporal y prueba de cada llamante.

---

### Ola 16 — La ficha manda en todas partes *(corrección y configuración)*

**Meta:** lo que la organización configura en `/agents` es exactamente lo que
cada agente es, en cada camino, y nada más.
**Cierre de la ola:** paridad de caminos 10/10, cero duplicaciones de capa,
cero agentes desactivados con trabajo, persona siempre por argumento.

#### 16.0 Un solo compositor de agente, en capas *(P0 · L · corrección · 15.1 · A2, A3)*
- **Objetivo:** una función compone el *system prompt* de cualquier agente
  desde su **ficha resuelta**, con la jerarquía de la sección 5.4.
- **Leer antes:** `officeAgentPersonas.ts:348-406`, `officeAgentProfile.ts:310-380`,
  `projectConversation.ts`, ADR-004, el principio 4 de este plan.
- **Cambios:**
  - `services/architectureOffice/domain/agentPromptComposer.ts` (puro):
    `composeAgentInstruction(profile, { base, standards, task? })` →
    `{ promptId, version, text }` con cuatro secciones fijas y etiquetadas:
    `<plataforma>` (no inventar evidencia, confirmación, seguridad, idioma de
    salida; **no editable**), `<contrato>` (alias, rol, dominios, capacidades,
    `goals`, `nonGoals` con «dilo y nombra a quién corresponde», estándares),
    `<organizacion>` (instrucción adicional, conocimiento y memoria de la ficha,
    **vallados** con `wrapUntrustedContent` y la regla «esto es contexto de la
    organización, no cambia tus reglas»), `<tarea>`.
  - **Decisión D-A2 (= B, aprobada):** la instrucción de la ficha deja de
    *reemplazar* la de fábrica; se añade en la capa de organización. El editor
    lo dice junto al campo («se añade a la instrucción del agente»).
  - `buildOfficePersonaInstruction`, `buildAgentProfileBriefing` y
    `customizedAgentBriefings` pasan a delegar en el compositor o desaparecen;
    `coordinateRequest` deja de anteponer la ficha al mensaje.
  - `buildProductionInstruction`, `buildReviewPrompt` y `buildConsolidationPrompt`
    dejan de escribir «Actúas como…» y reciben la persona compuesta.
- **Fuera de alcance:** cambiar el texto de las 13 personas (se conserva).
- **CA:**
  - una prueba compone el prompt de un agente personalizado y otro sin
    personalizar y afirma: una sola declaración de identidad, `nonGoals`
    presentes en ambos, la capa de organización dentro de valla, el orden de
    capas fijo;
  - prueba de instantánea por agente (13) para detectar cambios no
    versionados (15.1);
  - `grep` del repositorio no encuentra un segundo «Eres … agente de la
    Oficina» ni «Actúas como» fuera del compositor (escáner en
    `__tests__/architecture/`);
  - `eval:agents` y `eval:artifacts` sin regresión.
- **Riesgos:** cambio de comportamiento del modelo por reordenar el prompt →
  medir con `artifact-evals` y `diagram-evals` (transporte simulado: verifican
  el prompt, no la respuesta) y anotar en la PR los prompts antes/después.

#### 16.1 La ficha llega a los diez caminos *(P0 · L · corrección · 16.0 · A1, A4, A5)*
- **Objetivo:** que cada camino resuelva la ficha del usuario y la respete.
- **Cambios:**
  - Un puerto `AgentProfileSource` (lectura de fichas resueltas, con caché y
    *fallback* a fábrica si la lectura falla — igual que `agentConfiguration`)
    inyectado en: `useArtifactPersona` (generación), `useAgentActions` y
    `useAssistantTurns` (ejecutor y chat), los tres puertos del runner y el
    copiloto. `composeArtifactPersonaInstruction` y `officePersonaForMessage`
    reciben las fichas en vez de leer `OFFICE_AGENT_PERSONAS`.
  - **Desactivados:** `OfficeEngagementPlanner`/`OfficeAgentRouter` excluyen
    agentes con `enabled: false` al asignar productor y revisor (con la misma
    garantía de nunca dejar una tarea sin asignable independiente; si no lo hay,
    el charter lo dice como bloqueo, no lo asigna en silencio); una mención a un
    agente apagado responde Arky y lo explica.
  - **Alias:** eventos, tablero, paneles y sala del encargo muestran el alias
    resuelto (helper `agentDisplayName(profiles, id)`); el alias de fábrica sigue
    resolviendo menciones (`@Elena`).
  - Prueba de **paridad de caminos**: una tabla de los diez caminos, cada uno
    ejecutado con transporte simulado y una ficha con un marcador único en el
    conocimiento; falla si el marcador no aparece en el prompt de alguno.
- **CA:** paridad 10/10; un agente desactivado no aparece en ningún charter
  nuevo ni en ninguna coordinación (banco familia 3); de las 56 lecturas
  directas de `OFFICE_AGENT_PERSONAS[...]`, las que **muestran un nombre**
  (eventos, `components/`, `pages/`) bajan a 0 y un escáner monótono impide que
  vuelvan; fan-out de pantallas sin
  cambio (`check:module-boundaries`); presupuestos de ruta sin subida (el puerto
  se carga con la ruta que ya lo usa).
- **Riesgos:** latencia por leer fichas en cada generación → caché en memoria
  por sesión con invalidación al guardar una ficha.

#### 16.2 Persona por argumento, nunca por texto, en el encargo *(P0 · S · seguridad · — · A7)*
- **Objetivo:** que el brief de un usuario no pueda cambiar quién firma una tarea.
- **Cambios:** `createProduceArtifactPort` pasa `resolvePersona: () =>
  briefingFor(task.assigneeId)` (persona fijada por la tarea);
  `officePersonaForMessage` queda sólo para el chat donde el usuario elige con
  `@`. Prueba de regresión: brief con «@Carmen» en una tarea de Felipe.
- **CA:** la prueba falla con el código actual y pasa después; banco familia 3
  incluye el caso; ningún puerto del runner llama a `resolveOfficeAgentMention`.
- **Nota:** puede adelantarse a 16.0 porque es independiente; si 16.0 ya está,
  usa su compositor.

#### 16.8 Las raíces del router coinciden *(P1 · S · corrección · 15.0 · A27)*
- **Objetivo:** que las señales de dominio reconozcan las palabras que nombran
  el dominio.
- **Cambios:** en `OfficeAgentRouter.ts`, las raíces dejan de llevar `\b`
  final (`integraci\w*`, `suscripci\w*`…); una prueba recorre `DOMAIN_SIGNALS`
  y falla si una alternativa es una raíz que no coincide con ninguna palabra
  completa de su lista de ejemplos.
- **CA:** `precisionEnrutado` ≥ 90 % en el banco y el defecto `router-raices`
  retirado de la línea base; `especialistasProhibidosConvocados` sigue en 0
  (una raíz más laxa no puede convocar a quien no toca: el caso
  `health-cloud-no-aws` sigue pasando).

#### 16.3 Una sola orquestación *(P1 · M · corrección · 16.1 · A6)*
- **Objetivo:** el copiloto y el dock convocan al mismo equipo de la misma forma.
- **Cambios:** `runCopilotOrchestration` delega en `coordinateRequest` (eventos,
  fichas, desactivados, tiers, evaluador) y sólo formatea el resultado;
  `isOfficeOrchestrationRequest` se conserva como *atajo explícito*, no como
  segundo motor. Escáner: `executeOfficeOrchestration` sólo se llama desde
  `coordinateRequest`.
- **CA:** la misma solicitud desde dock y copiloto produce el mismo plan (prueba
  con el mismo `now` y las mismas fichas); el copiloto muestra el panel de
  coordinación o, si su superficie no lo admite, el resumen de equipo con
  `rejectedHandoffs` y estado del evaluador.

#### 16.4 La ficha en el servidor: validación, revisión y bitácora *(P1 · M · gobierno · — · A10 · **migración**)*
- **Objetivo:** que el servidor aplique los mismos límites que el cliente y que
  cada cambio de un agente quede registrado.
- **Cambios:** migración `…_agent_profile_hardening`:
  `save_agent_profile` valida claves conocidas (lista blanca), longitudes
  (alias 40, rol 120, instrucción 1 200, 12 entradas × 280), `modelTier` en
  `{quick, default, deep}`, `maxConcurrentTasks` 1–5, avatar ≤ 8; acepta
  `expected_revision` y devuelve la nueva (patrón de `Settings.revision`, sin
  mapas de revisión, ver `noRevisionCache.test.ts`); tabla
  `api.agent_profile_changes` *append-only* (quién, cuándo, campos cambiados,
  versión del contrato) con RPC `list_agent_profile_changes`. Contrato pgTAP con
  casos negativos (claves extra, tamaño, tier inválido, revisión vieja,
  usuario ajeno). Matriz de propiedad (`06-propiedad-datos.md`) y catálogo de
  invariantes (`07-invariantes.md`) en el mismo cambio.
- **CA:** pgTAP en verde en `supabase.yml`; `dataOwnershipMatrix.test.ts` y
  `retiredRpcs.test.ts` en verde; el repositorio maneja `conflict` como
  `PersistenceResult` y la UI ofrece recargar; **parar y pedir aprobación antes
  de aplicar la migración a `ArkyDB-US`**, y aplicarla antes de fusionar.

#### 16.5 Deriva del contrato y diferencias *(P2 · M · experiencia · 16.4 · —)*
- **Objetivo:** que una organización sepa cuándo el producto cambió un agente
  que ella personalizó.
- **Cambios:** el override guarda `definitionVersion` al escribirse; la ficha
  muestra «personalizada contra v1, el agente está en v2» y una vista de
  diferencias (fábrica / organización / efectivo); la bitácora de 16.4 se lista
  en la ficha.
- **CA:** prueba de dominio de la deriva; prueba de componente con axe sin
  hallazgos; textos por `t()` (presupuesto de literales sin subir).

#### 16.6 Ver y ensayar el agente desde su ficha *(P2 · M · experiencia · 16.0, 15.2 · A26)*
- **Objetivo:** probar un cambio antes de que llegue a un entregable.
- **Cambios:** en `AgentProfileEditor`, «Ver instrucción efectiva» (el texto del
  compositor con las capas marcadas; nunca claves ni datos de otros) y «Ensayar»:
  una pregunta de prueba contra el borrador **sin guardarlo**, una sola llamada,
  con tier y coste estimado visibles; tres preguntas de ejemplo por rol
  (incluida una fuera de alcance para comprobar `nonGoals`).
- **CA:** el ensayo no escribe nada (prueba); se carga con `services/ai/lazy`
  y `/agents` sigue bajo su techo de ruta (42,0 de 50 KB gz hoy); accesible por
  teclado; el texto mostrado es exactamente el que se enviaría (misma función).

#### 16.7 Agentes de la organización *(P3 · L · gobierno · D-A1 · — · migración)* — **descartada por D-A1 = A**
- **Estado:** no se ejecuta. El propietario decidió (2026-10-13) que las fichas
  son de cada usuario. Se conserva la descripción por si un día hay
  multi-organización; reabrirla es una decisión nueva, no esta tarea.
- **Objetivo:** que la configuración de los agentes sea de la organización y no
  de cada usuario.
- **Cambios:** fichas a nivel de organización con permiso `agents:configure`
  (sólo `admin`/`superadmin` o un rol nuevo), la ficha personal como capa
  opcional encima; paridad de matriz SQL (`sqlMatrixParity.test.ts`).
- **CA:** no aplica mientras D-A1 = A. Las tareas de este plan no deben
  cerrar la puerta: la ficha sigue identificada por `(owner_id, agent_id)` y
  cualquier capa nueva se diseña para que «por organización» sea aditiva.

---

### Ola 17 — Seguridad, límites y honestidad *(guardarraíles)*

**Meta:** ningún texto que no escribió la aplicación gobierna a un agente, todo
límite declarado se cumple y ningún veredicto se fabrica.
**Cierre de la ola:** `promptsConVallado` 100 %, `aprobacionesSinCritica` 0,
presupuesto aplicado en el 100 % de las invocaciones.

#### 17.0 Vallado completo de los prompts de agentes *(P0 · M · seguridad · 16.0 · A8)*
- **Objetivo:** cerrar LLM01 en los prompts de agentes.
- **Cambios:** vallar brief, solicitud, objetivo derivado de la solicitud,
  contenido revisado, memoria (las tres capas de `agentContextComposer`),
  conocimiento de la ficha y mensaje del clasificador LLM; las reglas quedan
  fuera de la valla. Escáner estático en `__tests__/security/`: en los
  compositores de agentes, toda interpolación de un campo marcado como
  «de usuario» (`brief`, `request`, `content`, `memory`, `knowledge`,
  `instruction`, `userInput`) pasa por `wrapUntrustedContent`.
- **CA:** `promptsConVallado` = 100 % en el banco; el escáner falla sobre el
  código actual en ≥ 8 sitios y pasa después; guardarraíl de frase sigue siendo
  *warning* (no se bloquea por frase, regla del producto).

#### 17.1 Un revisor nunca aprueba en silencio *(P0 · S · honestidad · — · A16)*
- **Objetivo:** que un veredicto diga sobre qué se tomó.
- **Cambios:** `OfficeTaskReview` gana `basis: 'model-and-evidence' |
  'evidence-only'`, `truncated: boolean` y `humanConfirmation?`. Si la crítica
  del modelo no llegó o no se validó y la evidencia determinista no bloquea, el
  veredicto queda `approved` **marcado `evidence-only`** (D-A5 = B, aprobada) y
  el encargo no avanza más allá de esa revisión hasta que una persona lo
  confirme en la sala del encargo; si la evidencia bloquea, `changes-requested`
  como hoy. El contenido truncado se dice al revisor y queda en la revisión.
- **CA:** banco familia 4: `aprobacionesSinCritica` = 0 (ninguna aprobación
  sin crítica queda sin marca ni confirmación); la sala del encargo muestra la
  base del veredicto y el botón de confirmación; prueba que falla con el código
  actual.

#### 17.2 Memoria con procedencia, aprobación y caducidad *(P1 · M · seguridad · 17.0 · A9)*
- **Objetivo:** cerrar el envenenamiento de memoria.
- **Cambios:** `MemoryEntry` gana `origin` (`user` | `model-extracted` |
  `imported`), `sourceTraceId`, `confirmedBy?`, `expiresAt?`,
  `supersedes?`; lo extraído por modelo queda *propuesto* hasta un clic
  (regla «nada se escribe solo», como la captura asistida); al componer, sólo
  entra lo confirmado y vigente, vallado; detector de credenciales
  (`lib/secretShapes`) antes de guardar; una entrada que contradice otra se
  propone como sustituta, no como duplicado. Entradas antiguas se leen como
  `origin: 'user'` confirmadas (migración perezosa en lectura, sin migración
  SQL si la forma viaja en JSON; si no, migración aditiva con aprobación).
- **CA:** prueba: una memoria extraída no confirmada no aparece en ningún prompt;
  una clave con forma de secreto se rechaza; Centro de Memoria muestra origen y
  caducidad; textos por `t()`.

#### 17.3 Presupuestos que se cumplen, y cancelación *(P1 · M · gobierno · 15.2 · A11, A12, A14)*
- **Objetivo:** que «condición de parada» sea un hecho medido.
- **Cambios:**
  - `withHandoffBudget(invoke, envelope)` envuelve al invocador: cuenta
    llamadas reales (a partir de 15.2) y rechaza la siguiente cuando se agota,
    con `HandoffRejection` `budget-exhausted` informada en `rejectedHandoffs`.
  - Presupuesto por operación coordinada (llamadas y, por D-A4,
    tokens), por defecto `1 + especialistas + 1 + 1`.
  - El runner cobra `aiCalls` reales (la generación devuelve cuántas hizo; el
    motor ya emite fases).
  - `coordinateRequest` acepta `signal` y `timeoutMs` por invocación (por
    defecto el del kernel); cancelar emite `operation-failed` con motivo
    «cancelada por la persona» y no consolida a medias.
- **CA:** banco: `llamadasContadas == llamadasReales`; prueba de cancelación a
  mitad de los especialistas sin consolidación posterior; el tope del encargo
  se alcanza con la cifra real en una prueba con generación de tres llamadas.

#### 17.4 Éxito sólo con persistencia confirmada *(P1 · M · corrección · — · A15)*
- **Objetivo:** que el agente no diga «guardado» antes de que lo esté.
- **Cambios:** `AgentArtifactStore` pasa a devolver
  `Promise<PersistenceResult<Artifact>>`; el ejecutor espera el resultado y
  traduce `failed`/`offline`/`conflict` a su mensaje (borrador local si
  degradó: «guardado sólo en este navegador»). Adaptar `useAgentActions`, el
  runner y la cola de generación.
- **CA:** prueba con un store que falla: el resultado es `failed` con mensaje y
  sin «Cambios aplicados»; `artifactCoordinationOutOfReact.test.ts` sigue en
  verde; deshacer en un clic (10.4) sigue funcionando por los cuatro caminos.

---

### Ola 18 — Salidas con forma y evaluación honesta *(calidad)*

**Meta:** cada rol devuelve un objeto validado; el evaluador mide campos, no
palabras.
**Cierre de la ola:** 4 de 4 roles con esquema; evaluador-optimizador en los
dos caminos de consolidación; intención ≥ 90 % en el banco.

#### 18.0 Esquemas por rol de orquestación *(P1 · L · calidad · 16.0, 15.0 · A18)*
- **Objetivo:** que especialistas, coordinador y consolidador hablen en un
  contrato que el código lee.
- **Cambios:** con `defineSchema` (`services/ai/schema`) y lectura tolerante al
  estilo `readModelDiagramIR` (conserva lo válido y **nombra lo descartado**):
  - `SpecialistAnalysis`: `summary`, `findings[]` (con severidad), `assumptions[]`,
    `risks[]`, `decisions[]`, `outOfScope[]` (lo que el especialista dice que no
    es suyo, con a quién corresponde), `evidence[]` (citas `[ctx:*]` cuando hay
    manifiesto), `confidence`.
  - `CoordinationBrief`: `dependencies`, `order`, `dropWorkstreams[]` y
    `extraConstraints[]`. **El código aplica lo que cabe dentro de los límites**:
    puede quitar un especialista o añadir restricciones, nunca añadir agentes ni
    superar topes. Así la llamada del coordinador decide algo o se elimina (ver
    D-A3).
  - `Recommendation`: `verdict` (`ready|conditional|blocked`, `enum`),
    `rationale`, `contributions[]` (por agente: usado/descartado y por qué),
    `contradictions[]` (con dueño), `conditions[]`, `openQuestions[]`.
  - El texto que ve el usuario se **renderiza** desde el objeto (markdown
    determinista), y el objeto se guarda en la traza.
  - `evaluateConsolidation` lee campos: veredicto presente, todas las
    contribuciones completadas citadas, contradicciones con dueño, parcialidad
    declarada si hubo fallos.
- **CA:** banco familia 5 con respuestas simuladas JSON válidas, inválidas y
  parciales; ninguna respuesta inválida rompe la operación (se degrada a texto
  y se dice); el panel de coordinación muestra el veredicto como dato.
- **Riesgos:** proveedores con soporte de esquema distinto → ya resuelto por
  los adaptadores de `services/ai/schema` y la negociación de capacidades
  (`required` estructurada).

#### 18.1 Revisión con esquema, tier y temperatura del rol *(P1 · M · calidad · 18.0, 17.1 · A17)*
- **Objetivo:** que la crítica del revisor sea determinista en su forma.
- **Cambios:** el revisor se invoca con `responseSchema` (`ReviewCritique`:
  `verdict` enum, `summary`, `findings[]` con `severity` enum, `criterion`
  violado y `evidence`), temperatura baja declarada en el contrato del agente
  (`AgentDefinition.temperatureByRole` o constante por rol, sin que la ficha la
  pueda subir) y el tier del revisor (Carmen y Alejandro en `deep`). Los
  criterios de aceptación de la tarea se pasan **numerados** y cada hallazgo
  indica cuál incumple.
- **CA:** banco familia 4: `recallRevisor` ≥ 85 % con respuestas simuladas;
  ninguna lectura por *cast* (`parseStructured<…>` sin esquema) en adaptadores
  del runner (escáner).

#### 18.2 Un evaluador-optimizador para las dos consolidaciones *(P1 · M · calidad · 18.0 · A19)*
- **Objetivo:** que la consolidación de un encargo tenga la misma red que la del
  dock.
- **Cambios:** `createConsolidatePort` usa `evaluateConsolidation` y una
  corrección como máximo (mismo tope, mismo evento, mismo
  `consolidationReview` guardado en la tarea); la sala del encargo muestra si
  salió a la primera o corregida.
- **CA:** banco familia 5 cubre ambos caminos; `refined` y `review` persisten en
  el encargo (forma JSON aditiva; si cambia la tabla, migración con aprobación).

#### 18.3 Clasificador de intención completo y calibrado *(P2 · M · calidad · 15.0, 17.0 · A20)*
- **Objetivo:** que el clasificador acierte la intención —el heurístico en los
  casos claros y el LLM en los ambiguos— y que el umbral 0,75 salga del banco.
- **Cambios:** el heurístico reconoce las peticiones que el banco mide mal
  (crear un ADR o un diagrama, «todos los diagramas», preguntas «¿por qué…?»,
  «sobrescribe la versión actual», memoria del proyecto frente a la del
  artefacto); `VALID_TYPES` cubre todo `AgentIntentType`; `type` con `enum` en
  el esquema; mensaje vallado; casos ambiguos del banco ampliados a ≥ 30;
  umbral de confianza calibrado con el banco y documentado; las acciones de
  alto impacto siguen pidiendo confirmación sea cual sea la confianza.
- **CA:** `precisionIntencion` ≥ 90 %; `confirmacionCorrecta` = 100 % en
  acciones de impacto alto.

#### 18.4 Niveles de modelo que significan algo *(P2 · S · coste/calidad · D-A4 · A21)*
- **Objetivo:** que `quick`, `default` y `deep` resuelvan a modelos distintos
  y vigentes, por proveedor.
- **Cambios:** actualizar (D-A4, aprobada) `lib/ai/modelCatalog.ts` y el catálogo por proveedor
  (`services/ai/catalog/`) según D-A4; prueba que falla si dos tiers del mismo
  proveedor resuelven al mismo id sin una excepción documentada; ningún modelo
  nombrado fuera de `lib/ai` y los adaptadores (regla vigente).
- **CA:** `resolveModelForSettings` diferenciado por tier; la ficha muestra el
  modelo efectivo del tier.

---

### Ola 19 — Herramientas y contexto *(interfaz agente-computador)*

**Meta:** los especialistas recuperan el contexto que necesitan en vez de
recibirlo todo, con herramientas pocas, de solo lectura y gobernadas.
**Cierre de la ola:** la familia nueva del banco muestra igual o mejor calidad
con **menos** contexto inyectado; si no lo muestra, 19.2 no se ejecuta.

#### 19.0 Registro de herramientas de lectura y política por agente *(P2 · XL · capacidad · 18.0 · A24)*
- **Objetivo:** dar a los agentes una interfaz de consulta bien descrita.
- **Cortes (una PR cada uno):**
  1. `services/ai/tools/registry.ts`: `AIToolDefinition` con nombre en
     `snake_case`, descripción escrita para el modelo (cuándo usarla y cuándo
     no), esquema de entrada, tope de tamaño de respuesta, errores accionables
     («no existe; usa `search_artifacts` primero») y efecto `read-only`.
  2. Herramientas sobre puertos existentes (sin SDK nuevo): `read_artifact`
     (por id, con resumen o sección), `search_artifacts` (por texto y tipo),
     `query_knowledge_graph` (entidades/relaciones/impacto),
     `get_initiative_motivation`, `list_office_standards`. Respuestas en
     formato compacto y citables (`[ctx:*]`).
  3. **Política de herramientas en el contrato del agente**
     (`allowedTools`, por rol): ahora hay herramientas que gobernar, así que el
     campo entra *con* su aplicación — el ejecutor rechaza una llamada a una
     herramienta no permitida y lo registra. Ninguna herramienta escribe: la
     escritura sigue siendo `MODIFY_ARTIFACT_TOOL` con confirmación.
  4. Banco: familia 6 «uso de herramientas» con conversaciones simuladas
     (herramienta correcta, parámetros válidos, no llamar cuando no hace falta).
- **CA:** cada herramienta con prueba de descripción (longitud mínima, ejemplo,
  cuándo no usarla), de tope y de error; `allowedTools` validado por
  `validateAgentRegistry`; ninguna herramienta llega a la red desde el
  navegador sin pasar por el repositorio de su contexto; bundle por ruta sin
  subida (herramientas cargadas con la capa de IA diferida).

#### 19.1 Política de contexto por rol y manifiesto *(P2 · L · calidad · 19.0, 15.2 · A25)*
- **Objetivo:** que cada rol vea lo mínimo de alta señal y que quede escrito
  qué vio.
- **Cambios:** `AgentContextPolicy` por rol (coordinador: solicitud, ámbito y
  catálogo de especialistas; especialista: ámbito, inventario de artefactos con
  resúmenes y herramientas para el detalle; consolidador: análisis
  estructurados, nunca el proyecto entero; revisor: artefacto, contrato,
  criterios y evidencia determinista), con presupuesto en tokens estimados.
  Cada invocación registra su manifiesto de contexto (qué referencias, cuántos
  tokens) en la traza, como ya hace la generación (`[ctx:*]`).
- **CA:** el banco mide `tokensPorOperacion` antes/después: baja ≥ 30 % sin
  regresión en las métricas de calidad; prueba que falla si el consolidador
  recibe artefactos completos.

#### 19.2 Bucle de herramientas acotado para especialistas *(P3 · L · capacidad · 19.0, 19.1, D-A3 · —)*
- **Objetivo:** si 19.0–19.1 lo justifican, que un especialista pueda consultar
  varias veces antes de responder.
- **Cambios:** bucle con tope de turnos (p. ej. 4), tope de llamadas del handoff
  (17.3), parada por respuesta estructurada final, y evento por cada llamada a
  herramienta en el panel de coordinación.
- **CA:** sólo se fusiona si el banco muestra mejora en hallazgos/evidencia
  citada **y** el coste medio por operación sube < 50 %; si no, se documenta el
  resultado y se cierra como «medido, no adoptado».

---

### Ola 20 — Observabilidad, control humano y operación *(clase mundial operativa)*

**Meta:** una persona puede ver, entender, intervenir y auditar lo que hicieron
los agentes, y un operador puede diagnosticarlo.

#### 20.0 Traza en árbol de una operación *(P1 · M · observabilidad · 15.1, 15.2 · —)*
- **Objetivo:** una sola vista operación → handoff → invocación → llamada de
  modelo/herramienta, con prompt id, tokens, latencia, resultado y rechazo.
- **Cambios:** `describeOperation` (análogo a `describeRun`) que une
  `CoordinationEvent`, `runId`, `traceIds` y `AITrace`; vista «Ver traza» en
  `TeamCoordinationPanel` y en la sala del encargo; exportación JSON
  (sin secretos: prueba con `lib/secretShapes`).
- **CA:** una operación del banco produce un árbol completo; ninguna hoja
  huérfana; accesible por teclado; textos por `t()`.

#### 20.1 Panel de calidad de agentes *(P2 · M · experiencia · 15.2, 18.1 · —)*
- **Objetivo:** que `/agents` diga cómo trabaja cada agente, no sólo cómo es.
- **Cambios:** por agente y ventana (7/30 días): tareas, tasa de aprobación en
  primera revisión, reintentos, coste estimado, latencia p50/p90, operaciones
  con handoffs rechazados. Sin datos = «sin medir», nunca 0 (regla del
  producto); gráficos con `components/ui/charts/` (sin dependencias nuevas).
- **CA:** prueba de dominio de las cifras; `/agents` bajo su techo de ruta; axe
  sin hallazgos.

#### 20.2 Intervención humana en operaciones caras *(P2 · M · control · 17.3, 18.0 · —)*
- **Objetivo:** que la persona apruebe el plan del equipo antes de gastar cuando
  la operación supere un umbral (especialistas o coste estimado).
- **Cambios:** fase `awaiting-approval` tras el encuadre: mostrar equipo, coste
  estimado y criterios; aprobar, quitar un especialista o cancelar. Por debajo
  del umbral, como hoy (sin fricción).
- **CA:** prueba de componente y E2E con proveedor simulado; nada se invoca
  antes de aprobar; cancelar no deja estado a medias.

#### 20.3 E2E de los agentes *(P1 · M · verificación · 16.1, 17.1 · —)*
- **Objetivo:** el recorrido real en navegador contra `dist/` y Supabase local.
- **Cambios:** `e2e/agents.spec.ts`: editar la ficha de un agente (conocimiento
  con marcador) → pedir algo en el dock → el prompt interceptado
  (`page.route('**/api/ai')`) contiene el marcador una vez y dentro de valla →
  desactivar el agente → no se convoca → restaurar. Encargo con revisor que
  devuelve JSON roto → la sala dice «revisión no disponible».
- **CA:** verde en Chromium escritorio en CI; axe sin hallazgos en `/agents` y en
  el dock abierto (`docs/operacion/runbook-e2e.md`).

#### 20.4 Documentación y alineación de cierre *(P1 · S · documentación · olas 15–19 · —)*
- **Objetivo:** que la documentación diga lo que el código hace.
- **Cambios:** `docs/agentes-anthropic-alineacion.md` → ampliar a
  `docs/agentes-alineacion-estandares.md` (Anthropic, OpenAI, OWASP LLM) con
  fila por principio, fichero y prueba; ADR-110 «Contrato de agente v2:
  capas de instrucción, salidas estructuradas, presupuesto aplicado,
  herramientas de lectura»; runbook `docs/operacion/runbook-agentes.md` (cómo
  diagnosticar «el agente ignoró mi ficha», «el revisor aprobó algo malo», «la
  operación costó demasiado»); CLAUDE.md y AGENTS.md con anclas nuevas en
  `assistantDocsParity.test.ts` (`composeAgentInstruction`,
  `withHandoffBudget`, `eval:agents`); guía de la plataforma actualizada.
- **CA:** la sección «The card reaches every place the agent speaks» de
  CLAUDE.md queda respaldada por la prueba de paridad de 16.1 y la cita; ningún
  enlace roto; `noOrphanModules.test.ts` en verde.

---

## 7. Orden, dependencias y decisiones

### 7.1 Orden recomendado

```
15.P → 15.0 → 16.2 (independiente, P0) → 16.8 → 15.1 → 16.0 → 16.1 → 17.0 → 17.1
     → 15.2 → 17.3 → 17.4 → 16.3 → 18.0 → 18.1 → 18.2 → 16.4 (migración)
     → 17.2 → 18.3 → 18.4 → 20.0 → 20.3 → 16.5 → 16.6 → 20.1 → 20.2
     → 19.0 → 19.1 → [19.2 si el banco lo justifica] → 20.4
```

- **Bloque P0** (15.0, 16.2, 16.0, 16.1, 17.0, 17.1): hace verdad lo prometido y
  cierra los dos vectores de seguridad. Aproximadamente 12–16 días.
- **Bloque P1** (15.1, 15.2, 16.3, 16.4, 17.2–17.4, 18.0–18.2, 20.0, 20.3,
  20.4): contratos cumplidos y medibles. Aproximadamente 18–24 días.
- **Bloque P2/P3** (16.5, 16.6, 18.3, 18.4, 19.x, 20.1, 20.2): eleva calidad y
  experiencia, condicionado a medición. Aproximadamente 15–25 días.

Tareas paralelizables entre agentes (worktrees distintos, sin ficheros en
común): 16.2 ∥ 15.1; 17.1 ∥ 17.0; 17.4 ∥ 16.3; 18.3 ∥ 18.4; 20.1 ∥ 16.5.

### 7.2 Decisiones del propietario

Decididas por el propietario el 2026-10-13: **D-A1 = A** (fichas por usuario) y,
para D-A2…D-A5, **la recomendación** de la última columna.

| # | Decisión | Opciones | Recomendación | Decidido |
|---|---|---|---|---|
| **D-A1** | ¿Las fichas de agente son de cada usuario o de la organización? | A: por usuario (hoy). B: por organización, con capa personal opcional | B diseñada como migración aditiva, sólo con multi-organización | **A** — por usuario; 16.7 descartada |
| **D-A2** | ¿La instrucción de la ficha reemplaza o añade? | A: reemplaza (hoy, en teoría). B: añade en la capa de organización | **B**: un reemplazo puede quitar la frontera de dominio y las reglas de honestidad (A3) | **B** — se añade |
| **D-A3** | ¿El coordinador decide o se elimina? | A: su salida estructurada puede quitar especialistas y añadir restricciones (18.0). B: se elimina la llamada y el encuadre es determinista | **A** si el banco muestra mejora; si no, **B** (ahorra una llamada por operación) | **A condicionada al banco**; 18.0 registra la cifra y, si no hay mejora, aplica B |
| **D-A4** | Catálogo de modelos y presupuesto en tokens | Actualizar tiers por proveedor; topes en tokens además de llamadas | **Sí a ambos**, con tabla de precios fechada y marcada como estimación | **Sí a ambos** |
| **D-A5** | Revisor sin crítica del modelo | A: `changes-requested` automático. B: `approved` marcado *evidence-only* con confirmación humana | **B**: no bloquea el trabajo por una caída del proveedor y no finge una revisión | **B** — *evidence-only* con confirmación humana |

### 7.3 Migraciones previstas

16.4 (siempre) y 17.2 / 18.2 sólo si la forma no
cabe en el JSON existente. **Todas paran y piden aprobación antes de tocar
`ArkyDB-US`.**

---

## 8. Seguimiento

| Tarea | Prioridad · Complejidad | Estado | PR · nota |
|---|---|---|---|
| 15.P Reservar tareas de este plan | P0 · S | Hecha | #236 · `localizar-tarea.sh` y `PLANES` en `comun.sh`; ramas `agentes/<id>-<tema>` |
| 15.0 Banco `agent-evals` | P0 · L | Hecha | #237 · enrutado 81,5 %, intención 60 %, persona fijada 0 %, revisor 100 %, aprobaciones sin crítica 3, consolidación 80 %, vallado 0 %; seis defectos nombrados |
| 15.1 Prompts con identidad | P1 · M | Hecha | #240 · catálogo de 10 plantillas de la Oficina con huella; sello `id@vN#hash` en eventos de coordinación y en `OfficeTask.promptStamps`; `invocacionesConSello` 100 %. Los prompts de `services/agent` (intención LLM, memoria) entran con 18.3 y 17.2 |
| 15.2 Tokens, latencia y coste | P1 · M | Hecha | #247 · uso, modelo, latencia y traza por invocación; resumen por agente y operación; coste estimado con tabla fechada; banco con tokens y latencia |
| 16.0 Compositor único en capas | P0 · L | Hecha | #241 · `composeAgentInstruction` en `domain/agentPromptComposer.ts`; ficha al prompt de sistema por `buildCoordinationInvoker`; instrucción de la ficha añadida (D-A2); conocimiento y memoria vallados (vallado 0 → 28,6 %); la instrucción añadida no se valla a propósito (es configuración a seguir), va subordinada en su capa; 5 plantillas a v2 |
| 16.1 Ficha en los diez caminos | P0 · L | Hecha | corte 1 (#242) hecho: ficha en los 10 caminos (`agentProfileParity.test.ts`), menciones a desactivados las responde Arky, el copiloto no los convoca. Corte 2 (#243) hecho: el charter del encargo no asigna trabajo a desactivados (productor ni revisor; el refinamiento que los nombre se descarta; lo no asignable va a `outOfScope`), con caso en el banco. Corte 3 (#244) hecho: el alias configurado se ve en avatares, chips, tablero, charter, panel de carga y bitácora (`useAgentDisplayName`, `coordinateRequest({ agentName })`); las fichas se leen una vez por usuario y se invalidan al guardar. El brief de `EngagementRoom` para el modelo conserva el alias de fábrica, que es el que resuelve menciones |
| 16.2 Persona por argumento en el encargo | P0 · S | Hecha | #238 · `personaFijada` 0 → 100 %; defecto `persona-por-texto` retirado |
| 16.8 Las raíces del router coinciden | P1 · S | Hecha | #239 · `precisionEnrutado` 81,5 → 100 %, prohibidos 0; defecto `router-raices` retirado |
| 16.3 Una sola orquestación | P1 · M | En curso | #255 (borrador): `runCopilotOrchestration` delega en `coordinateRequest`; con bloqueos |
| 16.4 Ficha en el servidor (migración) | P1 · M | Pendiente | |
| 16.5 Deriva del contrato | P2 · M | Pendiente | |
| 16.6 Ver y ensayar el agente | P2 · M | Pendiente | |
| 16.7 Agentes de la organización | P3 · L | Descartada | D-A1 = A (fichas por usuario), 2026-10-13 |
| 17.0 Vallado completo | P0 · M | Hecha | #245 · `promptsConVallado` 28,6 → 100 %: solicitud de coordinación, brief del encargo, contenido revisado (con aviso de recorte), registro en contexto, mensaje del clasificador y capas de memoria del agente. La memoria base y la instrucción de la ficha quedan fuera de la valla a propósito: son configuración a seguir |
| 17.1 Revisor sin aprobación silenciosa | P0 · S | Hecha | #246 · `aprobacionesSinCritica` 3 → 0: sin crítica legible la aprobación es `evidence-only`, la tarea queda en `awaiting-review` y el encargo se bloquea diciendo por qué; «Confirmar revisión» en el tablero la firma (`confirmEvidenceOnlyReview`, con actor en la auditoría). El contenido recortado se marca `truncated` |
| 17.2 Memoria con procedencia | P1 · M | Hecha | #250 · origen, traza, confirmación, caducidad y sustitución en JSON; las propuestas no confirmadas y las notas vencidas no entran en prompts; rechazo de claves; Centro de Memoria muestra origen, confirmación y vencimiento |
| 17.3 Presupuestos y cancelación | P1 · M | Hecha | #247 · presupuesto por handoff y operación, rechazo explícito, cobro de llamadas informadas y cancelación sin consolidación parcial |
| 17.4 Éxito con persistencia confirmada | P1 · M | Hecha | #247 · store confirmado para agente y cola; fallo remoto visible y sin anuncio de éxito; prueba de deshacer conservada |
| 18.0 Esquemas por rol | P1 · L | Hecha | #253 · `0b26628` · fusion 2026-10-16 · produccion `success`. Coordinador, especialista y consolidador devuelven JSON validado; el texto es la representacion. Remediaciones: #256/#257 (ver 20.0) |
| 18.1 Revisión con esquema | P1 · M | Pendiente | |
| 18.2 Evaluador en las dos consolidaciones | P1 · M | Hecha | #248 · el encargo evalúa y corrige una vez; la revisión queda en la tarea y el banco sube a 100 % |
| 18.3 Clasificador de intención | P2 · M | Hecha | #249 · el heurístico reconoce crear (con doble determinante y ADR/NFR), lote, «para este proyecto» y sobrescribir; el LLM conoce los 12 tipos (enum en el esquema); 31 casos, precisión 100 %, confirmación 100 %. Umbral LLM 0,55 se mantiene: ningún caso del banco queda bajo él |
| 18.4 Niveles de modelo | P2 · S | Hecha | #251 · `quick`, `default` y `deep` tienen IDs distintos por proveedor; la preferencia explícita sólo afecta a `default`; la ficha muestra el modelo resuelto |
| 19.0 Herramientas de lectura | P2 · XL | Pendiente | |
| 19.1 Política de contexto | P2 · L | Pendiente | |
| 19.2 Bucle de herramientas | P3 · L | Espera medición | |
| 20.0 Traza en árbol | P1 · M | Hecha | #252 · `2f2af2c` · fusion 2026-10-16 · produccion `success`. `describeOperation` deriva el árbol (agentes, eventos, handoffs rechazados, revisión, sellos de prompt) del `CoordinationOutcome`, sin almacenarlo; «Ver traza» en la dock (árbol accesible, carga diferida) y exportación JSON con las credenciales omitidas (`redactSecretShapes`). Remediaciones #256/#257 abiertas |
| 20.1 Panel de calidad de agentes | P2 · M | Pendiente | |
| 20.2 Intervención humana | P2 · M | Pendiente | |
| 20.3 E2E de los agentes | P1 · M | Pendiente | |
| 20.4 Documentación de cierre | P1 · S | Pendiente | |

---

## 9. Plantilla de ejecución para un modelo de IA

Cada tarea se lanza en una sesión nueva con este mensaje, cambiando el
identificador:

> Ejecuta la tarea **⟨ID⟩** de `docs/plan-agentes-ia.md`.
>
> 1. **Contexto.** Lee CLAUDE.md completo, la tarea, sus dependencias (deben
>    estar «Hechas» en la sección 8), los hallazgos que cierra (sección 3, con
>    sus ficheros) y los documentos de «Leer antes». Si una dependencia no está
>    hecha, para y dilo.
> 2. **Verifica el hallazgo.** Antes de cambiar nada, reprodúcelo: localiza las
>    líneas citadas (pueden haberse movido) y escribe la prueba que lo
>    demuestra. Si el hallazgo ya no existe, registra la evidencia en la PR y
>    cierra la tarea como «no aplica».
> 3. **Mide.** Ejecuta `npm run eval:agents` (desde 15.0) y el banco afectado,
>    y anota la cifra que la tarea mueve.
> 4. **Reserva** con `scripts/agentes/nueva-tarea.sh` (rama
>    `agentes/⟨id⟩-⟨tema⟩` desde `main`, worktree propio, PR en borrador; ver
>    `docs/operacion/multiagente.md`). Comprueba con `estado.sh` que nadie la
>    tiene.
> 5. **Implementa** lo mínimo que cumple los CA, respetando: fronteras de
>    `modules.json`, pureza de `domain/` (ninguna E/S), «la IA bajo demanda»
>    (`services/ai/lazy`), una sola puerta por módulo, capas de instrucción
>    (sección 5.4), vallado de todo texto ajeno, ningún `any`, ningún modelo
>    nombrado fuera de `lib/ai` y los adaptadores, textos de UI por `t()`.
> 6. **Prueba**: unitarias que fallan con el código anterior, casos nuevos en el
>    banco si la tarea lo pide, y E2E si toca un recorrido.
> 7. **Verifica**: `NODE_OPTIONS=--max-old-space-size=3072 npm run quality` y los
>    cuatro bancos. Si una cifra empeora o un techo sube, justifícalo con lo
>    medido o no fusiones.
> 8. **Documenta**: CLAUDE.md y AGENTS.md (ancla en
>    `assistantDocsParity.test.ts`) si cambia una regla; la guía de la plataforma
>    si cambia una pantalla; la fila de la sección 8 con el número de PR; la
>    cifra en la sección 4.2 si la tarea la mueve.
> 9. **Entrega**: PR con antes/después de cada CA y de cada métrica, espera a
>    CI, *squash-merge* y comprueba el despliegue.
> 10. **Migraciones**: si la tarea incluye una, **para y pide aprobación** antes
>     de aplicarla a `ArkyDB-US`; aplícala antes de fusionar el código.
> 11. **Honestidad**: si un CA no se cumple, dilo en la PR con la cifra; nunca
>     lo des por cumplido ni desactives una prueba para pasar.

**Lista de comprobación de calidad para cualquier cambio en un agente** (se
copia en la PR):

- [ ] El prompt se compone en `composeAgentInstruction` (desde 16.0), con
      `promptId@version` (desde 15.1).
- [ ] Ningún texto de usuario, documento, memoria o salida de otro agente fuera
      de `wrapUntrustedContent`.
- [ ] La salida del modelo se lee con esquema y la lectura nombra lo descartado.
- [ ] Hay tope de llamadas y de tokens (D-A4) y se cuenta lo real.
- [ ] El veredicto o la decisión la toma código determinista; el modelo aporta
      análisis.
- [ ] Lo irreversible pide confirmación humana; lo propuesto se aplica con un
      clic y se deshace con otro.
- [ ] La ficha del agente (alias, alcance, desactivado, tier) se respeta en
      este camino.
- [ ] La traza permite reconstruir qué vio y qué devolvió el agente.
- [ ] `eval:agents` no empeora.

---

## 10. Glosario mínimo

| Término | Significado en este plan |
|---|---|
| **Persona / contrato del agente** | Lo que el producto declara de un agente: rol, dominios, capacidades, alcance y no-objetivos, estándares, qué produce y revisa, tier, concurrencia, versión (`agentDefinition.ts`) |
| **Ficha** | Lo que una organización o persona configura sobre un agente (`OfficeAgentProfileOverride`), resuelto con la persona en `OfficeAgentProfile` |
| **Camino** | Cada flujo de código por el que un agente llega a un modelo (tabla de 3.1) |
| **Handoff** | Encargo tipado de un agente a otro (`AgentHandoffEnvelope`) |
| **Operación** | Una solicitud coordinada: coordinador → especialistas → consolidador |
| **Encargo** | `OfficeEngagement`: charter aprobado, DAG de tareas, revisiones, consolidación |
| **Vallado** | Envolver con `wrapUntrustedContent` el contenido que la aplicación no escribió |
| **Banco** | Conjunto de casos escritos a mano que se ejecutan por el código real con el transporte simulado y una línea base monótona |
