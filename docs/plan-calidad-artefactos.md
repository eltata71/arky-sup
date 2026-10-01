# Plan de calidad de artefactos: el contexto completo en cada operación de IA

**Fecha:** 2026-09-29
**Estado:** propuesta, pendiente de aprobación del propietario
**Continúa:** `docs/plan-mejora-diagramas.md`. Su fase 6 se cerró con #112–#117 y
dejó al banco `diagram-evals` con una calidad media de 76,9.

---

## 1. Qué se revisó y qué se encontró

Se revisaron todos los caminos por los que la IA **genera, refina, revisa,
modifica, convierte o presenta** un artefacto, y en cada uno se comprobó qué
contexto recibe el modelo. El objetivo es que todos reciban lo mismo: contexto
global, memoria del agente, contexto del proyecto, memoria del artefacto,
conversaciones, iniciativa, entregable y artefactos hermanos.

**El hallazgo principal es de forma, no de un fichero concreto.** La fase 6 hizo
que *los diagramas* recibieran el contexto completo (`buildDiagramGenerationBrief`).
El resto de caminos sigue componiendo el contexto cada uno a su manera. Hay
**siete compositores distintos**, cada uno con su propia política:

| Compositor | Dónde | Qué incluye y qué deja fuera |
|---|---|---|
| `buildBasePrompt` / `buildArtifactsContext` | `services/ai/prompts/projectPrompts.ts` | Contexto global, del proyecto y motivación. **No incluye** `Settings.agentMemory` ni la memoria del artefacto. En modo diagrama **también deja fuera** la memoria del agente del proyecto y la captura inicial |
| Paquete del grafo de contexto | `services/contextGraph/contextGraphIntegration.ts` | Proyecto, memoria y artefactos. No incluye iniciativas, entregables ni conversación. Lee `globalContext` sin las prioridades de sus entradas |
| Bloque del grafo de conocimiento | `buildArtifactGenerationGraphContext` | Entidades y relaciones. En la presentación **sustituye** a los extractos de los hermanos en lugar de sumarse a ellos |
| Selección controlada | `services/artifacts/domain/artifactContextSelectionService.ts` | Fuentes requeridas y excluidas según el contrato |
| Brief de diagrama | `services/ai/prompts/diagramGenerationBrief.ts` | Todo lo anterior, cercado. Es la referencia |
| Compositor del agente | `services/agent/agentContextComposer.ts` | Memoria base, del proyecto y del artefacto, y una jerarquía de conflictos explícita. **No incluye** motivación ni grafo, y el contenido del artefacto va **recortado a 1 800 caracteres** |
| Composiciones en línea | refinamiento, crítica, revisión, sugerencias, conversión | Nombre y descripción del proyecto y, como mucho, `projectContext.slice(0, 8)` sin ordenar por prioridad |

La consecuencia es directa: **la calidad de un artefacto depende del botón que
se pulse.** Generar desde el Workspace usa mucho contexto. Luego «Mejorar» lo
refina con casi ninguno, «Revisar» lo evalúa sin la iniciativa y el copiloto lo
reescribe habiendo visto sólo el principio.

## 2. Top 10

Ordenado por impacto. Primero la corrección que pierde trabajo, luego los
cimientos y después lo que se construye sobre ellos.

### 1. El copiloto reescribe documentos que sólo ha visto en parte *(corrección)*

- `agentContextComposer` envía el artefacto activo recortado a
  `artifactContentCap: 1800` caracteres.
- A la vez, `MODIFY_ARTIFACT_TOOL` exige «the complete new content», y
  `requestArtifactPatch` (acción `artifact.patch`) también.
- Resultado: para cualquier documento de más de 1 800 caracteres, el modelo
  devuelve un documento completo que ha escrito sin ver el final.
- Las guardas no protegen bien:
  - El chat (`interpretArtifactModification`) sólo rechaza una respuesta vacía
    o idéntica.
  - El ejecutor (`validateArtifactContent`) acepta un documento que haya
    encogido hasta el 35 %.
  - El refinamiento usa otra política más estricta (55 %, secciones, tablas y
    filas).
