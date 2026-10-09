#!/usr/bin/env node
/**
 * checkModuleSize — the large modules get smaller, never larger.
 *
 * CLAUDE.md has said "do not grow `services/geminiService.ts` (the engine,
 * `services/ai/generation/artifacts/artifactGenerationEngine.ts` since F5-01),
 * `context/AppContext.tsx`, `components/ArtifactCanvas.tsx`" for a long time,
 * and nothing checked it. That is how all of them got here: nobody ever added
 * a thousand lines, everyone added forty.
 *
 * So each oversized module carries its own recorded ceiling, set at the size
 * it is today. A change may shrink a file — and should lower its entry when it
 * does — but may not grow one. Anything not listed is held to the general
 * `DEFAULT_MAX_LINES`, which is the rule new code lives under.
 *
 * This is a budget, not a refactor: it does not make these files good, it
 * stops them getting worse while the strangler migration carries them away a
 * capability at a time.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** The ceiling for a module that has no recorded exception. */
export const DEFAULT_MAX_LINES = 500;

/**
 * The second half of the ceiling: what a module weighs.
 *
 * A line budget is a budget on newlines. Nothing here stopped a module from
 * staying under its ceiling while doubling in size, and this repository had the
 * worked example: the `en`/`es` dictionary inside `context/AppContext.tsx` was
 * **17 lines and 20 KB** — more than half the file by weight, and invisible to
 * every check we had. It now lives in `lib/i18n/`, and this is what would have
 * caught it: adding 20 KB to a file pushes it past its recorded weight whatever
 * it does with newlines.
 *
 * Same rule as the lines: today's number, monotonic. 20 000 bytes for anything
 * unlisted — 500 lines at the 40 bytes per line this repository actually
 * averages, so the two budgets bind at roughly the same place for ordinary
 * code and diverge exactly when a file starts carrying data instead.
 */
export const DEFAULT_MAX_BYTES = 20_000;

/**
 * Recorded weights, measured 2026-09-02. Lower one when a file shrinks.
 *
 * The list is longer than the line table because density varies: a JSX-heavy
 * screen weighs more per line than a service. That is fine — the number that
 * matters is each file's own, and it may only fall.
 */
