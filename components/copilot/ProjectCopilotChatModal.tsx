/**
 * Project-scoped Arquitecto Agente — agentic variant.
 *
 * Lives inside the Project Hub and replaces the previous consultative
 * `ChatModal` invocation. The difference: this modal turns the Arquitecto Agente
 * into an actual agent that can EXECUTE on the project (create artifacts,
 * regenerate/improve existing ones, update memory) using the same agent layer
 * that powers the per-artifact Assistant. Nothing here re-implements
 * generation, persistence or quality validation — it orchestrates the
 * existing services and the `useAgentActions` hook.
 *
 * Flow on each user turn:
 *  1. Classify intent against the entire project (no active artifact).
 *  2. If intent type is `artifact.create`, propose a creation plan.
 *  3. If intent type is a modification (regenerate/improve/patch/…), resolve
 *     the artifact reference. Single match → propose plan; multiple matches
 *     → render the selector card; nothing → conversational fallback.
 *  4. If intent type is `memory.save.*`, run the existing memory flow.
 *  5. Otherwise, hit `chatWithProject` for a consultative reply.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { motion } from 'motion/react';
import { Modal } from '../Modal';
import { AgentActionCard, AgentResultCard } from '../assistant/AgentActionCard';
import { ArtifactSelectorCard } from './ArtifactSelectorCard';
import { AIArchitectAvatar } from '../ui/AIArchitectIdentity';
import { ArrowUpTrayIcon, ExclamationTriangleIcon, ArrowPathIcon, SparklesIcon } from '../Icons';
import { Copy, Check } from 'lucide-react';
import { useAppContext, type Project } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useAgentActions } from '../../hooks/useAgentActions';
import { createChatMessage, type ChatMessage } from '../../services/chat';
import { classifyAIError, AIServiceError } from '../../services/ai';
import {
  classifyAgentIntent,
  type AgentContext,
  type AgentExecutionTarget,
  type AgentIntent,
  type MemoryScope,
} from '../../services/agent';
import { resolveArtifactReference } from '../../services/agent/artifactReferenceResolver';
import type { Artifact } from '../../lib/artifacts';
import { useAgentLessonStore, useAgentMemoryStore } from '../../hooks/useAgentMemoryStore';
import { OfficeAgentPicker } from '../architectureOffice/OfficeAgentPicker';
import {
  executeOfficeOrchestration,
  isOfficeOrchestrationRequest,
  planOfficeWorkstreams,
} from '../../services/architectureOffice/officeOrchestration';
import { consultOffice } from '../../services/architectureOffice/application/assistantConsultation';
import { chatWithProject } from '../../services/architectureOffice';
import { useInitiatives } from '../../context/InitiativeContext';
import { SafeRichText } from '../ui/SafeRichText';

interface ProjectCopilotChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  /**
   * Open an artifact in the workspace — called after a successful create or
   * when the user clicks "Abrir nueva versión" in the result card.
   */
  onOpenArtifact?: (artifactId: string) => void;
}

const MAX_HISTORY = 50;

