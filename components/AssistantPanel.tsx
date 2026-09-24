import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppContext, type Project } from '../context/AppContext';
import { ArtifactTemplate } from '../types';
import type { Artifact } from '../lib/artifacts';
import { type ChatMessage, createChatMessage } from '../services/chat';
import { useAgentLessonStore, useAgentMemoryStore } from '../hooks/useAgentMemoryStore';
import type { ArtifactTemplateSuggestion } from '../lib/artifacts/artifactSuggestions';
import { PlusCircleIcon, SparklesIcon, TrashIcon, ArrowUpTrayIcon, ArrowPathIcon, ExclamationTriangleIcon } from './Icons';
import { ARTIFACT_TEMPLATES } from '../constants';
import { AIArchitectAvatar } from './ui/AIArchitectIdentity';
import { useAgentActions, type AgentExecutionTarget, type MemoryScope } from '../hooks/useAgentActions';
import { MODIFICATION_NOTES, useAssistantTurns } from '../hooks/useAssistantTurns';
import { AgentActionCard, AgentResultCard, ProactiveAgentSuggestionCard } from './assistant/AgentActionCard';
import { useAuth } from '../context/AuthContext';
import { SafeRichText } from './ui/SafeRichText';

interface AssistantPanelProps {
  project: Project;
  activeArtifact: Artifact | null;
  setActiveArtifactId: (id: string | null) => void;
  onRequestArtifactGeneration: (template: ArtifactTemplate) => void;
}

const MAX_CHAT_HISTORY = 50;

/**
 * Rendering is synchronous now, so the effect, the state and the
 * cancellation flag all go: `renderMarkdownToSafeHtml` only needed to be
 * awaited because `marked.parse` returns a promise when an async extension is
 * registered, and none ever was here.
 */
const MarkdownRenderer: React.FC<{ markdown: string; className?: string }> = ({ markdown, className }) => (
    <SafeRichText className={className} markdown={markdown} />
);