export const BYTE_CEILINGS = {
  /**
   * +133 bytes and +1 line, deliberately: `chatWithProject` gained a
   * `modelTier` parameter so the Architecture Office can honour the model tier
   * configured on each agent's card. The card had offered that control since it
   * shipped and only assisted capture read it — every Office agent ran on the
   * default model whatever its card said. The alternative was smuggling the
   * resolved model through `settings.aiConfig.model`, which would have made the
   * trace attribute a per-agent decision to the user's own preference.
   */
  // F6-01: fuera sus delegados públicos y su fábrica de cliente, que sólo leían las pruebas (94 962 → 92638)
  'services/ai/generation/legacyTransport.ts': 22100, // plan clase mundial 10.3: +1 970, la vista previa en streaming de la ruta de texto, con vuelta al camino completo si el flujo falla
  'services/ai/generation/artifacts/artifactGenerationEngine.ts': 81400, // 11.1 ArchiMate: +100 bytes, el tipo mermaid-archimate en los mapas de la generación · , // plan clase mundial 10.3: +106, `onPartial` viaja al transporte y nunca en diagramas · plan diagramas 8.2c: −4 001, la ruta IR de flujo y React Flow sale a `diagram/structuredDiagramArtifactGeneration` · 8.2b anterior: 85 101, // plan diagramas 8.2b: +842, el brief de texto y las reglas de formato sustituyen instrucciones de tamaño y protocolos que se contradecían · plan diagramas 8.2a: −2 248, la evaluación del texto sale a `diagram/diagramTextAssessment` · plan artefactos 7.5a: +415, registra los bloques complementarios en el manifiesto de contexto · plan diagramas 6.3: 86 126 → 86092 · plan diagramas 6.2: −766, los prompts piden clases de rol en vez de colores · plan diagramas 6.1: 92 638 → 86 892, el camino C4 salió a `generation/diagram/c4ArtifactGeneration.ts`
  'components/ReactFlowCanvas.tsx': 109169, // plan diagramas 8.4c: −943, la leyenda sale a `buildLegendData` · plan diagramas 4.1: +237, `onNodeDoubleClick` para abrir el nivel C4 siguiente // plan diagramas 3.3: +91, rejilla de 8 px al arrastrar (ADR-007) // 2.3: −122, `exportImage` nombra `CanvasExportOptions`
  'components/ProjectHub.tsx': 80749, // 11.0: conmutador de agrupación por fase ADM // 12.0: el motor de plantillas y los modales se cargan con import() y sus Suspense suman bytes // F6-03 corte 2b: bajó al emitir comandos // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'services/ai/prompts/diagramPrompts.ts': 45933, // 11.1 ArchiMate: +995 bytes, el prompt de ArchiMate (capas, viewpoints, relaciones) · , // plan artefactos 7.5a: +673, el puerto onContextCaptured llega a los tres constructores (la captura vive en contextManifestCapture) · plan diagramas 6.4: 52 524 → 44265, fuera tres constructores de prompts sin llamantes y el bloque `review` · plan diagramas 6.3: 57 600 → 52524, fuera los prompts de crítica y refinamiento que nadie llamaba
  'components/MemoryCenterModal.tsx': 55654, // 13.2 (4): t() en los literales, +102 B // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/ArtifactCanvas.tsx': 43829, // ola 10.4: +99, «Deshacer» tras aplicar mejoras con IA (la regla vive en `aiUndo`, el lienzo sólo la ofrece) // plan diagramas 8.3a: +181, monta la vista «Notación» (secuencia, Gantt y estados abren en Mermaid nativo; el lienzo los aplanaba) // plan diagramas 8.1a: +49, «Guardar» del lienzo pasa lo que el lienzo mostraba y dice si el texto se conservó (antes convertía cualquier diagrama en React Flow) // plan diagramas 4.3: −360, los tres paneles de diagrama salen a `DiagramPanels` // plan diagramas 4.1: +296, monta «Niveles C4» y el doble clic (13 líneas menos: el guardado del lienzo salió a `planCanvasDiagramSave`) // plan diagramas 2.3: +54, pasa `publicationPackages` al export (el artefacto no sabe su proyecto) // plan diagramas 1.4: +140, guardar texto pasa por `withDiagramContent` (el IR viejo sobrevivía) // plan diagramas 1.1: +79 bytes por montar «Modificar diagrama» (7 líneas menos: `useIsMobile` salió a `hooks/`) // F4-05: la coordinación salió a `services/artifacts/application`
  'constants.ts': 57249, // 11.1 ArchiMate: plantillas de los viewpoints ArchiMate (datos) · , // 11.0: `standard` y `admPhase` en cada plantilla del catálogo (datos)
  'pages/ProjectsPage.tsx': 44541, // 12.0: modales diferidos con React.lazy + Suspense // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F5-02: el portafolio sale a `useAttentionPortfolio`
  'pages/LMS/LessonModal.tsx': 43207,
  'components/artifacts/export/ArtifactExportModal.tsx': 28422, // plan de clase mundial 9.4: −2 383, el resumen de calidad y los formatos bloqueados salen a componentes propios para hacer sitio al recibo · plan diagramas 8.4c: +45, «Sin medir» en vez de una cifra neutra · plan diagramas 3.4: la configuración de imagen salió a `ImageExportConfiguration` // F4-05: la coordinación salió a `services/artifacts/application`
  'components/CustomArtifactRequestModal.tsx': 42394, // 10.1: las etiquetas de fase salen al catálogo · F3-07: el import de `Artifact`/`Project` nombra su módulo · F6-03 corte 4: rutas de `domain/`/`application/`
  'components/CustomArtifactBriefWizard.tsx': 23813, // 12.1: el asistente partido en hook, modelo y piezas
  'context/OfficeContext.tsx': 20370, // 6.5: la motivación de la iniciativa llega a la producción del encargo (lectura diferida del portafolio)
  'pages/SDDProcessView.tsx': 41713, // 13.1: duraciones desde MOTION (+69 B). Antes: F5-01 corte 13: el llamante entrega la persona, que el motor ya no busca en la Oficina
  /**
   * +365 bytes while the line count fell 1005 → 1001. `executeAgentAction` now
   * refuses a high-impact plan that nobody confirmed — a flag three modules had
   * been computing since the agent shipped and nothing read. The policy and its
   * refusal live in `agentConfirmationGate`, which is why the file got shorter
   * while gaining a guarantee.
   */
  'services/agent/agentExecutor.ts': 37846, // plan artefactos 7.3d: +31, las mejoras del agente reciben motivación y conversación · plan artefactos 7.4b: −503, el cambio puntual sale a `agentPatchAction` (parche de documento o reescritura) · plan artefactos 7.3b: +30, las generaciones del agente reciben las decisiones de su historial · 6.5: +154, la motivación de la iniciativa llega a las dos generaciones del agente · 7.1a: −4 125, la validación de contenido salió a `agentContentValidation` · 7.1b: +228, el cambio puntual se niega si el modelo no puede ver el artefacto entero
  'components/AssistantPanel.tsx': 37650, // 10.4b: +974, «Deshacer» en las tres escrituras de IA del asistente (modificar, versión nueva, agente) · plan artefactos 7.3b: +88, la decisión que se acaba de decir se ofrece como memoria del proyecto · plan diagramas 1.4: +145, los cambios del copiloto pasan por `withDiagramContent` (el lienzo no los mostraba) // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F5-02: `interpretArtifactModification` y las llamadas de IA salieron a `useAssistantTurns`
  'pages/Workspace.tsx': 20514, // 12.0: el lienzo del artefacto se carga con React.lazy + Suspense // 10.2: la ejecución y el diagnóstico pasan a la cola persistente; 33 921 → 20 097 bytes. El pequeño margen sobre 20 KB evita un techo de líneas innecesario.
  'services/artifacts/application/artifactRefinementOrchestrator.ts': 35725, // plan diagramas 8.4c: +274, sin medida no hay pasadas de refinamiento · plan diagramas 8.2d: +148, compara la fidelidad con el IR que persistirá, incluidos sus metadatos · plan artefactos 7.5a: +38, la crítica y el refinamiento reciben onContextCaptured · plan artefactos 7.3c: la petición extiende ArtifactContextPorts · 7.3b · plan artefactos 7.3a: +27, la crítica y el refinamiento reciben el artefacto previo y la motivación (una sola llamada compartida) · plan artefactos 7.1a: −2 470, la conservación de contenido es la política común de `lib/artifacts` · plan diagramas 6.1: +536, acepta y devuelve el IR para no reparsear el texto (la reescritura por dialecto salió a `diagramContentRewrite`) · F3-07: el import de `Artifact`/`Project` nombra su módulo · F6-03 corte 4: rutas de `domain/`/`application/` y el tipo `ArtifactRefinementMode` importado del dominio
  'components/Icons.tsx': 35946,
  'components/CustomNode.tsx': 35990, // plan diagramas 4.1: +186, marca «Detalle» y su texto accesible
  'services/diagram/mermaidToIR.ts': 30304, // 11.1 ArchiMate: lee la notación ArchiMate · , // plan diagramas 8.3b: −5 661, los lectores de secuencia, ER y estados salen a `notation/` · plan diagramas 8.2a: +172, Gantt, journey y mindmap dejan de leerse como flowchart · 6.5: +6, el ER conserva sus relaciones; antes: plan diagramas 2.1: +1 063, leer `:::clase` y `class` (la lógica vive en `mermaidClasses.ts`)
  'pages/LMS/LMSDashboard.tsx': 34428, // 13.2 (4): t() en los literales
  'services/diagram/suggestionActionExecutors.ts': 33643,
  'components/memory/ChatHistoryPanel.tsx': 32783,
  'components/copilot/ProjectCopilotChatModal.tsx': 24926, // 10.4b: +473, «Deshacer» tras la acción confirmada del copiloto · F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F5-02: el enrutado del turno salió a `routeCopilotTurn`
  'components/artifacts/fable/FableDiagramCanvas.tsx': 32543, // 13.1: duraciones desde MOTION (+90 B)
  'components/CustomEdge.tsx': 32345, // plan diagramas 8.3d: +322, dibuja la ruta ortogonal de ELK (la decisión vive en `hooks/useEngineRoute`)
  'components/businessInitiatives/InitiativeDetailPanels.tsx': 25617, // F3-05; 13.2 (5): t() en los cinco paneles
  'services/agent/agentContextComposer.ts': 23023, // plan artefactos 7.3d: +775, entregables en curso, razón de negocio y extractos de hermanos en el copiloto · plan artefactos 7.3b: +632, la sección de decisiones de la conversación · F3-07: el import de `Artifact`/`Project` nombra su módulo · 7.2a: −9 828, la relevancia de la memoria bajó a `services/memory/memoryRelevance` y la selección la hace el bundle
  // F6-05: +18 bytes, the import path to the model-directory door instead of
  // the AI barrel — which took this route's download from 569,3 to 20,5 KB gz.
  'pages/SettingsPage.tsx': 30973,
  'hooks/artifacts/useDiagramRendering.ts': 24203, // plan diagramas 8.3d: −3 183, la pasada de ELK sale a `useElkLayoutPass` · plan diagramas 8.1d: −1 896, abrir ya no escribe el plan de layout · F3-07: el import de `Artifact`/`Project` nombra su módulo
  'lib/semanticRoleResolver.ts': 28881,
  'services/diagram/qualityRepair.ts': 27154, // plan diagramas 8.4a: la reagrupación sale a `qualityRepairGrouping.ts` y cada reparación anota lo que escribe · plan diagramas 8.3b: +135, el clon del IR conserva `notation` · plan diagramas 8.1b: +741, el alcance `structural` (repara sin decidir la arquitectura) frente a `full`, que sólo pide «Auto-mejora»
  'components/LucidchartViewer.tsx': 27863, // 13.1: duraciones desde MOTION (+90 B)
  'services/diagram/layoutQualityService.ts': 27648,
  'services/publicationPipeline/PublicationPipelineTypes.ts': 27231, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'services/artifactCompiler/profiles/contractDefinitions.ts': 26764,
  'services/diagram/quality/diagramQualityService.ts': 26699, // plan diagramas 8.4a: +257, el análisis puntúa sin lo derivado y siempre clasificado
  'services/publicationPipeline/PublicationPreflightService.ts': 26117, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/artifacts/ArtifactInspectorPanel.tsx': 24782, // plan diagramas 8.4c: +47, «Sin medir» en vez de una cifra neutra · F4-05: la coordinación salió a `services/artifacts/application`
  'pages/LMS/CourseView.tsx': 24745,
  'services/diagram/irToReactFlow.ts': 23966, // plan diagramas 4.1: +100, el enlace de detalle viaja en los datos del nodo
  'services/architectureOffice/domain/officePortfolio.ts': 23879, // F3-07: el import de `Artifact`/`Project` nombra su módulo · F6-03 corte 3: rutas de `domain/`
  // 23338 → 23347 el 2026-09-22: nueve bytes, y la razón es la que el gate
  // pide que se escriba. La sala pasó de leer un booleano de permiso
  // (`canApprove`) a preguntar si **esta** persona puede firmar **este**
  // encargo (`arbEligibility(engagement)`), porque el autor no decide lo suyo
  // y la pantalla le ofrecía un botón que el servidor rechaza siempre. La regla
  // vive en `describeArbDecisionEligibility`; lo que creció es la llamada, no
  // la lógica. Baja cuando se extraiga el bloque de callbacks del comité.
  'pages/EngagementRoom.tsx': 23347,
  'pages/LMS/LMSCatalog.tsx': 22959,
  'components/ChatInterface.tsx': 22492, // plan artefactos 7.3d: +27, el chat pasa su proyecto a los turnos del agente
  'services/diagram/diagramTypeQualityGates.ts': 22356,
  'services/diagram/bpmnValidation.ts': 21918,
  'services/publicationPipeline/PublicationTemplateRegistry.ts': 21661,
  'services/artifacts/application/artifactGenerationRun.ts': 25200, // plan clase mundial 10.3b: +192, el diagrama anuncia sólo los nombres que el lector validó (nunca el diagrama a medias) · plan clase mundial 10.3: +161, reenvía `onPartial` a la generación · plan diagramas 8.4c: +127, una medida que no existe no entra en la traza · plan diagramas 8.1b: +184, la traza dice qué mejoras propone la puerta sin aplicarlas · plan artefactos 7.5a: +283, graba el manifiesto de contexto en generationTrace · plan artefactos 7.4c: +330, la revisión de fidelidad de documentos y su corrección única · plan artefactos 7.3c: los puertos de contexto viajan como un objeto (ArtifactContextPorts) · 7.3b · plan artefactos 7.3a: +32, la motivación llega al refinamiento · plan diagramas 6.3: +753, veredicto de fidelidad y canal de degradación hacia el usuario (la lógica está en `diagramFidelityReview`) · plan diagramas 6.2: +226, pasa `businessMotivation` a la generación · plan diagramas 6.1: +1132, conserva el IR que produjo el modelo en vez de reextraerlo del texto (la reescritura por dialecto salió a `diagramContentRewrite`) · F5-01 corte 14: entrega también `artifactGenerationSupport`, el puerto que deja al motor vivir en `services/ai` (13: la persona) · F6-03 corte 4: rutas de `domain/`/`application/`
  'context/LMSContext.tsx': 21111,
  'services/observability/observabilityService.ts': 20937,
  /**
   * +119 bytes en dos pasos, y el techo de líneas vuelve a 540 —donde estaba
   * antes de que lo bajara a 536 al medir un fichero que había encogido.
   *
   * El primero: el planificador pide el roster al `agentRegistry` en vez de
   * filtrar `OFFICE_AGENT_PERSONAS` en línea, al coste de una línea de import,
   * y compra la regla de una sola puerta — tres puertas sobre la misma tabla es
   * como aparecieron dos tablas de enrutado que discrepaban.
   *
   * El segundo: cada tarea nace con `createdAt`. Un `new Date()` por literal en
   * vez de uno compartido habría ahorrado la línea del const y le habría dado a
   * tres tareas creadas juntas tres marcas de tiempo distintas.
   *
   * La lección de haber fijado el techo al valor exacto medido: la siguiente
   * adición legítima lo rompe. Un presupuesto sin holgura no protege el
   * fichero, sólo obliga a tocar este archivo.
   */
  'services/architectureOffice/domain/OfficeEngagementPlanner.ts': 21006, // F6-03 corte 3: la ruta de `officeEngagementRecord`
  'components/ArtifactSelectionStep.tsx': 20101,
  'pages/UserManagementPage.tsx': 20037,
  'lib/i18n/locales/es.ts': 24200, // 13.2 (4)(5): claves lucid/mem/users/lmsDash; el diccionario crece con la campaña de t()
  'lib/i18n/locales/en.ts': 22692, // 13.2 (5): el diccionario inglés crece con la campaña de t()
};

