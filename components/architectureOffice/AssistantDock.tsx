/**
 * The Office assistant, wherever the user is standing.
 *
 * One surface serves all three levels — initiative, project, deliverable —
 * because the assistant is not three assistants: it is the same office, asked
 * from three vantage points. What changes per level is the *scope*, which the
 * host supplies and which travels into every persona prompt.
 *
 * The dock is deliberately two-panelled. On the left the conversation; on the
 * right the coordination as it happens. That pairing is the point of the
 * feature: an answer that several specialists built, presented as one block of
 * text by a lone chat bubble, is indistinguishable from a single model call.
 * The panel is what makes the team visible, and it is fed by the office's own
 * event stream, never by a re-enactment.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';

import { Check, Copy, PanelRightClose, PanelRightOpen, RotateCcw, X } from 'lucide-react';
import { Button, Spinner, cn } from '../ui';
import { AIArchitectAvatar } from '../ui/AIArchitectIdentity';
import { TeamCoordinationPanel } from './TeamCoordinationPanel';
import { PersonaAvatar } from './PersonaAvatar';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';
import { planOfficeWorkstreams } from '../../services/architectureOffice/officeOrchestration';
import {
  coordinateRequest,
  teamFromPlan,
  type CoordinationEvent,
  type CoordinationOutcome,
  type CoordinationScope,
  type CoordinationTeamMember,
} from '../../services/architectureOffice/officeCoordination';
import { buildCoordinationInvoker } from '../../services/architectureOffice/officeCoordinationInvoker';
import { assistantService } from '../../services/ai';
import { configuredModelTiers, customizedAgentBriefings, disabledAgentIds } from '../../services/architectureOffice';
import { useAgentProfiles } from '../../hooks/useAgentProfiles';
import type { Project, Settings } from '../../types';
import { SafeRichText } from '../ui/SafeRichText';

/** One exchange in the dock. `team`/`events` attach to the office's answer. */
interface DockTurn {
  id: string;
  role: 'user' | 'office';
  text: string;
  status?: CoordinationOutcome['status'];
  contributions?: CoordinationOutcome['contributions'];
}

export interface AssistantDockProps {
  open: boolean;
  onClose: () => void;
  /** What the office is being asked about. Drives every persona prompt. */
  scope: CoordinationScope;
  settings: Settings;
  /** The real project behind the scope, when there is one. */
  project?: Project;
  /** Suggestions seeded per level, so an empty dock is not a blank page. */
  suggestions?: string[];
  className?: string;
}

const LEVEL_TITLES: Readonly<Record<CoordinationScope['level'], string>> = Object.freeze({
  initiative: 'Equipo de arquitectura · Iniciativa de Negocio',
  project: 'Equipo de arquitectura · Proyecto de Arquitectura',
  deliverable: 'Equipo de arquitectura · Solicitud de Entregable',
});