export const AssistantPanel: React.FC<AssistantPanelProps> = ({ project, activeArtifact, setActiveArtifactId, onRequestArtifactGeneration }) => {
  const {
    settings,
    t,
    updateProjectContext,
    updateProject,
    updateSettings,
    saveChatHistory,
    loadChatHistory,
    updateArtifact,
    createArtifact,
    createArtifactVersion,
    restoreArtifactVersion,
    getArtifact,
    getProject,
    logAgentAction,
  } = useAppContext();
  const { profile } = useAuth();
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const [projectContext, setProjectContext] = useState(
    Array.isArray(project.projectContext) ? project.projectContext : []
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [suggestions, setSuggestions] = useState<ArtifactTemplateSuggestion[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  
  // Last error from a chat round-trip — when set, we render an inline retry
  // banner with the friendly userMessage from the AIServiceError.
  const [lastError, setLastError] = useState<{ category: string; userMessage: string; retryable: boolean; pendingInput: string } | null>(null);

  // Live-streamed text from the model.  When non-null, we render an extra
  // bubble at the bottom with a streaming caret while chunks arrive.  Once
  // the round-trip finishes we promote the text into `messages` and clear.
  const [streamingText, setStreamingText] = useState<string | null>(null);

  // ── Agentic layer ─────────────────────────────────────────────────────────
  // The agent classifies the user's last message, proposes an action plan
  // (rendered as a card below the AI bubble) and — only after the user
  // confirms — invokes the existing AI/versioning pipeline. Nothing here
  // duplicates the chat function-call path; this is purely an
  // intent-routed UX layer over `geminiService` + `createArtifactVersion`.
  const agent = useAgentActions();
  const assistantTurns = useAssistantTurns();

  const chatEndRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(true);
  
  useEffect(() => {
      isMounted.current = true;
      return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const loadMessages = async () => {
        if (!project.id) return;
        if (!settings.aiConfig?.includeChatHistoryByDefault) {
            setMessages([]);
            return;
        }
        const history = await loadChatHistory(project.id);
        if (isMounted.current) {
             setMessages(history.slice(-MAX_CHAT_HISTORY));
        }
    };
    loadMessages();
  }, [project.id, loadChatHistory, settings.aiConfig?.includeChatHistoryByDefault]);

  useEffect(() => {
    if (!settings.aiConfig?.includeChatHistoryByDefault) {
        return;
    }
    if (messages.length > 0) {
        saveChatHistory(project.id, messages.slice(-MAX_CHAT_HISTORY));
    }
  }, [messages, project.id, saveChatHistory, settings.aiConfig?.includeChatHistoryByDefault]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, streamingText]);
  
  useEffect(() => {
    setProjectContext(Array.isArray(project.projectContext) ? project.projectContext : []);
    setHasChanges(false);
  }, [project.id, project.projectContext]);

  // Suggestions are refetched when an artifact is added or removed, not on
  // every edit to the project — an AI call per keystroke would be neither
  // useful nor cheap. The effect therefore reads the project through a ref
  // that always holds the current one.
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    const fetchSuggestions = async () => {
        const project = projectRef.current;
        if (!project) return;
        setSuggestionsLoading(true);
        if (project.artifacts.length === 0) {
            const initialSuggestions = [
                { templateName: 'Diagrama de Contexto (C4-N1)', reason: 'Define el alcance y los actores principales de tu sistema.' },
                { templateName: 'Visión de la Arquitectura', reason: 'Establece las metas y principios que guiarán el proyecto.' }
            ];
            setSuggestions(initialSuggestions);
            setSuggestionsLoading(false);
            return;
        }

        try {
            const results = await assistantTurns.suggestNextArtifacts(project, settings);
            if (isMounted.current) setSuggestions(results);
        } catch (e) {
            console.error("Failed to fetch suggestions:", e);
            if (isMounted.current) setSuggestions([]);
        } finally {
            if (isMounted.current) setSuggestionsLoading(false);
        }
    };
    fetchSuggestions();
  }, [assistantTurns, project.artifacts.length, project.id, settings]);

  const sendMessageWithText = useCallback(async (text: string, baseMessages: ChatMessage[]) => {
    setIsLoading(true);
    setLastError(null);
    setStreamingText('');

    try {
      const { text: aiResponse, functionCall } = await assistantTurns.streamAgent(
        { project, activeArtifact, history: baseMessages, question: text, settings },
        (full) => {
          if (isMounted.current) setStreamingText(full);
        },
      );

      if (isMounted.current) {
        let finalResponse = aiResponse;

        // What the call means — empty, unchanged, which target — is decided by
        // `interpretArtifactModification`; the write is the context's.
        const modification = assistantTurns.interpretModification(functionCall, activeArtifact);
        if (modification.kind === 'not-applied') {
            finalResponse += `\n\n${modification.note}`;
        } else if (modification.kind === 'update-current' && activeArtifact) {
            updateArtifact(project.id, activeArtifact.id, { content: modification.content });
            // updateArtifact resolves synchronously via the optimistic
            // setProjects branch in AppContext, so reading the artifact
            // back through getArtifact gives us the persisted snapshot we
            // can use to verify the change actually landed.
            const persisted = getArtifact(project.id, activeArtifact.id);
            finalResponse += `\n\n${persisted?.content.trim() === modification.content
                ? MODIFICATION_NOTES.updated
                : MODIFICATION_NOTES.updateUnconfirmed}`;
        } else if (modification.kind === 'new-version' && activeArtifact) {
            const newVersion = createArtifactVersion(project.id, activeArtifact.versionGroupId, {
                ...activeArtifact,
                content: modification.content,
            });
            if (newVersion?.id) {
                setActiveArtifactId(newVersion.id);
                finalResponse += `\n\n${MODIFICATION_NOTES.versionCreated(newVersion.version)}`;
            } else {
                finalResponse += `\n\n${MODIFICATION_NOTES.versionFailed}`;
            }
        }

        const updatedMessages: ChatMessage[] = [...baseMessages, createChatMessage('model', finalResponse)];
        setMessages(updatedMessages);

        // Proactive scan: if the model recommended an action ("te sugiero
        // regenerar…", "podrías corregir…"), surface a one-click follow-up
        // card. Only when no plan is already pending — we don't want to
        // distract the user mid-confirmation.
        if (activeArtifact && !agent.pendingPlan) {
          agent.scanForProactiveSuggestion(finalResponse);
        }

        assistantTurns.extractContextNote(baseMessages, text, finalResponse, settings)
            .then(newContextNote => {
                if (newContextNote && isMounted.current) {
                    const updatedContext = [...project.projectContext, newContextNote];
                    setProjectContext(updatedContext);
                    updateProjectContext(project.id, updatedContext);
                }
            })
            .catch(err => console.error("Context auto-extraction failed:", err));
      }
    } catch (error) {
      // We never persist the failed assistant turn — instead we show a
      // retry banner so the user keeps their question in the input and can
      // try again with a single click.
      const friendly = assistantTurns.describeFailure(error);
      console.error('[AssistantPanel] chat failed', { category: friendly.category, status: friendly.status, message: friendly.message });
      if (isMounted.current) {
        setLastError({
          category: friendly.category,
          userMessage: friendly.userMessage,
          retryable: friendly.retryable,
          pendingInput: text,
        });
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
        setStreamingText(null);
      }
    }
  }, [agent, assistantTurns, project, activeArtifact, settings, updateArtifact, createArtifactVersion, getArtifact, setActiveArtifactId, updateProjectContext]);

  const memoryStore = useAgentMemoryStore({
    settings, updateSettings, getProject, updateProject,
    updateProjectContext, getArtifact, updateArtifact,
  });
  const lessonStore = useAgentLessonStore({ getProject, updateProject });

  const handleSendMessage = async () => {
    const trimmed = userInput.trim();
    if (!trimmed || isLoading) return;
    const currentInput = trimmed;
    const newMessages: ChatMessage[] = [...messages, createChatMessage('user', currentInput)];
    setMessages(newMessages);
    setUserInput('');
    // Run the heuristic intent classifier in parallel with the chat call.
    // The classifier is sync and pure so this is essentially free.
    const proposedPlan = agent.proposePlan({
      userInput: currentInput,
      artifact: activeArtifact,
      viewMode: null,
      history: newMessages,
      hasPendingSuggestions: false,
      project,
    });
    // Memory actions: kick off bullet extraction immediately. The card
    // shows "Extrayendo conceptos…" while this runs.
    if (proposedPlan?.actionType.startsWith('memory.save.')) {
      void agent.prepareMemoryDraft({
        history: newMessages,
        project,
        artifact: activeArtifact,
        settings,
      });
    }
    // If the heuristic confidence is low, kick off an async LLM refinement.
    // It runs in the background and quietly replaces the plan card if it
    // improves the verdict. Never blocks the chat round-trip.
    if (proposedPlan && proposedPlan.intent.confidence < 0.6 && activeArtifact && !proposedPlan.actionType.startsWith('memory.save.')) {
      void agent.refineLowConfidencePlan({
        userInput: currentInput,
        artifact: activeArtifact,
        viewMode: null,
        history: newMessages,
        hasPendingSuggestions: false,
        project,
        settings,
      });
    }
    await sendMessageWithText(currentInput, newMessages);
  };

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
      artifact: activeArtifact,
      settings,
    });
  }, [agent, messages, project, activeArtifact, settings]);

  const handleConfirmAgentAction = useCallback(
    async (target: AgentExecutionTarget) => {
      const isMemoryPlan = agent.pendingPlan?.actionType.startsWith('memory.save.') ?? false;
      // Memory actions support running without an anchor artifact — fall
      // back to a synthetic stub so the executor signature is still valid.
      const executionArtifact: Artifact = activeArtifact ?? {
        id: 'memory-anchor',
        versionGroupId: 'memory-anchor',
        version: 1,
        createdAt: new Date().toISOString(),
        name: project.name,
        type: 'markdown',
        phase: '—',
        architecturalView: 'Vista de Gestión y Soporte',
        content: '',
        objective: 'Anclaje sintético para acciones de memoria sin artefacto activo.',
        keyConcepts: [],
        representation: 'document',
      };
      if (!activeArtifact && !isMemoryPlan) return;
      const result = await agent.confirmAndExecute({
        artifact: executionArtifact,
        project,
        settings,
        history: messages,
        // Pass the full mutation surface (incl. `createArtifact`) so any
        // intent the agent classifies — including `artifact.create` from a
        // per-artifact chat — has the persistence path it needs. Omitting
        // `createArtifact` here is what historically made the agent claim
        // success while no new artifact appeared in the Hub.
        store: { createArtifact, createArtifactVersion, updateArtifact },
        memoryStore,
        lessonStore,
        targetOverride: target,
        actor: { id: profile?.uid ?? null, name: profile?.displayName ?? null },
        onPersistRecord: async (record) => {
          // Best-effort durable audit. Failures are swallowed inside
          // AppContext.logAgentAction so they never block the UI.
          await logAgentAction(project.id, record);
        },
      });
      // Append a conversational acknowledgement so the chat history reflects
      // the action and the user can scroll back later. We only declare
      // "completada" when the executor returned `success` — `partial` is
      // surfaced as a more honest message because at least one artifact in
      // the batch failed.
      const acknowledgement =
        result.status === 'success'
          ? `${result.messages[0] ?? 'Acción completada.'}${
              result.appliedChanges.length > 0 ? `\n\n${result.appliedChanges.map((c) => `- ${c}`).join('\n')}` : ''
            }`
          : result.status === 'partial'
            ? `${result.messages[0] ?? 'Acción completada parcialmente.'}${
                result.appliedChanges.length > 0 ? `\n\n${result.appliedChanges.map((c) => `- ${c}`).join('\n')}` : ''
              }`
            : result.status === 'cancelled'
              ? result.messages[0] ?? 'Acción cancelada.'
              : `No pude completar la acción: ${result.messages[0] ?? 'error desconocido'}`;
      setMessages((prev) => [...prev, createChatMessage('model', `*${acknowledgement}*`)]);

      // Switch the canvas to whatever the executor produced — `newArtifactId`
      // for `artifact.create`, `newArtifactVersionId` for new versions of an
      // existing artifact. Previously we only checked `newArtifactVersionId`,
      // so created artifacts never opened on the canvas and the user thought
      // the assistant lied about creating them.
      if (result.status === 'success' || result.status === 'partial') {
        const targetId = result.newArtifactId ?? result.newArtifactVersionId;
        if (targetId) setActiveArtifactId(targetId);
      }
    },
    [activeArtifact, agent, project, settings, messages, createArtifact, createArtifactVersion, updateArtifact, setActiveArtifactId, profile?.uid, profile?.displayName, logAgentAction, memoryStore, lessonStore],
  );

  /**
   * Rollback handler: restores the artifact version that was active BEFORE
   * the agent created the new one. Reuses `restoreArtifactVersion` (which
   * itself creates a new version snapshot of the older content — the audit
   * trail stays linear).
   */
  const handleRollbackLastResult = useCallback(async () => {
    const result = agent.lastResult;
    if (!result || !result.newArtifactVersionId || isRollingBack) return;
    setIsRollingBack(true);
    try {
      const previous = getArtifact(project.id, result.previousArtifactVersionId);
      if (!previous) {
        setMessages((prev) => [...prev, createChatMessage('model', '*No pude revertir: la versión anterior ya no está disponible.*')]);
        return;
      }
      const restored = restoreArtifactVersion(project.id, previous);
      setActiveArtifactId(restored.id);
      setMessages((prev) => [...prev, createChatMessage('model', `*Reversión aplicada: volví a "${previous.name}" v${previous.version} como nueva versión.*`)]);
      agent.acknowledgeResult();
    } finally {
      setIsRollingBack(false);
    }
  }, [agent, project.id, getArtifact, restoreArtifactVersion, setActiveArtifactId, isRollingBack]);

  const handleAcceptProactiveSuggestion = useCallback(() => {
    if (!activeArtifact || !agent.proactiveSuggestion) return;
    agent.acceptProactiveSuggestion({
      suggestion: agent.proactiveSuggestion,
      artifact: activeArtifact,
      viewMode: null,
      history: messages,
      project,
    });
  }, [agent, activeArtifact, messages, project]);

  const retryLastSend = async () => {
    if (!lastError || isLoading) return;
    // The user's question is already the last message (we only failed the
    // model turn).  Re-run with the same baseMessages.
    await sendMessageWithText(lastError.pendingInput, messages);
  };
  
  const handleContextChange = (index: number, value: string) => {
    const newContext = [...projectContext];
    newContext[index] = value;
    setProjectContext(newContext);
    setHasChanges(true);
  };

  const addContextNote = () => {
    const newContext = [...projectContext, ''];
    setProjectContext(newContext);
    setHasChanges(true);
  };
  
  const removeContextNote = (index: number) => {
    const newContext = projectContext.filter((_, i) => i !== index);
    setProjectContext(newContext);
    setHasChanges(true);
  };

  const handleSaveContext = () => {
    updateProjectContext(project.id, projectContext);
    setHasChanges(false);
  };
  
  const handleSuggestionClick = (templateName: string) => {
    const template = ARTIFACT_TEMPLATES.find(t => t.name === templateName);
    if (template) {
        onRequestArtifactGeneration(template);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/50 dark:bg-gray-900/50">
      
      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
          
        {/* Context Section - Collapsible or Compact */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-500">{t('projectContext')}</h3>
                {hasChanges && (
                    <button onClick={handleSaveContext} className="text-xs font-bold text-primary-600 hover:text-primary-700 animate-pulse">
                        {t('save')}
                    </button>
                )}
            </div>
            <div className="space-y-2">
                {projectContext.length === 0 && <p className="text-xs text-gray-400 italic">No hay contexto definido.</p>}
                {projectContext.map((note, index) => (
                    <div key={index} className="flex items-center group">
                        <input
                            type="text"
                            value={note}
                            onChange={(e) => handleContextChange(index, e.target.value)}
                            className="flex-grow text-sm bg-transparent border-b border-transparent focus:border-primary-500 focus:outline-none text-gray-700 dark:text-gray-300 py-1"
                            placeholder="Añadir nota de contexto..."
                        />
                        <button onClick={() => removeContextNote(index)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity">
                            <TrashIcon className="h-3 w-3" />
                        </button>
                    </div>
                ))}
            </div>
            <button onClick={addContextNote} className="mt-2 text-xs flex items-center text-gray-500 hover:text-primary-600 transition-colors">
                <PlusCircleIcon className="h-3 w-3 mr-1" />
                {t('addNote')}
            </button>
        </div>

        {/* Suggested Actions Chips */}
        <div>
            <div className="flex items-center mb-3">
                 <SparklesIcon className="h-4 w-4 text-purple-500 mr-2" />
                 <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-500">Sugerencias IA</h3>
            </div>
            
            <div className="grid grid-cols-1 gap-2">
                {suggestionsLoading ? (
                    <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"></div>
                ) : (
                    suggestions?.slice(0, 3).map((sugg, index) => (
                        <button 
                            key={index}
                            onClick={() => handleSuggestionClick(sugg.templateName)}
                            className="text-left p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:shadow-md transition-all duration-200 group"
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="font-medium text-sm text-gray-800 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                                        {sugg.templateName}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                                        {sugg.reason}
                                    </p>
                                </div>
                                <PlusCircleIcon className="h-4 w-4 text-gray-300 group-hover:text-primary-500" />
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>

        {/* Chat Messages */}
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700/50">
             <div className="flex items-center justify-center mb-4">
                 <span className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 px-2">Historial de Chat</span>
             </div>
            {messages.map((msg, index) => (
                <div key={index} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'model' && (
                        <AIArchitectAvatar size="sm" className="mb-1" />
                    )}
                    <div className={`p-3.5 rounded-2xl max-w-[80%] text-sm shadow-sm ${
                        msg.role === 'user'
                        ? 'bg-primary-600 text-white rounded-br-none'
                        : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none'
                    }`}>
                        <MarkdownRenderer markdown={msg.content} className="prose prose-sm dark:prose-invert max-w-none break-words" />
                    </div>
                </div>
            ))}
            {isLoading && !streamingText && (
                 <div className="flex items-end gap-2 justify-start">
                    <AIArchitectAvatar size="sm" state="thinking" className="mb-1" />
                    <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-none shadow-sm">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-ai-400 animate-bounce [animation-delay:-0.3s]"></span>
                            <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce [animation-delay:-0.15s]"></span>
                            <span className="w-2 h-2 rounded-full bg-ai-400 animate-bounce"></span>
                            <span className="ml-2 text-2xs uppercase tracking-widest-2 text-gray-400">Pensando…</span>
                        </div>
                    </div>
                 </div>
            )}
            {streamingText !== null && streamingText.length > 0 && (
                <div className="flex items-end gap-2 justify-start">
                    <AIArchitectAvatar size="sm" state="streaming" className="mb-1" />
                    <div className="p-3.5 rounded-2xl max-w-[80%] text-sm shadow-sm bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none">
                        <MarkdownRenderer markdown={streamingText} className="prose prose-sm dark:prose-invert max-w-none break-words streaming-caret" />
                    </div>
                </div>
            )}
            {/* ── Agentic action plan / result card ─────────────────────────
                Appears INSIDE the chat history (right under the latest model
                bubble) so the action feels like a natural extension of the
                conversation. Hidden when there's nothing pending and no
                result to surface. */}
            {agent.pendingPlan && (
                <div className="flex justify-start">
                    <div className="max-w-[92%] w-full">
                        <AgentActionCard
                            plan={agent.pendingPlan}
                            phase={agent.executionPhase}
                            isExecuting={agent.executionPhase !== 'idle' && agent.executionPhase !== 'done' && agent.executionPhase !== 'failed'}
                            onConfirm={handleConfirmAgentAction}
                            onCancel={agent.cancelPlan}
                            memoryDraft={agent.memoryDraft}
                            hasActiveArtifact={!!activeArtifact}
                            onChangeMemoryScope={handleChangeMemoryScope}
                            onChangeMemoryBullets={handleChangeMemoryBullets}
                            onRetryMemoryExtraction={handleRetryMemoryExtraction}
                        />
                    </div>
                </div>
            )}
            {!agent.pendingPlan && agent.lastResult && (
                <div className="flex justify-start">
                    <div className="max-w-[92%] w-full">
                        <AgentResultCard
                            result={agent.lastResult}
                            onOpenNewVersion={
                                (() => {
                                    // Open whichever id the executor populated:
                                    // `newArtifactId` for `artifact.create`,
                                    // `newArtifactVersionId` for new versions.
                                    const targetId = agent.lastResult.newArtifactId ?? agent.lastResult.newArtifactVersionId;
                                    return targetId ? () => setActiveArtifactId(targetId) : undefined;
                                })()
                            }
                            onDismiss={agent.acknowledgeResult}
                            onRollback={agent.lastResult.newArtifactVersionId ? handleRollbackLastResult : undefined}
                            isRollingBack={isRollingBack}
                        />
                    </div>
                </div>
            )}
            {!agent.pendingPlan && !agent.lastResult && agent.proactiveSuggestion && activeArtifact && (
                <div className="flex justify-start">
                    <div className="max-w-[92%] w-full">
                        <ProactiveAgentSuggestionCard
                            label={agent.proactiveSuggestion.label}
                            preview={agent.proactiveSuggestion.derivedInstruction}
                            onAccept={handleAcceptProactiveSuggestion}
                            onDismiss={agent.dismissProactiveSuggestion}
                        />
                    </div>
                </div>
            )}
            {!isLoading && lastError && (
                <div role="alert" className="flex items-end gap-2 justify-start animate-slide-up">
                    <AIArchitectAvatar size="sm" state="error" className="mb-1" />
                    <div className="max-w-[85%] p-3.5 rounded-2xl rounded-bl-none bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 shadow-sm">
                        <div className="flex items-start gap-2">
                            <ExclamationTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <p className="text-2xs uppercase tracking-widest-2 font-semibold text-amber-700 dark:text-amber-300 mb-0.5">
                                    {lastError.category === 'overloaded' ? 'Modelo saturado' :
                                     lastError.category === 'rate-limit' ? 'Límite alcanzado' :
                                     lastError.category === 'auth' ? 'Autenticación' :
                                     lastError.category === 'timeout' ? 'Tiempo agotado' :
                                     lastError.category === 'network' ? 'Sin conexión' :
                                     'Error temporal'}
                                </p>
                                <p className="text-sm text-amber-900 dark:text-amber-100 leading-snug">
                                    {lastError.userMessage}
                                </p>
                                {lastError.retryable && (
                                    <button
                                        type="button"
                                        onClick={retryLastSend}
                                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
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
      </div>

      {/* Input Area — sticky composer.
          The wrapper carries `safe-bottom` so iPad/Safari respects
          safe-area-inset-bottom and the input is never tucked behind the
          home-indicator/virtual keyboard. The textarea allows Shift+Enter
          for a new line; Enter sends. The send button is always rendered
          so the user can always identify where to submit.
       */}
      <div
        className="flex-shrink-0 p-3 sm:p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 safe-bottom"
        role="region"
        aria-label={`${t('aiAssistant')} composer`}
      >
        <div className="relative flex items-end gap-2">
            <label htmlFor="arquitecto-agente-input" className="sr-only">
                {t('askSomething')}
            </label>
            <textarea
                id="arquitecto-agente-input"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void handleSendMessage();
                    }
                }}
                placeholder={t('askSomething')}
                rows={1}
                aria-label={`Mensaje para ${t('aiAssistant')}`}
                className="flex-1 min-h-[44px] max-h-40 resize-none pl-3 pr-3 py-3 bg-gray-100 dark:bg-gray-800 border border-transparent focus:bg-white dark:focus:bg-gray-950 focus:border-primary-500 rounded-xl focus:outline-none transition-all text-sm shadow-inner leading-snug"
                disabled={isLoading}
                autoComplete="off"
                spellCheck="true"
            />
            <button
                type="button"
                onClick={handleSendMessage}
                disabled={isLoading || !userInput.trim()}
                aria-label={isLoading ? 'Enviando…' : `Enviar al ${t('aiAssistant')}`}
                aria-busy={isLoading || undefined}
                title={isLoading ? 'Enviando…' : 'Enviar (Enter) · Shift+Enter para nueva línea'}
                className="flex-shrink-0 h-11 w-11 inline-flex items-center justify-center bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-400 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
            >
                {isLoading ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                    <ArrowUpTrayIcon className="h-4 w-4" aria-hidden="true" />
                )}
            </button>
        </div>
        <p className="mt-1.5 text-[10px] uppercase tracking-widest-2 text-gray-400 dark:text-gray-500">
            Enter envía · Shift+Enter nueva línea
        </p>
      </div>
    </div>
  );
};