/**
 * Recorded ceilings, measured 2026-08-30. Lower one when a file shrinks;
 * raising one needs a reason in the commit message, not a passing build.
 *
 * The engine (`geminiService`, now `artifactGenerationEngine`) is the strangler's subject and should fall vertical by
 * vertical — it lost 442 lines when the LMS moved out. The four modules item 9
 * left open have been decomposed: `ReactFlowCanvas` into
 * `components/reactFlowCanvas/`, `diagramQualityService` into
 * `services/diagram/quality/`, `ArtifactCanvas` into `hooks/artifacts/`, and
 * `Workspace` into `services/artifacts/artifactGeneration*`.
 *
 * `context/AppContext.tsx` has no entry any more: Wave 4 took it from 917
 * lines to composition over seven hooks in `context/app/`, and it now lives
 * under the default like ordinary code. An entry removed is the point of this
 * table — the list is meant to empty.
 */
export const CEILINGS = {
  'services/ai/generation/artifacts/artifactGenerationEngine.ts': 1458, // 11.1 ArchiMate: +3 líneas · , // plan diagramas 8.2c: −69, la ruta IR de flujo y React Flow sale a la vertical de diagramas · 8.2b anterior: 1 520, // plan diagramas 8.2b: +6 líneas para incluir el brief común y atender a la audiencia · plan diagramas 8.2a: 1 568 → 1 514 · plan diagramas 6.3: 1 571 → 1568 · plan diagramas 6.2: 1 592 → 1571 · plan diagramas 6.1: 1 723 → 1 592, el camino C4 salió a la vertical de diagramas · F6-01: 1 786 → 1 723 (era `services/geminiService.ts`, 1 921)
  'components/ReactFlowCanvas.tsx': 1950,
  'services/diagram/quality/diagramQualityService.ts': 575,
  'components/ArtifactCanvas.tsx': 962, // plan diagramas 4.3: 964 → 962 // plan diagramas 4.1: 977 → 964 // plan diagramas 2.3: +1 // plan diagramas 1.4: +1, el import de `withDiagramContent` // plan diagramas 1.1: 981 → 975
  'services/ai/prompts/diagramPrompts.ts': 841, // 11.1 ArchiMate: +10 líneas · , // plan artefactos 7.5a: el import de la captura de contexto · plan diagramas 6.4: 1 030 → 830, fuera tres constructores de prompts sin llamantes y el bloque `review` · plan diagramas 6.3: 1 145 → 1030
  'components/ProjectHub.tsx': 1071, // 11.0 // 12.0 // F6-03 corte 2b // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/MemoryCenterModal.tsx': 1029, // 13.2 (4): +12 líneas, `useAppContext` en seis subcomponentes // F3-07: el import de `Artifact`/`Project` nombra su módulo
  // 1001 → 988 el 2026-09-22. No es trabajo nuevo: las extracciones de la fase 2
  // (`deterministicArtifactReuse`, `agentExecutorContracts`) ya lo habían bajado
  // por debajo del techo y nadie fijó el número, así que la deuda seguía
  // apuntada como abierta mientras el gate estaba en verde. Un presupuesto que
  // no se baja cuando se gana es un presupuesto que permite volver a subir.
  'services/agent/agentExecutor.ts': 904, // 7.3d: los puertos, una vez para todas las llamadas · 7.4b: `agentPatchAction` · 6.5: la motivación de la iniciativa · 7.1a: `agentContentValidation` · 7.1b: la negativa a reescribir lo que no se ve entero
  'pages/ProjectsPage.tsx': 890, // F5-02
  'services/diagram/mermaidToIR.ts': 747, // 11.1 ArchiMate: +7 líneas · , // plan diagramas 8.3b: 873 → 740 · plan diagramas 8.2a: +2 · plan diagramas 2.1
  'components/artifacts/export/ArtifactExportModal.tsx': 564, // plan de clase mundial 9.4: 596 → 564 // plan diagramas 3.4: 844 → 596
  'components/CustomArtifactRequestModal.tsx': 831, // 10.1: las etiquetas de fase salen al catálogo
  'services/publicationPipeline/PublicationPipelineTypes.ts': 810,
  'constants.ts': 978, // 11.1 ArchiMate: plantillas ArchiMate · , // 11.0: una línea más por plantilla
  'components/AssistantPanel.tsx': 744, // 10.4b: +12 · plan diagramas 1.4: +1, el import de `withDiagramContent` // F5-02
  'components/artifacts/fable/FableDiagramCanvas.tsx': 790,
  'pages/SDDProcessView.tsx': 785,
  'services/artifacts/application/artifactRefinementOrchestrator.ts': 732, // plan diagramas 8.4c: +5, sin medida no hay pasadas · plan diagramas 8.2d: +2 para comparar el IR que persistirá · 7.3c: la petición extiende ArtifactContextPorts · 7.3a: la crítica y el refinamiento comparten una llamada · 7.1a: `lib/artifacts/contentPreservation`
  'components/copilot/ProjectCopilotChatModal.tsx': 590, // 10.4b: +8 · F5-02
  'services/diagram/suggestionActionExecutors.ts': 760,
  'components/businessInitiatives/InitiativeDetailPanels.tsx': 582, // F3-05; 13.2 (5): useAppContext en cada panel: las reglas bajaron a domain/initiativeCommands
  'pages/LMS/LessonModal.tsx': 739,
  'services/diagram/qualityRepair.ts': 642, // plan diagramas 8.4a: 710 → 642 · plan diagramas 8.3b: +2, el clon del IR conserva `notation` · plan diagramas 8.1b: +3, el alcance `structural`
  'hooks/artifacts/useDiagramRendering.ts': 561, // plan diagramas 8.3d: 630 → 561 · plan diagramas 8.1d: 685 → 630
  'services/artifactCompiler/profiles/contractDefinitions.ts': 685,
  'services/architectureOffice/domain/officePortfolio.ts': 680,
  'components/memory/ChatHistoryPanel.tsx': 650,
  'components/CustomNode.tsx': 641, // plan diagramas 4.1: +1, texto accesible del enlace de detalle
  // 636, not 635: splitting `import { ChatMessage } from '../../types'` into an
  // import from `services/chat` — where that model now lives — costs exactly one
  // line. A boundary paid for in line count, not in logic.
  'components/CustomEdge.tsx': 630,
  'services/diagram/layoutQualityService.ts': 630,
  'services/publicationPipeline/PublicationPreflightService.ts': 630,
  'pages/SettingsPage.tsx': 619,
  'services/observability/observabilityService.ts': 610,
  'lib/semanticRoleResolver.ts': 595,
  /*
   * `pages/InitiativeRoom.tsx` ya no aparece en ninguna de las dos tablas:
   * 580 → 483 líneas al extraer `InitiativeMotivationPanel`, y de ahí a 426
   * líneas y 17,6 KB al extraer `InitiativeDeliveryPanel`. Está por debajo de
   * los dos techos por defecto, así que una entrada sería reserva y no
   * registro. Una entrada que se borra es el sentido de estas tablas.
   */
  'services/architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes.ts': 565,
  'context/LMSContext.tsx': 530,
  'services/diagram/irToReactFlow.ts': 545,
  'pages/EngagementRoom.tsx': 540,
  'services/architectureOffice/domain/OfficeEngagementPlanner.ts': 540,
  'components/artifacts/toolbar/ArtifactBottomToolbar.tsx': 522, // plan diagramas 4.3: +2, «Editar historia» en Presentación
  'components/artifacts/ArtifactInspectorPanel.tsx': 505,
};