export const ProjectCopilotChatModal: React.FC<ProjectCopilotChatModalProps> = ({
  isOpen,
  onClose,
  project,
  onOpenArtifact,
}) => {
  const {
    settings,
    updateSettings,
    updateProjectContext,
    updateProject,
    saveChatHistory,
    loadChatHistory,
    createArtifact,
    createArtifactVersion,
    updateArtifact,
    getArtifact,
    getProject,
    logAgentAction,
  } = useAppContext();
  const { profile } = useAuth();
  const { initiatives } = useInitiatives();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastError, setLastError] = useState<{ category: string; userMessage: string; retryable: boolean; pendingInput: string } | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  /**
   * When the heuristic resolves multiple artifact candidates we hold the
   * pending intent here and render the selector card. The user picks one,
   * confirms, and we promote it to a real `pendingPlan`.
   */
  const [pendingDisambiguation, setPendingDisambiguation] = useState<{
    intent: AgentIntent;
    candidates: Artifact[];
    selectedId: string | null;
  } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(true);

  const agent = useAgentActions();

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Persistent chat history — reuses the same storage key as the consultative
  // chat so the conversation continues seamlessly across modals.
  useEffect(() => {
    if (!isOpen || !project.id) return;
    let cancelled = false;
    void (async () => {
      const history = await loadChatHistory(project.id);
      if (!cancelled && isMounted.current) {
        setMessages(history.slice(-MAX_HISTORY));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, project.id, loadChatHistory]);

  useEffect(() => {
    if (messages.length > 0 && project.id) {
      saveChatHistory(project.id, messages.slice(-MAX_HISTORY));
    }
  }, [messages, project.id, saveChatHistory]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const memoryStore = useAgentMemoryStore({
    settings, updateSettings, getProject, updateProject,
    updateProjectContext, getArtifact, updateArtifact,
  });
  const lessonStore = useAgentLessonStore({ getProject, updateProject });

  /**
   * Answer a question the agent layer found no executable intent in.
   *
   * This used to be a single `chatWithProject` call — one model, one voice.
   * That quietly contradicted the product's premise: the assistant is the front
   * desk of an architecture office, so a consultative answer is the office's
   * answer, produced by the specialists whose domains the question touches and
   * signed by the consolidator. The executable paths above are unchanged; only
   * the *consultative* one, which had no team behind it, now has one.
   *
   * The coordination panel lives in `AssistantDock`; here the team shows up as
   * the attribution line under the answer, because this modal's job is the
   * artifact work and a second animated panel would compete with it.
   */
  const conversationalReply = useCallback(async (question: string) => {
    setIsLoading(true);
    setLastError(null);
    try {
      const answer = await consultOffice({
        request: question,
        project,
        initiatives,
        settings,
        chat: (carrier, message, history, currentSettings, personaOverride) =>
          chatWithProject(carrier, message, history, currentSettings, personaOverride as never),
      });

      if (isMounted.current) {
        setMessages((prev) => [...prev, createChatMessage('model', answer)]);
      }
    } catch (error) {
      const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
      console.error('[ProjectCopilotChatModal] chat failed', { category: friendly.category, message: friendly.message });
      if (isMounted.current) {
        setLastError({
          category: friendly.category,
          userMessage: friendly.userMessage,
          retryable: friendly.retryable,
          pendingInput: question,
        });
      }
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, [project, settings, initiatives]);

  /**
   * Drive a plan for a known anchor artifact (set explicitly by the user via
   * the selector card, or auto-resolved when unambiguous). Reuses
   * `useAgentActions.proposePlan` so the rest of the agent flow (confirmation
   * card, execution phases, result banner) just works.
   */
  const proposeAnchoredPlan = useCallback(
    (input: { userInput: string; baseMessages: ChatMessage[]; anchor: Artifact | null }) => {
      const plan = agent.proposePlan({
        userInput: input.userInput,
        artifact: input.anchor,
        viewMode: null,
        history: input.baseMessages,
        hasPendingSuggestions: false,
        project,
      });
      if (plan?.actionType.startsWith('memory.save.')) {
        void agent.prepareMemoryDraft({
          history: input.baseMessages,
          project,
          artifact: input.anchor,
          settings,
        });
      }
      return plan;
    },
    [agent, project, settings],
  );

  const handleSendMessage = useCallback(async () => {
    const text = userInput.trim();
    if (!text || isLoading) return;

    const newMessages: ChatMessage[] = [...messages, createChatMessage('user', text)];
    setMessages(newMessages);
    setUserInput('');
    // Clear any stale disambiguation prompt — a new turn supersedes it.
    setPendingDisambiguation(null);

    // Explicit Lucía commands use the Office orchestration engine: relevant
    // specialists run independently, then Alejandro receives every result and
    // produces the single user-facing consolidation.
    if (isOfficeOrchestrationRequest(text)) {
      setIsLoading(true);
      setLastError(null);
      try {
        const plan = planOfficeWorkstreams(text);
        const result = await executeOfficeOrchestration(
          plan,
          // The persona travels through the signature, never inside the
          // prompt text: Lucía's brief is concatenated into every workstream
          // prompt, and an `@Alias` inside it would otherwise hijack the
          // specialist that mention resolution picks for the sub-call.
          async (personaId, instruction) => chatWithProject(
            project,
            instruction,
            [],
            settings,
            personaId,
          ),
        );
        if (isMounted.current) {
          const completed = result.workstreamResults.filter((item) => item.status === 'completed').length;
          const summary = [
            `**Operación ${result.operationId} — ${result.status.toUpperCase()}**`,
            `Workstreams completados: ${completed}/${result.workstreamResults.length}.`,
            result.consolidation,
          ].join('\n\n');
          setMessages((prev) => [...prev, createChatMessage('model', summary)]);
        }
      } catch (error) {
        const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
        if (isMounted.current) {
          setLastError({
            category: friendly.category,
            userMessage: friendly.userMessage,
            retryable: friendly.retryable,
            pendingInput: text,
          });
        }
      } finally {
        if (isMounted.current) setIsLoading(false);
      }
      return;
    }

    // STEP 1: classify intent against the project as a whole. The Global
    // Copilot never has an active artifact in scope, so the classifier sees
    // `artifact: null`. Creation / memory intents will fire; modification
    // intents need the reference resolver below.
    const ctx: AgentContext = {
      artifact: null,
      viewMode: null,
      history: newMessages,
      hasPendingSuggestions: false,
    };
    const intent = classifyAgentIntent(text, ctx);

    // STEP 2: artifact.create / memory.save.* run without an active artifact.
    if (intent.type === 'artifact.create' || intent.type.startsWith('memory.save.')) {
      proposeAnchoredPlan({ userInput: text, baseMessages: newMessages, anchor: null });
      return;
    }

    // STEP 3: modification intents need an artifact. The classifier returned
    // `unknown` because there's no active artifact in ctx, but the user might
    // still have referenced one by name ("mejora el diagrama de contexto").
    // We rerun the classifier against each candidate identified by the
    // reference resolver — when one wins clearly we use it; when more than
    // one is close we surface the selector card.
    const reference = resolveArtifactReference(project, text);
    if (reference.unambiguous && reference.resolved) {
      const anchoredCtx: AgentContext = { ...ctx, artifact: reference.resolved };
      const anchoredIntent = classifyAgentIntent(text, anchoredCtx);
      if (anchoredIntent.type !== 'unknown' && anchoredIntent.type !== 'artifact.explainOnly') {
        proposeAnchoredPlan({ userInput: text, baseMessages: newMessages, anchor: reference.resolved });
        return;
      }
    } else if (reference.candidates.length > 1) {
      // Build a "best-guess intent" so the disambiguation card knows what to
      // do after the user picks an artifact. We pin the first candidate to
      // get a valid type and confidence — the artifact will be swapped in
      // when the user confirms.
      const probeCtx: AgentContext = { ...ctx, artifact: reference.candidates[0] };
      const probeIntent = classifyAgentIntent(text, probeCtx);
      if (probeIntent.type !== 'unknown' && probeIntent.type !== 'artifact.explainOnly') {
        setPendingDisambiguation({
          intent: probeIntent,
          candidates: reference.candidates,
          selectedId: null,
        });
        return;
      }
    }

    // STEP 4: nothing actionable detected → consultative fallback.
    await conversationalReply(text);
  }, [userInput, isLoading, messages, project, settings, proposeAnchoredPlan, conversationalReply]);

  /**
   * Promote a disambiguation choice into a real plan. We re-classify the
   * intent with the chosen artifact in context so the planner picks the
   * right action type / confidence — we never reuse the probe intent
   * verbatim (its artifact id was the first candidate, not the user's pick).
   */
  const handleConfirmSelection = useCallback(() => {
    if (!pendingDisambiguation || !pendingDisambiguation.selectedId) return;
    const target = pendingDisambiguation.candidates.find((a) => a.id === pendingDisambiguation.selectedId);
    if (!target) return;
    setPendingDisambiguation(null);
    proposeAnchoredPlan({
      userInput: pendingDisambiguation.intent.userInstruction,
      baseMessages: messages,
      anchor: target,
    });
  }, [pendingDisambiguation, messages, proposeAnchoredPlan]);

  /**
   * Execute the pending plan. Mirrors the per-artifact AssistantPanel flow —
   * the anchor artifact is whatever the plan points at; for `artifact.create`
   * the executor ignores the anchor and produces a brand-new artifact via
   * `store.createArtifact`.
   */
  const handleConfirmAction = useCallback(
    async (executionTarget: AgentExecutionTarget) => {
      const plan = agent.pendingPlan;
      if (!plan) return;
      const isCreate = plan.actionType === 'artifact.create';
      const isMemory = plan.actionType.startsWith('memory.save.');
      const anchorArtifact: Artifact = (() => {
        if (isCreate || isMemory) {
          return {
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
          };
        }
        // Modify-style action: the plan's artifactId points at the real target.
        const target = getArtifact(project.id, plan.artifactId);
        return target ?? ({} as Artifact);
      })();

      const result = await agent.confirmAndExecute({
        artifact: anchorArtifact,
        project,
        settings,
        history: messages,
        store: { createArtifact, createArtifactVersion, updateArtifact },
        memoryStore,
        lessonStore,
        targetOverride: executionTarget,
        actor: { id: profile?.uid ?? null, name: profile?.displayName ?? null },
        onPersistRecord: async (record) => {
          await logAgentAction(project.id, record);
        },
      });

      const ackParts: string[] = [];
      if (result.status === 'success') {
        ackParts.push(result.messages[0] ?? 'Acción completada.');
        if (result.appliedChanges.length > 0) {
          ackParts.push(result.appliedChanges.map((c) => `- ${c}`).join('\n'));
        }
        // Surface the open action right in the acknowledgement so the user
        // does not have to scan the card for the "Abrir" button.
        const newId = result.newArtifactId ?? result.newArtifactVersionId;
        if (newId) {
          const opened = getArtifact(project.id, newId);
          if (opened) {
            ackParts.push(`Artefacto disponible en el Hub: "${opened.name}" (v${opened.version}).`);
          }
        }
      } else if (result.status === 'partial') {
        ackParts.push(result.messages[0] ?? 'Acción completada parcialmente.');
        if (result.appliedChanges.length > 0) {
          ackParts.push(result.appliedChanges.map((c) => `- ${c}`).join('\n'));
        }
      } else if (result.status === 'cancelled') {
        ackParts.push(result.messages[0] ?? 'Acción cancelada.');
      } else {
        ackParts.push(`No pude completar la acción: ${result.messages[0] ?? 'error desconocido'}`);
      }
      setMessages((prev) => [...prev, createChatMessage('model', `*${ackParts.join('\n\n')}*`)]);
    },
    [
      agent,
      project,
      settings,
      messages,
      createArtifact,
      createArtifactVersion,
      updateArtifact,
      memoryStore,
      lessonStore,
      logAgentAction,
      profile?.uid,
      profile?.displayName,
      getArtifact,
    ],
  );

  const handleOpenCreatedArtifact = useCallback(() => {
    const result = agent.lastResult;
    if (!result || !onOpenArtifact) return;
    const targetId = result.newArtifactId ?? result.newArtifactVersionId;
    if (!targetId) return;
    onOpenArtifact(targetId);
    onClose();
  }, [agent.lastResult, onOpenArtifact, onClose]);

  const handleChangeMemoryScope = useCallback((scope: MemoryScope) => {
    agent.updateMemoryDraft({ scope });
  }, [agent]);

  const handleChangeMemoryBullets = useCallback((bullets: string[]) => {
    agent.updateMemoryDraft({ bullets });
  }, [agent]);

  const handleRetryMemoryExtraction = useCallback(() => {
    void agent.prepareMemoryDraft({
      history: messages,
      project,
      artifact: null,
      settings,
    });
  }, [agent, messages, project, settings]);

  const handleRetrySend = useCallback(async () => {
    if (!lastError || isLoading) return;
    await conversationalReply(lastError.pendingInput);
  }, [lastError, isLoading, conversationalReply]);

  const handleCopyMessage = (content: string, index: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Arquitecto Agente"
      description={`Agente operativo del proyecto · ${project.name}`}
    >
      <div className="flex flex-col h-[70vh]">
        <OfficeAgentPicker onSelect={(persona) => setUserInput(`@${persona.alias} `)} />
        <div className="flex-grow overflow-y-auto pr-2 space-y-3" aria-live="polite">
          {messages.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-primary-200 dark:border-primary-800/60 bg-primary-50/60 dark:bg-primary-900/15 p-4">
              <div className="flex items-start gap-3">
                <AIArchitectAvatar size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    Soy tu Arquitecto Agente
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                    Puedo crear artefactos, mejorar los existentes, guardar contexto del proyecto o responder consultas usando el contexto completo. Empieza con algo como
                    {' '}
                    <em>"Crea un diagrama de integración…"</em>
                    {' '}o{' '}
                    <em>"Mejora el diagrama de contexto…"</em>.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {messages.map((msg, index) => (
            <div key={index} className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-3 rounded-xl max-w-[85%] relative ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-br-sm' : 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-sm'}`}>
                <SafeRichText
                  className="prose prose-sm dark:prose-invert max-w-none break-words"
                  markdown={msg.content}
                />
                {msg.role === 'model' && (
                  <button
                    onClick={() => handleCopyMessage(msg.content, index)}
                    className="absolute -bottom-6 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                    aria-label="Copiar mensaje"
                  >
                    {copiedIndex === index ? (
                      <><Check className="h-3 w-3" /> Copiado</>
                    ) : (
                      <><Copy className="h-3 w-3" /> Copiar</>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-end gap-2 justify-start">
              <AIArchitectAvatar size="sm" state="thinking" className="mb-1" />
              <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-sm">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 rounded-full bg-primary-500 animate-bounce" />
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">Analizando proyecto…</span>
                </div>
              </div>
            </div>
          )}

          {/* Disambiguation card — only when the user referenced an artifact ambiguously. */}
          {pendingDisambiguation && (
            <div className="flex justify-start">
              <div className="max-w-[92%] w-full">
                <ArtifactSelectorCard
                  candidates={pendingDisambiguation.candidates}
                  selectedId={pendingDisambiguation.selectedId}
                  onSelect={(artifact) => setPendingDisambiguation((curr) => curr ? { ...curr, selectedId: artifact.id } : curr)}
                  onConfirm={handleConfirmSelection}
                  onCancel={() => setPendingDisambiguation(null)}
                  prompt={`Tu instrucción "${pendingDisambiguation.intent.userInstruction}" coincide con varios artefactos. Selecciona el objetivo:`}
                />
              </div>
            </div>
          )}

          {/* Pending plan card — shown while waiting for confirmation. */}
          {agent.pendingPlan && (
            <div className="flex justify-start">
              <div className="max-w-[92%] w-full">
                <AgentActionCard
                  plan={agent.pendingPlan}
                  phase={agent.executionPhase}
                  isExecuting={agent.executionPhase !== 'idle' && agent.executionPhase !== 'done' && agent.executionPhase !== 'failed'}
                  onConfirm={handleConfirmAction}
                  onCancel={agent.cancelPlan}
                  memoryDraft={agent.memoryDraft}
                  hasActiveArtifact={false}
                  onChangeMemoryScope={handleChangeMemoryScope}
                  onChangeMemoryBullets={handleChangeMemoryBullets}
                  onRetryMemoryExtraction={handleRetryMemoryExtraction}
                />
              </div>
            </div>
          )}

          {/* Result banner. */}
          {!agent.pendingPlan && agent.lastResult && (
            <div className="flex justify-start">
              <div className="max-w-[92%] w-full">
                <AgentResultCard
                  result={agent.lastResult}
                  onOpenNewVersion={(agent.lastResult.newArtifactId || agent.lastResult.newArtifactVersionId) && onOpenArtifact ? handleOpenCreatedArtifact : undefined}
                  onDismiss={agent.acknowledgeResult}
                />
              </div>
            </div>
          )}

          {!isLoading && lastError && (
            <div role="alert" className="flex items-end gap-2 justify-start">
              <AIArchitectAvatar size="sm" state="error" className="mb-1" />
              <div className="max-w-[85%] p-3 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-0.5 uppercase tracking-widest">
                      Error temporal
                    </p>
                    <p className="text-sm text-amber-900 dark:text-amber-100 leading-snug">{lastError.userMessage}</p>
                    {lastError.retryable && (
                      <button
                        type="button"
                        onClick={handleRetrySend}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                      >
                        <ArrowPathIcon className="h-3.5 w-3.5" />
                        Reintentar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLastError(null)}
                      className="mt-2 ml-2 inline-flex items-center px-2 py-1.5 rounded-md text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        <div className="mt-3 flex items-center border border-gray-300 dark:border-gray-600 rounded-xl focus-within:ring-2 focus-within:ring-primary-500 bg-white dark:bg-gray-800">
          <div className="pl-3 pr-1 text-gray-400" aria-hidden>
            <SparklesIcon className="h-4 w-4 text-ai-500" />
          </div>
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendMessage();
              }
            }}
            placeholder='Pide acciones o consulta al proyecto…  p.ej. "Crea un diagrama de integración entre A y B"'
            className="flex-grow px-2 py-3 bg-transparent focus:outline-none text-sm min-h-[44px]"
            disabled={isLoading || !!agent.pendingPlan}
            aria-label="Mensaje al Arquitecto Agente"
          />
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={isLoading || !!agent.pendingPlan || !userInput.trim()}
            className="p-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-primary-600 hover:text-primary-700 disabled:text-gray-400 disabled:cursor-not-allowed"
            aria-label="Enviar mensaje"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ProjectCopilotChatModal;