- Hoy hay tres políticas de conservación y la más débil es la del camino más
  usado.

**Propuesta:**
- (a) **Parches semánticos de documento**: `replace-section`, `insert-section`,
  `remove-section`, `update-table-row` y `append-row`, sobre anclas de
  encabezado. Siguen el patrón de `semanticPatchEngine`: se validan antes de
  aplicarse, el resultado siempre es válido y un parche sin efecto lo dice.
- (b) Cuando haga falta el contenido completo, se envía completo o, en su
  lugar, el esquema del documento más la sección señalada entera.
- (c) Una sola `contentPreservationPolicy` en `services/artifacts/domain`, que
  apliquen el chat, el ejecutor y el refinamiento.

### 2. Un solo ensamblador de contexto de artefacto *(cimiento)*

Se trata de crear `ArtifactContextBundle`, compuesto una sola vez por
**ámbitos**:

| Ámbito | Contenido |
|---|---|
| Global | Estándares |
| Agente | Memoria base |
| Proyecto | Contexto, captura inicial, memoria y seguimiento |
| Artefacto | Memoria, versión anterior, IR y narrativa |
| Portafolio | Motivación de la iniciativa |
| Entregable | Ver #5 |
| Conversación | Ver #4 |
| Artefactos hermanos | Extractos |
| Grafo de conocimiento | Entidades y relaciones |

El ensamblador aplica la jerarquía que ya escribe `agentContextComposer`
(artefacto > proyecto > global > agente, y dentro de cada ámbito
prioridad > fecha) y cerca con `wrapUntrustedContent` todo lo que ha escrito
una persona.

Cada operación declara un **perfil**: `generate`, `refine`, `review`, `edit`,
`present`, `convert` o `consult`. El perfil fija qué ámbitos entran y con qué
presupuesto. `buildDiagramGenerationBrief` y `agentContextComposer` pasan a ser
dos lecturas del mismo bundle, no dos composiciones distintas.

Siguiendo la regla de ADR-108, el ensamblador vive en la capa de aplicación de
`services/artifacts` y llega a la IA **por un puerto**, de modo que la capa de
IA no importa iniciativas, Oficina ni chat.

### 3. Mismo contexto en los caminos secundarios *(corrección)*

Estos caminos consumen hoy menos contexto que la generación, y algunos no
cercan el contenido:

| Camino | Qué le falta hoy |
|---|---|
| Crítica y refinamiento (`artifactQualityRefinement.ts`) | Contexto global, memoria, motivación y hermanos. El idioma está fijado a español, sin mirar `settings.language`. El contenido va sin cercar y recortado a 18/24 KB |
| Revisión, mejoras y casos de prueba (`artifactReview.ts`) | La motivación. El contenido va sin cercar |
| Sugerencias (`artifactSuggestions.ts`) | El contexto del proyecto, y el contenido va sin cercar |
| Deck (`presentationDeck.ts`) | La motivación. El grafo de conocimiento o los extractos, pero no los dos a la vez |
| Diagrama → documento (`convertDiagramToDocument`) | El IR y la narrativa: se envía el Mermaid en bruto, sin el estándar documental |
| Edición de diagrama (`diagramEditService`) | Recibe el contexto como `context?: string` libre |

**Propuesta:** todos pasan a consumir el bundle de #2 con su perfil.

### 4. Las conversaciones llegan a los artefactos

- `includeChatHistoryByDefault` es `false` (`context/app/initialSettings.ts`).
- Una decisión tomada en el chat sólo llega a una generación si la persona dice
  «guarda esto» (`memoryExtractor`).
- `CompactionDigest` ya extrae `decisions` y `openQuestions`, pero sólo lo lee
  `ChatHistoryPanel`.

**Propuesta:**
- Un ámbito *conversación* en el bundle con las decisiones y preguntas abiertas
  del proyecto. Sale del digest, se calcula de forma determinista y no cuesta
  ninguna llamada.