const SOURCE_ROOTS = [
  'api', 'components', 'context', 'hooks', 'lib', 'pages', 'services', 'utils',
  'types.ts', 'constants.ts', 'utils.ts', 'App.tsx',
];

export function sourceFiles() {
  const pathspec = SOURCE_ROOTS.map((root) => `"${root}"`).join(' ');
  return execSync(`git ls-files --cached --others --exclude-standard ${pathspec}`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file) && !file.includes('__tests__/'));
}

export const lineCount = (file) => readFileSync(file, 'utf8').split('\n').length;

/** Size on disk, in bytes — what a line budget cannot see. */
export const byteCount = (file) => Buffer.byteLength(readFileSync(file));

export function scan() {
  const overBudget = [];
  const overWeight = [];
  const shrunk = [];

  for (const file of sourceFiles()) {
    const lines = lineCount(file);
    const bytes = byteCount(file);
    const ceiling = CEILINGS[file] ?? DEFAULT_MAX_LINES;
    const byteCeiling = BYTE_CEILINGS[file] ?? DEFAULT_MAX_BYTES;

    if (lines > ceiling) overBudget.push({ file, lines, ceiling });
    // A recorded ceiling with meaningful slack means the file shrank and the
    // gain was never locked in — report it so the next change tightens it.
    else if (CEILINGS[file] && ceiling - lines > 40) shrunk.push({ file, lines, ceiling });
    else if (BYTE_CEILINGS[file] && byteCeiling - bytes > 2000) {
      shrunk.push({ file, lines: `${bytes} bytes`, ceiling: `${byteCeiling} bytes` });
    }

    // Reported separately from the line failure: a file can be within its line
    // ceiling and still be twice the module it was, and saying which of the two
    // budgets it broke is what tells the author whether to split it or to move
    // data out of it.
    if (bytes > byteCeiling) overWeight.push({ file, bytes, byteCeiling, lines });
  }

  return { overBudget, overWeight, shrunk };
}

