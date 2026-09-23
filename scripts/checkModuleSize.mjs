#!/usr/bin/env node
/**
 * checkModuleSize — the large modules get smaller, never larger.
 *
 * CLAUDE.md has said "do not grow `services/geminiService.ts`,
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
  'services/geminiService.ts': 101971, // F5-01 corte 12: brief y presentaciones fuera del motor
  'components/ReactFlowCanvas.tsx': 109906,
  'components/ProjectHub.tsx': 78862, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'services/ai/prompts/diagramPrompts.ts': 57600,
  'components/MemoryCenterModal.tsx': 55475, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/ArtifactCanvas.tsx': 43291, // F4-05: la coordinación salió a `services/artifacts/application`
  'constants.ts': 49197,
  'pages/ProjectsPage.tsx': 45101,
  'pages/LMS/LessonModal.tsx': 43207,
  'services/export/adapters/pdfExporter.ts': 43514,
  'components/artifacts/export/ArtifactExportModal.tsx': 42543, // F4-05: la coordinación salió a `services/artifacts/application`
  'components/CustomArtifactRequestModal.tsx': 42400, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/CustomArtifactBriefWizard.tsx': 41919, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'pages/SDDProcessView.tsx': 41451, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  /**
   * +365 bytes while the line count fell 1005 → 1001. `executeAgentAction` now
   * refuses a high-impact plan that nobody confirmed — a flag three modules had
   * been computing since the agent shipped and nothing read. The policy and its
   * refusal live in `agentConfirmationGate`, which is why the file got shorter
   * while gaining a guarantee.
   */
  'services/agent/agentExecutor.ts': 41032, // F5-01 corte 8: el turno del parche a `agentConversation`
  'components/AssistantPanel.tsx': 37765, // F5-01 corte 8: +77 B — el turno del agente llega por `useAssistantTurns`, que pone la persona de la Oficina sin un tercer módulo de servicio
  'pages/Workspace.tsx': 36196, // F4-05: la coordinación salió a `services/artifacts/application`
  'services/artifacts/artifactRefinementOrchestrator.ts': 36722, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/Icons.tsx': 35946,
  'components/CustomNode.tsx': 35804,
  'services/diagram/mermaidToIR.ts': 34295,
  'pages/LMS/LMSDashboard.tsx': 34123,
  'services/diagram/suggestionActionExecutors.ts': 33643,
  'components/memory/ChatHistoryPanel.tsx': 32783,
  'components/copilot/ProjectCopilotChatModal.tsx': 28652,
  'components/artifacts/fable/FableDiagramCanvas.tsx': 32453,
  'components/CustomEdge.tsx': 32023,
  'components/businessInitiatives/InitiativeDetailPanels.tsx': 25419, // F3-05
  'services/agent/agentContextComposer.ts': 31444, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'pages/SettingsPage.tsx': 30955,
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
  'services/diagram/irToReactFlow.ts': 23866,
  'services/architectureOffice/officePortfolio.ts': 23876, // F3-07: el import de `Artifact`/`Project` nombra su módulo
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
  'services/artifacts/artifactGenerationRun.ts': 21266, // F3-07: el import de `Artifact`/`Project` nombra su módulo
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
  'services/architectureOffice/OfficeEngagementPlanner.ts': 21001,
  'components/ArtifactSelectionStep.tsx': 20101,
  'pages/UserManagementPage.tsx': 20037,
};

/**
 * Recorded ceilings, measured 2026-08-30. Lower one when a file shrinks;
 * raising one needs a reason in the commit message, not a passing build.
 *
 * `geminiService` is the strangler's subject and should fall vertical by
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
  'services/geminiService.ts': 1923,
  'components/ReactFlowCanvas.tsx': 1950,
  'services/diagram/quality/diagramQualityService.ts': 575,
  'components/ArtifactCanvas.tsx': 981,
  'pages/Workspace.tsx': 728,
  'services/ai/prompts/diagramPrompts.ts': 1145,
  'services/export/adapters/pdfExporter.ts': 1125,
  'components/ProjectHub.tsx': 1063, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  'components/MemoryCenterModal.tsx': 1017, // F3-07: el import de `Artifact`/`Project` nombra su módulo
  // 1001 → 988 el 2026-09-22. No es trabajo nuevo: las extracciones de la fase 2
  // (`deterministicArtifactReuse`, `agentExecutorContracts`) ya lo habían bajado
  // por debajo del techo y nadie fijó el número, así que la deuda seguía
  // apuntada como abierta mientras el gate estaba en verde. Un presupuesto que
  // no se baja cuando se gana es un presupuesto que permite volver a subir.
  'services/agent/agentExecutor.ts': 982, // F5-01 corte 8: el turno del parche a `agentConversation`
  'pages/ProjectsPage.tsx': 925,
  'services/diagram/mermaidToIR.ts': 856,
  'components/artifacts/export/ArtifactExportModal.tsx': 844,
  'components/CustomArtifactBriefWizard.tsx': 845,
  'components/CustomArtifactRequestModal.tsx': 845,
  'services/publicationPipeline/PublicationPipelineTypes.ts': 810,
  'constants.ts': 805,
  'components/AssistantPanel.tsx': 749,
  'components/artifacts/fable/FableDiagramCanvas.tsx': 790,
  'pages/SDDProcessView.tsx': 785,
  'services/artifacts/artifactRefinementOrchestrator.ts': 785,
  'components/copilot/ProjectCopilotChatModal.tsx': 675,
  'services/diagram/suggestionActionExecutors.ts': 760,
  'components/businessInitiatives/InitiativeDetailPanels.tsx': 576, // F3-05: las reglas bajaron a domain/initiativeCommands
  'pages/LMS/LessonModal.tsx': 737,
  'services/diagram/qualityRepair.ts': 705,
  'hooks/artifacts/useDiagramRendering.ts': 685,
  'services/artifactCompiler/profiles/contractDefinitions.ts': 685,
  'services/architectureOffice/officePortfolio.ts': 680,
  'components/memory/ChatHistoryPanel.tsx': 650,
  'components/CustomNode.tsx': 640,
  // 636, not 635: splitting `import { ChatMessage } from '../../types'` into an
  // import from `services/chat` — where that model now lives — costs exactly one
  // line. A boundary paid for in line count, not in logic.
  'services/agent/agentContextComposer.ts': 638, // F3-07: el import de `Artifact`/`Project` nombra su módulo
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
  'services/architectureOffice/OfficeEngagementPlanner.ts': 540,
  'components/artifacts/toolbar/ArtifactBottomToolbar.tsx': 520,
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