export const AssistantDock: React.FC<AssistantDockProps> = ({
  open,
  onClose,
  scope,
  settings,
  project,
  suggestions = [],
  className,
}) => {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<DockTurn[]>([]);
  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [team, setTeam] = useState<CoordinationTeamMember[]>([]);
  const [running, setRunning] = useState(false);
  /** Widens the coordination side, for reading a long transcript. */
  const [panelExpanded, setPanelExpanded] = useState(false);
  /** Hides it entirely, for reading a long answer. */
  const [panelVisible, setPanelVisible] = useState(true);
  const [copiedTurn, setCopiedTurn] = useState<string | null>(null);
  /** The last request, so a failed run can be retried without retyping it. */
  const [lastRequest, setLastRequest] = useState<string | null>(null);

  /*
   * Las fichas de los agentes, tal y como este usuario las tenga configuradas.
   * Se resuelven una vez por montaje del dock y viajan con cada operación: sin
   * esto, editar la ficha de Carmen cambiaría cómo se ve en una pantalla y nada
   * de lo que dice cuando responde.
   */
  const { profiles } = useAgentProfiles();
  const agentBriefings = useMemo(() => customizedAgentBriefings(profiles), [profiles]);
  const unavailableAgents = useMemo(() => disabledAgentIds(profiles), [profiles]);
  const agentModelTiers = useMemo(() => configuredModelTiers(profiles), [profiles]);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const turnCounter = useRef(0);

  const nextId = useCallback((): string => {
    turnCounter.current += 1;
    return `turn-${turnCounter.current}`;
  }, []);

  const send = useCallback(async (text: string) => {
    const request = text.trim();
    if (request.length === 0 || running) return;

    setInput('');
    setLastRequest(request);
    setTurns((prev) => [...prev, { id: nextId(), role: 'user', text: request }]);

    // The roster comes from the deterministic plan, so the panel shows the team
    // the moment the request is sent rather than after the first call returns.
    // Waiting would leave the user staring at an empty panel for the slowest
    // part of the operation.
    setTeam(teamFromPlan(planOfficeWorkstreams(request, { unavailable: unavailableAgents })));
    setEvents([]);
    setRunning(true);

    const outcome = await coordinateRequest({
      request,
      scope,
      invoke: buildCoordinationInvoker({
        chat: (carrier, message, history, currentSettings, personaOverride, modelTier) =>
          assistantService.chatWithProject(
            carrier,
            message,
            history,
            currentSettings,
            personaOverride as never,
            modelTier,
          ),
        settings,
        scope,
        project,
        // El nivel de modelo que cada agente tiene configurado en su ficha.
        modelTiers: agentModelTiers,
      }),
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      // Las fichas configuradas viajan con la operación: quien respondió es el
      // agente que el usuario configuró, no la persona de fábrica.
      unavailableAgents,
      agentBriefings,
    });

    setTeam(outcome.team);
    setRunning(false);
    setTurns((prev) => [...prev, {
      id: nextId(),
      role: 'office',
      text: outcome.answer,
      status: outcome.status,
      contributions: outcome.contributions,
    }]);
  }, [running, scope, settings, project, nextId, agentBriefings, unavailableAgents, agentModelTiers]);

  /**
   * Copying is the most common thing a user does with an answer several
   * specialists built: it goes into a document, a ticket or an email. The
   * confirmation is per-turn so copying one answer does not flash a tick on
   * every other one.
   */
  const copyAnswer = useCallback(async (turn: DockTurn) => {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopiedTurn(turn.id);
      window.setTimeout(() => setCopiedTurn((current) => (current === turn.id ? null : current)), 1600);
    } catch {
      // A denied clipboard is not worth an error dialog; the text is selectable.
    }
  }, []);

  // The office's turns render as Markdown; a user's turn stays plain text.
  // The memo carries the source rather than pre-rendered HTML so there is no
  // string in this component that looks safe to insert.
  const rendered = useMemo(
    () => turns.map((turn) => ({
      ...turn,
      markdown: turn.role === 'office' ? (turn.text || '') : null,
    })),
    [turns],
  );

  if (!open) return null;

  return (
    <div
      className={cn('fixed inset-0 z-[120] flex justify-end bg-gray-950/40 backdrop-blur-sm', className)}
      role="dialog"
      aria-modal="true"
      aria-label={LEVEL_TITLES[scope.level]}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-5xl flex-col bg-white shadow-pop dark:bg-gray-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-3">
            <AIArchitectAvatar size="sm" />
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
                {LEVEL_TITLES[scope.level]}
              </p>
              <h2 className="truncate text-base font-bold text-gray-900 dark:text-gray-50">{scope.name}</h2>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={panelVisible ? 'Ocultar el panel de coordinación' : 'Mostrar el panel de coordinación'}
              onClick={() => setPanelVisible((visible) => !visible)}
              className="hidden lg:inline-flex"
            >
              {panelVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label="Cerrar" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1',
            panelVisible && (panelExpanded
              ? 'lg:grid-cols-[minmax(0,1fr)_520px]'
              : 'lg:grid-cols-[minmax(0,1fr)_360px]'),
          )}
        >
          {/* Conversation */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {rendered.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-300 p-5 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Pide lo que necesites. No responde un agente suelto: la solicitud entra por la
                    Oficina, se reparte entre los especialistas del dominio y se consolida en una
                    recomendación firmada.
                  </p>
                  {suggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => void send(suggestion)}
                          className="rounded-lg bg-primary-50 px-2.5 py-1.5 text-2xs font-medium text-primary-700 transition-colors hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-950/40 dark:text-primary-300 dark:hover:bg-primary-900/50"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {rendered.map((turn) => (
                <div
                  key={turn.id}
                  className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                      turn.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : turn.status === 'failed'
                          ? 'bg-red-50 text-[#dc2626] dark:bg-red-950/30 dark:text-[#ef4444]'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100',
                    )}
                  >
                    {turn.markdown
                      ? <SafeRichText className="prose prose-sm max-w-none dark:prose-invert" markdown={turn.markdown} />
                      : turn.text}

                    {/* Acting on an answer several specialists built means
                        taking it somewhere else — a document, a ticket. And a
                        failed run should not cost the user their question. */}
                    {turn.role === 'office' && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void copyAnswer(turn)}
                          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-2xs font-medium text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                        >
                          {copiedTurn === turn.id
                            ? <><Check className="h-3 w-3" aria-hidden /> Copiada</>
                            : <><Copy className="h-3 w-3" aria-hidden /> Copiar respuesta</>}
                        </button>
                        {(turn.status === 'failed' || turn.status === 'partial') && lastRequest && (
                          <button
                            type="button"
                            onClick={() => void send(lastRequest)}
                            disabled={running}
                            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-2xs font-medium text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden />
                            Reintentar con el equipo
                          </button>
                        )}
                      </div>
                    )}

                    {/* A partial answer must say so: some specialist did not
                        report, and the recommendation was signed without them. */}
                    {turn.status === 'partial' && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-2xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        Recomendación parcial: algún especialista no pudo entregar su análisis.
                      </p>
                    )}

                    {turn.contributions && turn.contributions.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-2xs font-medium text-gray-500 dark:text-gray-400">
                          Ver los {turn.contributions.length} análisis que la sustentan
                        </summary>
                        <div className="mt-2 space-y-2">
                          {turn.contributions.map((contribution) => (
                            <div key={contribution.personaId} className="rounded-lg bg-white/70 p-2 dark:bg-gray-950/50">
                              <p className="flex items-center gap-1.5 text-2xs font-semibold text-gray-700 dark:text-gray-200">
                                <PersonaAvatar personaId={contribution.personaId} size="xs" decorative />
                                {OFFICE_AGENT_PERSONAS[contribution.personaId].alias} · {OFFICE_AGENT_PERSONAS[contribution.personaId].role}
                                {contribution.status === 'failed' && (
                                  <span className="text-[#dc2626] dark:text-[#ef4444]">· no entregó</span>
                                )}
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-2xs text-gray-600 dark:text-gray-300">
                                {contribution.output}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}

              {running && (
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" role="status">
                  <Spinner />
                  La Oficina está coordinando al equipo…
                </div>
              )}
            </div>

            <form
              className="flex items-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-800"
              onSubmit={(event) => { event.preventDefault(); void send(input); }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                aria-label="Solicitud para el equipo de arquitectura"
                placeholder={`Pide algo sobre ${scope.name}…`}
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <Button type="submit" variant="primary" disabled={running || input.trim().length === 0}>
                Enviar
              </Button>
            </form>
          </div>

          {/* Coordination — the reason this is a dock and not a chat bubble. */}
          {panelVisible && (
            <aside
              aria-label="Coordinación del equipo"
              className="hidden min-h-0 overflow-y-auto border-l border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-900/40 lg:block"
            >
              <TeamCoordinationPanel
                team={team}
                events={events}
                running={running}
                expanded={panelExpanded}
                onToggleExpand={() => setPanelExpanded((value) => !value)}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssistantDock;