function main() {
  const { overBudget, overWeight, shrunk } = scan();

  for (const { file, lines, ceiling } of shrunk) {
    console.log(`[check:module-size] ${file} is now ${lines} lines (ceiling ${ceiling}). Lower it to lock the gain in.`);
  }

  if (overBudget.length === 0 && overWeight.length === 0) {
    console.log(
      `[check:module-size] OK — no module over its ceiling `
      + `(default ${DEFAULT_MAX_LINES} lines, ${DEFAULT_MAX_BYTES} bytes).`,
    );
    return;
  }

  console.error('[check:module-size] FAILED\n');
  for (const { file, lines, ceiling } of overBudget) {
    const recorded = CEILINGS[file] ? 'recorded ceiling' : `default ceiling`;
    console.error(`  ${file}: ${lines} lines, ${recorded} ${ceiling}`);
  }
  for (const { file, bytes, byteCeiling, lines } of overWeight) {
    const recorded = BYTE_CEILINGS[file] ? 'recorded weight' : 'default weight';
    console.error(
      `  ${file}: ${bytes} bytes over ${lines} lines `
      + `(${Math.round(bytes / lines)} B/line), ${recorded} ${byteCeiling}`,
    );
  }
  console.error(
    '\nExtract a hook, a subview or a capability rather than raising the number.\n'
    + '`hooks/artifacts/` and `services/ai/generation/learning/` are the two worked\n'
    + 'examples in this repository. A ceiling goes up only with a reason in the\n'
    + 'commit message.',
  );
  if (overWeight.length > 0) {
    console.error(
      '\nA file over its *byte* ceiling is usually carrying data rather than code:\n'
      + 'a dictionary, a template catalogue, a table of fixtures. `lib/i18n/` is the\n'
      + 'worked example — 20 KB of copy that lived inside a React provider as 17\n'
      + 'lines, under every line budget the repository had.',
    );
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('checkModuleSize.mjs')) main();
