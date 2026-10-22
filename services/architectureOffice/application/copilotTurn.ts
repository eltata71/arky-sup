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
import { spanishFallback, type Translator } from '../../../lib/i18n/spanishFallback';
import {
  classifyAgentIntent,
  resolveArtifactReference,
  type AgentContext,
  type AgentIntent,
} from '../../agent';
import { isOfficeOrchestrationRequest } from './officeOrchestration';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import { OFFICE_AGENT_PERSONAS } from '../domain/officeAgentPersonas';
import { configuredModelTiers, disabledAgentIds, type OfficeAgentProfile } from '../domain/officeAgentProfile';
import { chatWithProjectMeasured } from './projectConversation';
import { buildProjectScope, consultOffice } from './assistantConsultation';
import { coordinateRequest, type CoordinateRequestInput } from './officeCoordination';
import { buildCoordinationInvoker } from './officeCoordinationInvoker';

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

export interface CopilotOrchestrationOptions extends Pick<CoordinateRequestInput,
  'now' | 'onEvent' | 'signal' | 'timeoutMs' | 'maxAiCalls' | 'maxTokens' | 'maxConcurrency' | 'maxSpecialists'> {
  initiatives?: readonly BusinessInitiative[];
  t?: Translator;
}

/** The explicit shortcut uses the dock's coordination; only its presentation differs. */
export const runCopilotOrchestration = async (
  text: string,
  project: Project,
  settings: Settings,
  /** Las fichas resueltas del usuario (plan de agentes, 16.1). */
  profiles: readonly OfficeAgentProfile[] = [],
  options: CopilotOrchestrationOptions = {},
): Promise<string> => {
  const byAgent = new Map(profiles.map((profile) => [profile.agentId, profile]));
  const nameOf = (id: OfficeAgentId): string => byAgent.get(id)?.alias ?? OFFICE_AGENT_PERSONAS[id].alias;
  const { initiatives = [], t = spanishFallback, ...controls } = options;
  const scope = buildProjectScope(project, initiatives);
  const outcome = await coordinateRequest({
    ...controls,
    request: text,
    scope,
    invoke: buildCoordinationInvoker({
      chat: (carrier, message, history, currentSettings, personaId, modelTier, profile, callOptions) =>
        chatWithProjectMeasured(carrier, message, history, currentSettings, personaId as OfficeAgentId | undefined, modelTier, profile, callOptions),
      settings, scope, project, profiles, modelTiers: configuredModelTiers(profiles),
    }),
    unavailableAgents: disabledAgentIds(profiles),
    agentName: nameOf,
  });
  const memberNames = (role: string): string => outcome.team.filter((member) => member.role === role).map((member) => nameOf(member.personaId)).join(', ');
  const review = outcome.consolidationReview;
  const rejections = outcome.rejectedHandoffs ?? [];
  return [
    `**${t('copilot.operation', { id: outcome.operationId, status: outcome.status.toUpperCase() })}**`,
    t('copilot.team', { coordinator: memberNames('coordinator'), specialists: memberNames('specialist'), consolidator: memberNames('consolidator') }),
    t('copilot.completed', { done: String(outcome.contributions.filter((item) => item.status === 'completed').length), total: String(outcome.contributions.length) }),
    t('copilot.rejected', { count: String(rejections.length) }),
    ...rejections.map((handoff) => `- ${nameOf(handoff.sourceAgentId)} → ${nameOf(handoff.targetAgentId)}: ${handoff.rejections.map((rejection) => `${rejection.code}: ${rejection.message}`).join('; ')}`),
    !review ? t('copilot.notEvaluated') : review.ok ? t('copilot.reviewOk') : t('copilot.reviewGaps'),
    ...(review && !review.ok ? review.gaps.map((gap) => `- ${gap}`) : []),
    outcome.refined ? t('copilot.refined') : t('copilot.notRefined'),
    outcome.answer,
  ].join('\n\n');
};

/** A question with nothing to execute, answered and signed by the Office team. */
export const consultCopilot = (
  question: string,
  project: Project,
  initiatives: readonly BusinessInitiative[],
  settings: Settings,
  /** Las fichas resueltas del usuario (plan de agentes, 16.1). */
  profiles: readonly OfficeAgentProfile[] = [],
): Promise<string> => consultOffice({
  request: question,
  project,
  initiatives,
  settings,
  profiles,
  chat: (carrier, message, history, currentSettings, personaOverride, modelTier, profile, callOptions) =>
    chatWithProjectMeasured(carrier, message, history, currentSettings, personaOverride as OfficeAgentId | undefined, modelTier, profile, callOptions),
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