- Propuestas de memoria después de una conversación con decisiones, que
  se guardan con **un clic explícito**. Es la misma regla que la captura
  asistida: nada se escribe en silencio.

### 5. El entregable y la contribución del proyecto llegan al artefacto

**Qué falta hoy:**
- Cuando se genera o modifica desde el Workspace, el motor no sabe nada del
  entregable: ni el brief, ni las restricciones del charter, ni los criterios
  de aceptación, ni las condiciones del ARB. Sólo el camino de la Oficina
  (`buildProductionInstruction`) los incluye.
- `ArtifactBusinessMotivation` lleva *todos* los objetivos, resultados y KPI de
  la iniciativa. En cambio, `AttentionContribution` ya dice cuáles sirve **este**
  proyecto, y eso no llega al modelo.
- Tampoco llegan los riesgos ni los hitos del seguimiento del proyecto.

**Propuesta:**
- Un puerto `ArtifactDeliverableContext` que suministra la Oficina.
- La motivación se restringe a los resultados y KPI a los que el proyecto
  contribuye. El resto queda como contexto secundario.
- El artefacto queda enlazado a la tarea que lo produjo, por id y no por texto.

### 6. El «Contexto usado» se registra al generar, no se reconstruye después

- `ContextGraphPanel` reconstruye el paquete **al abrir el panel**, con el
  estado actual del proyecto. Después de cualquier edición muestra lo que se
  usaría hoy, no lo que se usó. Es la misma clase de defecto que ya corrigió
  `TeamCoordinationPanel`: se debe mostrar lo emitido, no una reconstrucción.
- El prompt pide citar `[ctx:*]` y cerrar con una nota «Contexto utilizado»,
  pero nada verifica esas citas ni las resuelve. Según el código, las etiquetas
  opacas se quedan en el documento y en la exportación. Esto hay que
  confirmarlo sobre un artefacto real.

**Propuesta:**
- Un `ContextManifest` en `generationTrace`, que ya se persiste: fuentes,
  ámbitos, revisiones, recortes y exclusiones.
- Verificar las citas después de generar: una cita que no resuelve se informa,
  nunca se descarta.
- En el lienzo, las citas se muestran como chips con procedencia. En la
  exportación se convierten en notas al pie o se retiran.

### 7. Un contrato por plantilla de documento

- 18 plantillas `markdown` distintas —ADR, DRP, SRS, Runbook, Matriz de
  controles de seguridad, Fitness Functions, Modelo de costos, entre otras—
  se validan con **un único** contrato genérico, `contract.document.markdown`
  (objetivo, contexto, alcance, supuestos y riesgos).
- Por eso un ADR sin «Decisión» ni «Consecuencias» pasa el contrato, y un DRP
  sin RTO/RPO también.

**Propuesta:**
- Contratos por id de plantilla, con secciones obligatorias y reglas del
  dominio (RTO/RPO numéricos, estado del ADR, un control con dueño y
  evidencia). El contrato genérico queda como respaldo.
- **Una sola fuente** que lean el prompt y el validador, como ya hace
  `lib/domainPacks`.

### 8. Fidelidad a la solicitud y corrección acotada, también para documentos

- `checkRequestFidelity` y `correctDiagramOnce` existen sólo para diagramas.
- Para un documento, nada comprueba:
  - los criterios de aceptación;
  - los nombres que la solicitud y el contexto comprometen;
  - los KPI de #5;
  - la consistencia con los hermanos (el motor de consistencia y el grafo de
    conocimiento ya existen).

**Propuesta:**
- `checkDocumentFidelity` determinista, que devuelve cumplido, fallido o *sin
  evidencia*.
