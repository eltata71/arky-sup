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
  'services/ai/generation/artifacts/artifactGenerationEngine.ts': 86092, // plan diagramas 6.3: 86 126 → 86092 · plan diagramas 6.2: −766, los prompts piden clases de rol en vez de colores · plan diagramas 6.1: 92 638 → 86 892, el camino C4 salió a `generation/diagram/c4ArtifactGeneration.ts`
  'components/ReactFlowCanvas.tsx': 110112, // plan diagramas 4.1: +237, `onNodeDoubleClick` para abrir el nivel C4 siguiente // plan diagramas 3.3: +91, rejilla de 8 px al arrastrar (ADR-007) // 2.3: −122, `exportImage` nombra `CanvasExportOptions`
  'components/ProjectHub.tsx': 78777, // F6-03 corte 2b: bajó al emitir comandos // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'services/ai/prompts/diagramPrompts.ts': 44265, // plan diagramas 6.4: 52 524 → 44265, fuera tres constructores de prompts sin llamantes y el bloque `review` · plan diagramas 6.3: 57 600 → 52524, fuera los prompts de crítica y refinamiento que nadie llamaba
  'components/MemoryCenterModal.tsx': 55552, // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/ArtifactCanvas.tsx': 43500, // plan diagramas 4.3: −360, los tres paneles de diagrama salen a `DiagramPanels` // plan diagramas 4.1: +296, monta «Niveles C4» y el doble clic (13 líneas menos: el guardado del lienzo salió a `planCanvasDiagramSave`) // plan diagramas 2.3: +54, pasa `publicationPackages` al export (el artefacto no sabe su proyecto) // plan diagramas 1.4: +140, guardar texto pasa por `withDiagramContent` (el IR viejo sobrevivía) // plan diagramas 1.1: +79 bytes por montar «Modificar diagrama» (7 líneas menos: `useIsMobile` salió a `hooks/`) // F4-05: la coordinación salió a `services/artifacts/application`
  'constants.ts': 49197,
  'pages/ProjectsPage.tsx': 43870, // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F5-02: el portafolio sale a `useAttentionPortfolio`
  'pages/LMS/LessonModal.tsx': 43207,
  'services/export/adapters/pdfExporter.ts': 44157, // plan diagramas 2.4: +248, publica sus ayudas de texto y delega el diagrama en `diagramPdf` // +395: `latin1`, los PDF escribían los acentos en UTF-8 sobre fuentes WinAnsi («Ã³»)
  'components/artifacts/export/ArtifactExportModal.tsx': 30760, // plan diagramas 3.4: la configuración de imagen salió a `ImageExportConfiguration` // F4-05: la coordinación salió a `services/artifacts/application`
  'components/CustomArtifactRequestModal.tsx': 42447, // F3-07: el import de `Artifact`/`Project` nombra su módulo · F6-03 corte 4: rutas de `domain/`/`application/`
  'components/CustomArtifactBriefWizard.tsx': 41947, // F3-07: el import de `Artifact`/`Project` nombra su módulo · F6-03 corte 4: rutas de `domain/`/`application/`
  'context/OfficeContext.tsx': 20370, // 6.5: la motivación de la iniciativa llega a la producción del encargo (lectura diferida del portafolio)
  'pages/SDDProcessView.tsx': 41644, // F5-01 corte 13: el llamante entrega la persona, que el motor ya no busca en la Oficina
  /**
   * +365 bytes while the line count fell 1005 → 1001. `executeAgentAction` now
   * refuses a high-impact plan that nobody confirmed — a flag three modules had
   * been computing since the agent shipped and nothing read. The policy and its
   * refusal live in `agentConfirmationGate`, which is why the file got shorter
   * while gaining a guarantee.
   */
  'services/agent/agentExecutor.ts': 37815, // plan artefactos 7.4b: −503, el cambio puntual sale a `agentPatchAction` (parche de documento o reescritura) · plan artefactos 7.3b: +30, las generaciones del agente reciben las decisiones de su historial · 6.5: +154, la motivación de la iniciativa llega a las dos generaciones del agente · 7.1a: −4 125, la validación de contenido salió a `agentContentValidation` · 7.1b: +228, el cambio puntual se niega si el modelo no puede ver el artefacto entero
  'components/AssistantPanel.tsx': 36676, // plan artefactos 7.3b: +88, la decisión que se acaba de decir se ofrece como memoria del proyecto · plan diagramas 1.4: +145, los cambios del copiloto pasan por `withDiagramContent` (el lienzo no los mostraba) // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F5-02: `interpretArtifactModification` y las llamadas de IA salieron a `useAssistantTurns`
  'pages/Workspace.tsx': 36572, // plan artefactos 7.3c: −236, los puertos de contexto (motivación, entregables, conversación) llegan por un solo hook, useArtifactContextPorts · plan diagramas 6.2: +194, entrega a la generación la motivación de negocio del proyecto (`useProjectBusinessMotivation`) · F5-01 corte 13: el llamante entrega la persona, que el motor ya no busca en la Oficina · F6-03 corte 4: rutas de `domain/`/`application/`
  'services/artifacts/application/artifactRefinementOrchestrator.ts': 34981, // plan artefactos 7.3c: la petición extiende ArtifactContextPorts · 7.3b · plan artefactos 7.3a: +27, la crítica y el refinamiento reciben el artefacto previo y la motivación (una sola llamada compartida) · plan artefactos 7.1a: −2 470, la conservación de contenido es la política común de `lib/artifacts` · plan diagramas 6.1: +536, acepta y devuelve el IR para no reparsear el texto (la reescritura por dialecto salió a `diagramContentRewrite`) · F3-07: el import de `Artifact`/`Project` nombra su módulo · F6-03 corte 4: rutas de `domain/`/`application/` y el tipo `ArtifactRefinementMode` importado del dominio
  'components/Icons.tsx': 35946,
  'components/CustomNode.tsx': 35990, // plan diagramas 4.1: +186, marca «Detalle» y su texto accesible
  'services/diagram/mermaidToIR.ts': 35364, // 6.5: +6, el ER conserva sus relaciones; antes: plan diagramas 2.1: +1 063, leer `:::clase` y `class` (la lógica vive en `mermaidClasses.ts`)
  'pages/LMS/LMSDashboard.tsx': 34123,
  'services/diagram/suggestionActionExecutors.ts': 33643,
  'components/memory/ChatHistoryPanel.tsx': 32783,
  'components/copilot/ProjectCopilotChatModal.tsx': 24453, // F6-03 corte 2b: `runProjectCommand` y `kind: '…'` en lugar de `updateProject(parcial)` // F5-02: el enrutado del turno salió a `routeCopilotTurn`
  'components/artifacts/fable/FableDiagramCanvas.tsx': 32453,
  'components/CustomEdge.tsx': 32023,
  'components/businessInitiatives/InitiativeDetailPanels.tsx': 25419, // F3-05
  'services/agent/agentContextComposer.ts': 22248, // plan artefactos 7.3b: +632, la sección de decisiones de la conversación · F3-07: el import de `Artifact`/`Project` nombra su módulo · 7.2a: −9 828, la relevancia de la memoria bajó a `services/memory/memoryRelevance` y la selección la hace el bundle
  // F6-05: +18 bytes, the import path to the model-directory door instead of
  // the AI barrel — which took this route's download from 569,3 to 20,5 KB gz.
  'pages/SettingsPage.tsx': 30973,
  'hooks/artifacts/useDiagramRendering.ts': 29282, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'lib/semanticRoleResolver.ts': 28881,
  'services/diagram/qualityRepair.ts': 28460,
  'components/LucidchartViewer.tsx': 27773,
  'services/diagram/layoutQualityService.ts': 27648,
  'services/publicationPipeline/PublicationPipelineTypes.ts': 27231, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'services/artifactCompiler/profiles/contractDefinitions.ts': 26764,
  'services/diagram/quality/diagramQualityService.ts': 26442,
  'services/publicationPipeline/PublicationPreflightService.ts': 26117, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/artifacts/ArtifactInspectorPanel.tsx': 24735, // F4-05: la coordinación salió a `services/artifacts/application`
  'pages/LMS/CourseView.tsx': 24691,
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
  'pages/LMS/LMSCatalog.tsx': 22897,
  'components/ChatInterface.tsx': 22465,
  'services/diagram/diagramTypeQualityGates.ts': 22356,
  'services/diagram/bpmnValidation.ts': 21918,
  'services/publicationPipeline/PublicationTemplateRegistry.ts': 21661,
  'services/export/adapters/pptxExporter.ts': 21273,
  'services/artifacts/application/artifactGenerationRun.ts': 23895, // plan artefactos 7.3c: los puertos de contexto viajan como un objeto (ArtifactContextPorts) · 7.3b · plan artefactos 7.3a: +32, la motivación llega al refinamiento · plan diagramas 6.3: +753, veredicto de fidelidad y canal de degradación hacia el usuario (la lógica está en `diagramFidelityReview`) · plan diagramas 6.2: +226, pasa `businessMotivation` a la generación · plan diagramas 6.1: +1132, conserva el IR que produjo el modelo en vez de reextraerlo del texto (la reescritura por dialecto salió a `diagramContentRewrite`) · F5-01 corte 14: entrega también `artifactGenerationSupport`, el puerto que deja al motor vivir en `services/ai` (13: la persona) · F6-03 corte 4: rutas de `domain/`/`application/`
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
  'services/ai/generation/artifacts/artifactGenerationEngine.ts': 1568, // plan diagramas 6.3: 1 571 → 1568 · plan diagramas 6.2: 1 592 → 1571 · plan diagramas 6.1: 1 723 → 1 592, el camino C4 salió a la vertical de diagramas · F6-01: 1 786 → 1 723 (era `services/geminiService.ts`, 1 921)
  'components/ReactFlowCanvas.tsx': 1950,
  'services/diagram/quality/diagramQualityService.ts': 575,
  'components/ArtifactCanvas.tsx': 962, // plan diagramas 4.3: 964 → 962 // plan diagramas 4.1: 977 → 964 // plan diagramas 2.3: +1 // plan diagramas 1.4: +1, el import de `withDiagramContent` // plan diagramas 1.1: 981 → 975
  'pages/Workspace.tsx': 732, // plan artefactos 7.3c: los puertos de contexto por un solo hook · plan diagramas 6.2: +2, la motivación de negocio (import y hook) · F5-01 corte 13: el llamante entrega la persona, que el motor ya no busca en la Oficina
  'services/ai/prompts/diagramPrompts.ts': 830, // plan diagramas 6.4: 1 030 → 830, fuera tres constructores de prompts sin llamantes y el bloque `review` · plan diagramas 6.3: 1 145 → 1030
  'services/export/adapters/pdfExporter.ts': 1131, // plan diagramas 2.4: +2 // +4: `latin1`
  'components/ProjectHub.tsx': 1060, // F6-03 corte 2b // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/MemoryCenterModal.tsx': 1017, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  // 1001 → 988 el 2026-09-22. No es trabajo nuevo: las extracciones de la fase 2
  // (`deterministicArtifactReuse`, `agentExecutorContracts`) ya lo habían bajado
  // por debajo del techo y nadie fijó el número, así que la deuda seguía
  // apuntada como abierta mientras el gate estaba en verde. Un presupuesto que
  // no se baja cuando se gana es un presupuesto que permite volver a subir.
  'services/agent/agentExecutor.ts': 903, // 7.4b: `agentPatchAction` · 6.5: la motivación de la iniciativa · 7.1a: `agentContentValidation` · 7.1b: la negativa a reescribir lo que no se ve entero
  'pages/ProjectsPage.tsx': 890, // F5-02
  'services/diagram/mermaidToIR.ts': 871, // plan diagramas 2.1
  'components/artifacts/export/ArtifactExportModal.tsx': 596, // plan diagramas 3.4: 844 → 596
  'components/CustomArtifactBriefWizard.tsx': 845,
  'components/CustomArtifactRequestModal.tsx': 845,
  'services/publicationPipeline/PublicationPipelineTypes.ts': 810,
  'constants.ts': 805,
  'components/AssistantPanel.tsx': 732, // plan diagramas 1.4: +1, el import de `withDiagramContent` // F5-02
  'components/artifacts/fable/FableDiagramCanvas.tsx': 790,
  'pages/SDDProcessView.tsx': 785,
  'services/artifacts/application/artifactRefinementOrchestrator.ts': 722, // 7.3c: la petición extiende ArtifactContextPorts · 7.3a: la crítica y el refinamiento comparten una llamada · 7.1a: `lib/artifacts/contentPreservation`
  'components/copilot/ProjectCopilotChatModal.tsx': 582, // F5-02
  'services/diagram/suggestionActionExecutors.ts': 760,
  'components/businessInitiatives/InitiativeDetailPanels.tsx': 576, // F3-05: las reglas bajaron a domain/initiativeCommands
  'pages/LMS/LessonModal.tsx': 737,
  'services/diagram/qualityRepair.ts': 705,
  'hooks/artifacts/useDiagramRendering.ts': 685,
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
