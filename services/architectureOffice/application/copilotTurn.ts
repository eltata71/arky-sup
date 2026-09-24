/**
 * Where a turn of the project copilot goes (F5-02).
 *
 * `ProjectCopilotChatModal` made this decision inside its send handler, across
 * four service modules: an explicit «Lucía, coordina…» runs the Office's
 * orchestration; otherwise the agent classifies the intent against the whole
 * project; a modification names an artifact the reference resolver has to
 * find, and when two are close the person picks; and anything with nothing to
 * execute is a question for the Office team. That is the copilot's application
 * logic, and a modal was the one place it could not be tested.
 *
 * It lives in the Office because the Office drives the agent — never the
 * reverse — and every branch that answers without executing is the Office's.
 */
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { BusinessInitiative } from '../../businessInitiatives';
import {
  classifyAgentIntent,
  resolveArtifactReference,
  type AgentContext,
  type AgentIntent,
} from '../../agent';
import {
  executeOfficeOrchestration,
  isOfficeOrchestrationRequest,
  planOfficeWorkstreams,
} from '../officeOrchestration';
import type { OfficeAgentId } from '../officeAgentPersonas';
import { chatWithProject } from './projectConversation';
import { consultOffice } from './assistantConsultation';

export type CopilotTurnRoute =
  /** An explicit coordination command: the Office's orchestration engine. */
  | { readonly kind: 'office-orchestration' }
  /** An executable intent; `anchor` is null for creation and memory. */
  | { readonly kind: 'plan'; readonly anchor: Artifact | null }
  /** A modification whose artifact is ambiguous: the person picks. */
  | { readonly kind: 'disambiguate'; readonly intent: AgentIntent; readonly candidates: Artifact[] }
  /** Nothing to execute: the Office team answers. */
  | { readonly kind: 'consult' };

const isActionable = (intent: AgentIntent): boolean =>
  intent.type !== 'unknown' && intent.type !== 'artifact.explainOnly';

export const routeCopilotTurn = (
  text: string,
  project: Project,
  history: AgentContext['history'],
): CopilotTurnRoute => {
  if (isOfficeOrchestrationRequest(text)) return { kind: 'office-orchestration' };

  // The copilot never has an active artifact in scope, so the classifier sees
  // `artifact: null`. Creation and memory intents fire on that alone.
  const ctx: AgentContext = { artifact: null, viewMode: null, history, hasPendingSuggestions: false };
  const intent = classifyAgentIntent(text, ctx);
  if (intent.type === 'artifact.create' || intent.type.startsWith('memory.save.')) {
    return { kind: 'plan', anchor: null };
  }

  // A modification needs an artifact the user may have named ("mejora el
  // diagrama de contexto"). One clear match anchors the plan; several close
  // ones go to the selector, with a probe intent from the first candidate —
  // re-classified against the person's pick before anything runs.
  const reference = resolveArtifactReference(project, text);
  if (reference.unambiguous && reference.resolved) {
    if (isActionable(classifyAgentIntent(text, { ...ctx, artifact: reference.resolved }))) {
      return { kind: 'plan', anchor: reference.resolved };
    }
  } else if (reference.candidates.length > 1) {
    const probe = classifyAgentIntent(text, { ...ctx, artifact: reference.candidates[0] });
    if (isActionable(probe)) {
      return { kind: 'disambiguate', intent: probe, candidates: reference.candidates };
    }
  }
  return { kind: 'consult' };
};

/**
 * Runs an explicit coordination command and returns the summary to post:
 * relevant specialists run independently, the consolidator signs one answer.
 */
export const runCopilotOrchestration = async (
  text: string,
  project: Project,
  settings: Settings,
): Promise<string> => {
  const plan = planOfficeWorkstreams(text);
  const result = await executeOfficeOrchestration(
    plan,
    // The persona travels through the signature, never inside the prompt
    // text: the coordinator's brief is concatenated into every workstream
    // prompt, and an `@Alias` inside it would otherwise hijack the specialist
    // that mention resolution picks for the sub-call.
    async (personaId, instruction) => chatWithProject(project, instruction, [], settings, personaId),
  );
  const completed = result.workstreamResults.filter((item) => item.status === 'completed').length;
  return [
    `**Operación ${result.operationId} — ${result.status.toUpperCase()}**`,
    `Workstreams completados: ${completed}/${result.workstreamResults.length}.`,
    result.consolidation,
  ].join('\n\n');
};

/** A question with nothing to execute, answered and signed by the Office team. */
export const consultCopilot = (
  question: string,
  project: Project,
  initiatives: readonly BusinessInitiative[],
  settings: Settings,
): Promise<string> => consultOffice({
  request: question,
  project,
  initiatives,
  settings,
  chat: (carrier, message, history, currentSettings, personaOverride, modelTier) =>
    chatWithProject(carrier, message, history, currentSettings, personaOverride as OfficeAgentId | undefined, modelTier),
});

/**
 * The anchor a global action runs against. Creation and memory actions have no
 * artifact of their own, and the executor ignores this one — it exists so the
 * agent's single-artifact contract holds for them too.
 */
export const copilotAnchorFor = (project: Pick<Project, 'name'>): Artifact => ({
  id: 'copilot-anchor',
  versionGroupId: 'copilot-anchor',
  version: 1,
  createdAt: new Date().toISOString(),
  name: project.name,
  type: 'markdown',
  phase: '—',
  architecturalView: 'Vista de Gestión y Soporte',
  content: '',
  objective: 'Anclaje sintético para acciones globales del Arquitecto Agente.',
  keyConcepts: [],
  representation: 'document',
});