- **Un** parche de sección (de #1) cuando falte algo grave.
- `onDegraded` en español, igual que en los diagramas.

### 9. Banco de evaluación para documentos y presentaciones *(medición)*

- `diagram-evals` mide los diagramas. No existe un banco equivalente para
  documentos ni presentaciones, ni una métrica de «qué parte del contexto
  relevante llega al prompt» en esos caminos.

**Propuesta:** crear `tests/fixtures/artifact-evals/` con casos de salud y
vida. Cada caso trae proyecto, iniciativa con contribución, entregable, digest
de conversación y memorias. El banco mide:
- el contexto entregado por perfil;
- la ausencia de contradicciones en el prompt;
- el cumplimiento del contrato (#7) y la fidelidad (#8);
- la **conservación bajo edición** (#1).

Las respuestas del modelo son manuales y se declaran como tales, y la línea
base es monótona, igual que en el banco de diagramas.

### 10. Presupuesto y relevancia del contexto

- El prompt principal apila base, lista de artefactos, extractos, selección
  controlada, grafo de contexto, grafo de conocimiento y diagramas hermanos
  **sin un presupuesto global**. El único presupuesto que existe es el del
  historial de chat (`budgetChatHistory`).
- `projectContext` aparece dos veces: en la base y en el paquete.
- Los extractos de hermanos se eligen por recencia y dando prioridad a
  documentos, no por relevancia para la solicitud, aunque
  `contextRelevanceRanker` ya existe.

**Propuesta:**
- El ensamblador de #2 ordena cada ámbito por relevancia y quita duplicados
  entre ámbitos.
- Recorta según el presupuesto del perfil y anota cada recorte en el
  manifiesto de #6.

## 3. Principios de ejecución

Son los mismos que en el plan de diagramas:

- **Medir antes y después.** El banco de #9 entra en la primera ola. Cada ola
  sube la línea base en el mismo commit.
- **Nada se escribe sin un clic.** Esto vale para las sugerencias, las
  propuestas de memoria y los parches.
- **La capa de IA no importa contextos de dominio.** Todo lo que necesita del
  portafolio, la Oficina o el chat le llega por puertos.
- **Presupuesto de bundle.** La ruta Workspace está en 1 114 KB gz **sin
  margen**. El ensamblador va en código que ya es diferido. Si una ola sube el
  techo, lo sube con la razón escrita al lado.
- **Una PR por tarea**, con `npm run quality` en verde, E2E y *squash*. Si una
  tarea necesita migración (#5 y #6 podrían necesitarla para enlazar el
  artefacto con la tarea), se pide aprobación antes de aplicarla en `ArkyDB-US`.

## 4. Olas

Tamaño: **S** ≈ 1–2 días · **M** ≈ 3–5 días · **L** ≈ 1–2 semanas.

### Ola 7.1 — Proteger y medir

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| 7.1a | `contentPreservationPolicy` única (secciones, tablas, filas, umbral de encogimiento), aplicada al chat, al ejecutor y al refinamiento | S | Las tres rutas rechazan el mismo caso. Una prueba por ruta |
| 7.1b | El copiloto recibe el documento completo o el esquema más la sección entera. Sin volver a recortar a ciegas | S | Un documento de 10 KB editado desde el chat conserva su final (prueba) |
| 7.1c | Banco `artifact-evals`: 8 casos iniciales (ADR, DRP, SRS, BRD, deck ejecutivo, runbook, matriz de controles, conversión diagrama → documento) y línea base | M | `npm run eval:artifacts` imprime la tabla; la línea base queda versionada |

### Ola 7.2 — Un solo contexto

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| 7.2a | `ArtifactContextBundle`, sus ámbitos y la jerarquía de conflictos, en función pura con pruebas | M | Un solo compositor. `domainPurity` sigue en verde |
| 7.2b | Perfiles por operación con presupuesto, orden por relevancia y quitado de duplicados entre ámbitos (#10) | M | El banco mide que ningún prompt supera su presupuesto y que ningún ítem aparece dos veces |
| 7.2c | `buildDiagramGenerationBrief` y `agentContextComposer` pasan a leer el bundle | M | El banco de diagramas no baja de 76,9 |

### Ola 7.3 — Todo camino con todo el contexto

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| 7.3a | Refinamiento, crítica, revisión, sugerencias, deck, conversión y edición de diagrama leen el bundle; todo el contenido va cercado y el idioma sale de `settings` (#3) | M | El banco mide un 100 % de contexto entregado en los siete caminos. Una prueba de arquitectura prohíbe un prompt de artefacto que no venga del bundle |
| 7.3b | Ámbito de conversación: digest determinista y propuesta de memoria con clic (#4) | M | Una decisión tomada en el chat aparece en la siguiente generación sin «guarda esto» |
| 7.3c | Puerto del entregable, motivación restringida a la contribución y enlace del artefacto con la tarea (#5) | M | Un artefacto generado desde el Workspace cita los criterios de su entregable y sólo los KPI que el proyecto sirve |

### Ola 7.4 — Documentos con contrato y verificación

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| 7.4a | Contratos por plantilla para las 18 plantillas `markdown`, con una sola fuente para el prompt y el validador (#7) | L | Un ADR sin «Decisión» no pasa. Las suites actuales siguen en verde |
| 7.4b | Parches semánticos de documento (#1a), con vista previa escrita por el propio motor | M | «Añade un riesgo a la tabla» cambia sólo esa fila |
| 7.4c | `checkDocumentFidelity` más una sola corrección con parche, y `onDegraded` (#8) | M | El banco mide la fidelidad. Una corrección que empeora el documento se descarta |

### Ola 7.5 — Procedencia visible

| # | Tarea | Tamaño | Terminado cuando |
|---|---|---|---|
| 7.5a | `ContextManifest` en `generationTrace`, y `ContextGraphPanel` lee lo registrado (#6) | M | Editar el proyecto después de generar no cambia lo que muestra «Contexto usado» |
| 7.5b | Verificación de citas `[ctx:*]`, chips en el lienzo y notas al pie o retirada en la exportación | M | Ninguna exportación contiene una etiqueta opaca. Las citas que no resuelven se informan |

## 5. Orden y dependencias

```
7.1 (proteger + medir) ──► 7.2 (bundle) ──► 7.3 (paridad, conversación, entregable)
                                          └─► 7.4 (contratos, parches, fidelidad) ──► 7.5 (procedencia)
```

7.3 y 7.4 pueden avanzar en paralelo cuando exista el bundle. 7.4b reutiliza la
política de 7.1a, y 7.5 necesita el manifiesto que produce el bundle.

## 6. Seguimiento

| Tarea | PR | Estado |
|---|---|---|
| Plan | #119 | Fusionada |
| 7.1a — política única de conservación | #121 | Fusionada |
| 7.1b — el copiloto ve entero lo que puede reescribir | #122 | Fusionada |
| 7.1c — banco `artifact-evals` | #123 | Fusionada |
| 7.2a — ensamblador único (`ArtifactContextBundle`): ámbitos, jerarquía, perfiles con presupuesto, duplicados entre ámbitos, relevancia de hermanos; el chat lo lee | #125 | Fusionada |
| 7.2b — `buildBasePrompt` y el camino IR de diagramas leen el bundle (contexto entregado 32,1 → 39,4 %) | #126 | Fusionada |
| 7.3a — crítica, refinamiento, sugerencias y edición de diagrama leen el bundle; todo artefacto va cercado (contexto 39,4 → 72,3 %, cercado 21,9 → 100 %) | #127 | Fusionada |
| 7.3b — las decisiones del chat llegan a generar, refinar, criticar y al copiloto, y se ofrecen como memoria con un clic (contexto 72,3 → 78,9 %) | #128 | Fusionada |
| 7.3c — entregables en curso y contribución del proyecto a su iniciativa (contexto 78,9 → 83,6 %) | #129 | Fusionada |
| 7.4a — un contrato por plantilla para los 18 documentos del catálogo, una sola fuente para prompt y validador (el contrato detecta lo que falta: 0 → 100 %) | #130 | Fusionada |
| 7.4b — parches semánticos de documento: el cambio puntual del copiloto opera sobre secciones y tablas, sin reescribir ni límite de longitud | #131 | Fusionada |
| 7.4c — fidelidad de documentos contra la solicitud, una sola corrección con parche y aviso de lo que falta (banco: fidelidad 73,7 % medida antes de corregir) | #132 | Fusionada |
| 7.3d — iniciativa, entregables y conversación llegan también a revisar, sugerir, presentar, convertir y al copiloto (contexto entregado 83,6 → 100 %) | #133 | Fusionada |
| 7.5a — `ContextManifest` en `generationTrace`: cada compositor registra el contexto que envía (con la revisión de su fuente y lo que quedó fuera), el agente y la Oficina graban su propia traza, y «Contexto usado» lee lo registrado en vez de reconstruirlo | — | En revisión |

**«Contexto usado» ya no reconstruye nada (7.5a).** El panel construía el grafo
de contexto del proyecto *actual* al abrirse, así que editar el proyecto después
de generar cambiaba lo que decía haber usado una generación pasada. Ahora cada
compositor —prompt base, IR, C4, autocorrección, edición de diagrama, crítica,
refinamiento, presentación, fidelidad, modificación de documento y grafo de
contexto— entrega a `onContextCaptured` exactamente lo que envía, el grabador
lo copia en el momento (`createContextManifestRecorder`) y el manifiesto viaja
en `generationTrace`. Un artefacto anterior a la 7.5a lo dice («Sin registro
histórico») en vez de inventarse uno. Las mejoras, sugerencias y parches del
agente no son generaciones y conservan la traza de la que partieron; regenerar
y crear graban la suya. `buildContextUsageReport` y `buildContextReportText`,
que sólo servían al panel antiguo, se retiraron.

**El enlace artefacto → tarea no se duplicó.** Ya existe como arista canónica
(`OfficeTask.producedArtifactId`, resuelta por `services/portfolioGraph`); un
campo espejo en el artefacto sería una segunda fuente de verdad para la misma
relación, que es lo que la regla «las relaciones son ids, y los ids ganan»
prohíbe.

**El 16,4 % que quedaba** eran caminos que ya leían el bundle pero a los que su
pantalla no entregaba iniciativa, entregable ni conversación. Lo cerró la 7.3d,
después de la ola 7.4: el lienzo los recibe por `useArtifactAssessment`, el
copiloto por `useAssistantTurns(project)` y la presentación por el motor.

**Línea base del banco (2026-09-30)**, `tests/fixtures/artifact-evals/linea-base.json`:

| Métrica | Valor |
|---|---|
| Contexto entregado | 32,1 % |
| Por camino | generar 66,7 · criticar 0 · refinar 10 · revisar 40 · sugerir 10 · presentar 55,6 · convertir 40 · copiloto 60 |
| Por ámbito | proyecto 84,6 · global, captura y memoria del proyecto 53,8 · memoria del artefacto 21,9 · agente y hermanos 17,9 · iniciativa 15,4 · **entregable 0 · conversación 0** |
| Artefacto cercado al llegar al modelo | 21,9 % |
| El contrato detecta la sección que falta | 0 % |
| Conservación bajo edición (garantía de 7.1a) | 100 % |
| El copiloto ve el artefacto entero (garantía de 7.1b) | 100 % |

**Cómo se repartió la ola 7.2.** Las tareas 7.2a (el bundle) y 7.2b (presupuesto,
relevancia y duplicados) se entregaron juntas, porque un módulo que nadie
importa no pasa `noOrphanModules`; con ellas, el compositor del chat pasó a
leer el bundle. La que queda como 7.2b es la antigua 7.2c: el prompt base y el
camino IR de diagramas. El ensamblador vive en `services/ai/prompts/` y no en
`services/artifacts`: sólo lee lo que cada operación ya tiene (proyecto,
ajustes, artefacto), y lo que sólo conocen otros contextos (iniciativa,
entregable, conversación) le llegará como datos por puertos en la 7.3, así que
la capa de IA sigue sin importar ningún contexto de dominio.

Las olas 7.2 y 7.3 existen para llevar el contexto entregado y el cercado al
100 %. La ola 7.4 existe para que el contrato detecte lo que falta.
