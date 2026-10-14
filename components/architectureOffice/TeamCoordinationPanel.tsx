import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
/**
 * What the office is doing, while it does it.
 *
 * The assistant answers as a team, and without this panel that fact is
 * invisible: the user waits on a spinner and receives one block of text, which
 * is indistinguishable from a single model call. Here the topology is drawn
 * literally — the coordinator fans work out to the specialists, the specialists
 * fan back in to the consolidator — and each hand-off travels the edge it
 * actually took.
 *
 * Every mark on this panel is derived from the real `CoordinationEvent` stream
 * the office emitted. Nothing is simulated to look busy: an animation that
 * invents a plausible sequence is a lie told with motion, and it would be
 * indistinguishable from the truth exactly when the truth matters — when
 * something went wrong.
 *
 * Motion is decorative here, so `useReducedMotion` removes it entirely. The
 * panel still reads: status is carried by colour, glyph and text, never by
 * movement alone.
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../ui/cn';
import { PersonaAvatar } from './PersonaAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { OfficeAgentId } from '../../services/architectureOffice/domain/officeAgentPersonas';
import { useAgentDisplayName } from '../../hooks/useAgentDisplayName';
import type {
  CoordinationEvent,
  CoordinationTeamMember,
} from '../../services/architectureOffice';
import { MOTION } from '../../lib/designTokens';

/** Per-agent state, derived from the stream rather than tracked separately. */
type AgentState = 'idle' | 'active' | 'done' | 'failed';

/**
 * Literal class strings — Tailwind compiles at build time, so a runtime-built
 * class name resolves to nothing and the mark falls back to the browser default
 * (black), which is invisible on the dark surface and glaring on the light one.
 */
const AGENT_STATE_STYLES: Readonly<Record<AgentState, { ring: string; label: string; ink: string }>> = Object.freeze({
  idle: {
    ring: 'ring-gray-200 dark:ring-gray-800',
    label: 'En espera',
    ink: 'text-gray-400 dark:text-gray-500',
  },
  active: {
    ring: 'ring-[#4f46e5] dark:ring-[#6366f1]',
    label: 'Trabajando',
    ink: 'text-[#4f46e5] dark:text-[#6366f1]',
  },
  done: {
    ring: 'ring-[#059669]',
    label: 'Entregó',
    ink: 'text-[#059669]',
  },
  failed: {
    ring: 'ring-[#dc2626] dark:ring-[#ef4444]',
    label: 'Falló',
    ink: 'text-[#dc2626] dark:text-[#ef4444]',
  },
});

/** Shared chip styling — the filters are peers, so they match. */
const FILTER_CHIP = 'rounded-lg px-2 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const FILTER_CHIP_ON = 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200';
const FILTER_CHIP_OFF = 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800';

/** Dot fills for the filter chips — literal strings, as Tailwind needs. */
const AGENT_STATE_DOTS: Readonly<Record<AgentState, string>> = Object.freeze({
  idle: 'bg-gray-300 dark:bg-gray-600',
  active: 'bg-[#4f46e5] dark:bg-[#6366f1]',
  done: 'bg-[#059669]',
  failed: 'bg-[#dc2626] dark:bg-[#ef4444]',
});

const PHASE_LABELS: Readonly<Record<CoordinationEvent['phase'], string>> = Object.freeze({
  framing: 'Encuadre',
  delegating: 'Reparto',
  working: 'Análisis',
  reporting: 'Entrega',
  consolidating: 'Consolidación',
  closed: 'Cierre',
});

/** Geometry of the three columns. The viewBox scales; these are its units. */
const COLUMN_X = { coordinator: 64, specialist: 300, consolidator: 536 } as const;
const ROW_HEIGHT = 62;
const TOP_PADDING = 34;

interface NodeLayout {
  personaId: OfficeAgentId;
  role: CoordinationTeamMember['role'];
  x: number;
  y: number;
}

/**
 * Reads the event stream into the state of each agent.
 *
 * Terminal states win over transient ones: an agent that reported and then
 * appears in a later hand-off is still "done", and a failure is never
 * overwritten by a subsequent event — the reader must be able to find what
 * broke after the operation closes.
 */
const deriveAgentStates = (events: readonly CoordinationEvent[]): Map<OfficeAgentId, AgentState> => {
  const states = new Map<OfficeAgentId, AgentState>();
  for (const event of events) {
    const actor = event.from;
    if (!actor) continue;
    const current = states.get(actor);
    if (current === 'failed') continue;
    if (event.kind === 'agent-failed') states.set(actor, 'failed');
    else if (event.kind === 'agent-reported' || event.kind === 'recommendation') states.set(actor, 'done');
    else if (event.kind === 'agent-started') states.set(actor, 'active');
    else if (current === undefined) states.set(actor, 'active');
  }
  return states;
};

export interface TeamCoordinationPanelProps {
  team: CoordinationTeamMember[];
  events: CoordinationEvent[];
  /** True while the office is still working — drives the live pulse. */
  running?: boolean;
  /** Opens the panel full-width. Absent when the host cannot expand. */
  onToggleExpand?: () => void;
  expanded?: boolean;
  className?: string;
}

export const TeamCoordinationPanel: React.FC<TeamCoordinationPanelProps> = ({
  team,
  events,
  running = false,
  onToggleExpand,
  expanded = false,
  className,
}) => {
  const translateConfig = useUiTranslation();
  const t = useUiTranslation();
  // El alias que el usuario dio a cada agente en su ficha (plan de agentes, 16.1).
  const displayName = useAgentDisplayName();
  const reducedMotion = useReducedMotion();
  /**
   * The agent the reader is inspecting. Filtering the log to one persona is
   * what turns a scrolling transcript into something you can actually read:
   * with four specialists working in parallel, their events interleave and no
   * single thread is followable end to end.
   */
  const [focusedAgent, setFocusedAgent] = useState<OfficeAgentId | null>(null);
  const [diagramOpen, setDiagramOpen] = useState(true);

  const layout = useMemo<NodeLayout[]>(() => {
    const specialists = team.filter((member) => member.role === 'specialist');
    const coordinator = team.find((member) => member.role === 'coordinator');
    const consolidator = team.find((member) => member.role === 'consolidator');
    const centre = TOP_PADDING + ((Math.max(1, specialists.length) - 1) * ROW_HEIGHT) / 2;

    const nodes: NodeLayout[] = specialists.map((member, index) => ({
      personaId: member.personaId,
      role: member.role,
      x: COLUMN_X.specialist,
      y: TOP_PADDING + index * ROW_HEIGHT,
    }));
    if (coordinator) nodes.push({ personaId: coordinator.personaId, role: 'coordinator', x: COLUMN_X.coordinator, y: centre });
    if (consolidator) nodes.push({ personaId: consolidator.personaId, role: 'consolidator', x: COLUMN_X.consolidator, y: centre });
    return nodes;
  }, [team]);

  const positions = useMemo(() => {
    const map = new Map<OfficeAgentId, NodeLayout>();
    for (const node of layout) map.set(node.personaId, node);
    return map;
  }, [layout]);

  const agentStates = useMemo(() => deriveAgentStates(events), [events]);
  // Height hugs the rows: padding, then one gap per *interval* between
  // specialists, then padding again. Multiplying by the count instead leaves a
  // dead band under the diagram that reads as a rendering bug.
  const specialistCount = Math.max(1, layout.filter((node) => node.role === 'specialist').length);
  const height = Math.max(150, TOP_PADDING * 2 + (specialistCount - 1) * ROW_HEIGHT);

  /**
   * The hand-off currently in flight — the edge the pulse travels.
   *
   * Only while the office is actually working: a dot still sitting on an edge
   * after the operation closed claims a message is in flight when none is.
   */
  const liveEdge = useMemo(() => {
    if (!running) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event.from || !event.to) continue;
      const from = positions.get(event.from);
      const to = positions.get(event.to);
      if (from && to) return { from, to, id: event.id };
    }
    return null;
  }, [events, positions, running]);

  /**
   * The log, narrowed to the agent under inspection. Declared with the other
   * derivations and above the empty-team early return: a hook after a
   * conditional return runs in a different order between renders.
   */
  const visibleEvents = useMemo(
    () => (focusedAgent === null
      ? events
      : events.filter((event) => event.from === focusedAgent || event.to === focusedAgent)),
    [events, focusedAgent],
  );

  if (team.length === 0) {
    return (
      <div className={cn('rounded-2xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700', className)}>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {t("ui.el-equipo-aparece-aqui-en-cu.88361f")}
        </p>
        <p className="mt-1 text-2xs text-gray-400 dark:text-gray-500">
          {t("ui.veras-quien-coordina-que-rec.9cefca")}
        </p>
      </div>
    );
  }

  const specialistNodes = layout.filter((node) => node.role === 'specialist');
  const coordinatorNode = layout.find((node) => node.role === 'coordinator');
  const consolidatorNode = layout.find((node) => node.role === 'consolidator');

  return (
    <div className={cn('space-y-3', className)}>
      <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDiagramOpen((open) => !open)}
            aria-expanded={diagramOpen}
            className="inline-flex items-center gap-1 rounded text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', !diagramOpen && '-rotate-90')} aria-hidden />
            {t("ui.coordinacion-del-equipo.327258")}
          </button>
          <div className="flex items-center gap-2">
            {running && (
              <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-[#4f46e5] dark:text-[#6366f1]">
                <span className={cn('inline-block h-1.5 w-1.5 rounded-full bg-[#4f46e5] dark:bg-[#6366f1]', !reducedMotion && 'animate-pulse')} />
                {t("ui.en-curso.f9ade3")}
              </span>
            )}
            {onToggleExpand && (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-label={expanded ? t("uiExpr.contraer-el-panel-de-coordin.b719cd") : t("uiExpr.expandir-el-panel-de-coordin.e9fe02")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                {expanded ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
              </button>
            )}
          </div>
        </div>

        {diagramOpen && (
        <svg
          viewBox={`0 0 600 ${height}`}
          className="w-full"
          style={{ maxHeight: `${height}px` }}
          role="img"
          aria-label={t("uiTemplate.topologia-del-equipo-p0-repa.7d7ec3", { p0: String(coordinatorNode ? displayName(coordinatorNode.personaId) : 'coordinador'), p1: String(specialistNodes.length), p2: String(consolidatorNode ? displayName(consolidatorNode.personaId) : 'el consolidador') })}
        >
          {/* Edges first, so the nodes sit on top of them. */}
          <g>
            {specialistNodes.map((node) => (
              <React.Fragment key={`edges-${node.personaId}`}>
                {coordinatorNode && (
                  <line
                    x1={coordinatorNode.x} y1={coordinatorNode.y}
                    x2={node.x} y2={node.y}
                    className="stroke-gray-200 dark:stroke-gray-800"
                    strokeWidth={1.5}
                  />
                )}
                {consolidatorNode && (
                  <line
                    x1={node.x} y1={node.y}
                    x2={consolidatorNode.x} y2={consolidatorNode.y}
                    className="stroke-gray-200 dark:stroke-gray-800"
                    strokeWidth={1.5}
                  />
                )}
              </React.Fragment>
            ))}
          </g>

          {/* The message in flight. Keyed by event id so a new hand-off
              restarts the travel instead of easing from the previous edge. */}
          {liveEdge && !reducedMotion && (
            <motion.circle
              key={liveEdge.id}
              r={4}
              className="fill-[#4f46e5] dark:fill-[#6366f1]"
              initial={{ cx: liveEdge.from.x, cy: liveEdge.from.y, opacity: 0 }}
              animate={{ cx: liveEdge.to.x, cy: liveEdge.to.y, opacity: [0, 1, 1, 0] }}
              transition={{ duration: MOTION.duration.loop, ease: MOTION.ease.standard, repeat: Infinity }}
            />
          )}

          {layout.map((node) => {
            const state = agentStates.get(node.personaId) ?? 'idle';
            const styles = AGENT_STATE_STYLES[state];
            return (
              <foreignObject
                key={node.personaId}
                /*
                 * Hidden from assistive technology: the <svg> carries
                 * `role="img"` with a label describing the whole topology, and
                 * announcing the node text after it would restate the picture
                 * the label just summarised. The same information is available
                 * as real text in the log below. See rule 4 in `lib/a11y.ts`.
                 */
                aria-hidden
                x={node.x - 46}
                y={node.y - 22}
                width={92}
                height={46}
                style={{ overflow: 'visible' }}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className={cn('rounded-xl ring-2 ring-offset-1 ring-offset-white dark:ring-offset-gray-900', styles.ring)}>
                    <PersonaAvatar personaId={node.personaId} size="sm" decorative />
                  </span>
                  <span className="max-w-[88px] truncate text-[9px] font-semibold leading-tight text-gray-700 dark:text-gray-200">
                    {displayName(node.personaId)}
                  </span>
                  <span className={cn('text-[8px] font-medium leading-none', styles.ink)}>
                    {node.role === 'coordinator' ? t("uiExpr.coordina.6db29f")
                      : node.role === 'consolidator' ? t("uiExpr.consolida.685e97")
                        : t(styles.label)}
                  </span>
                </div>
              </foreignObject>
            );
          })}
        </svg>
        )}

        {/* Each agent is a control: selecting one filters the log to its
            thread. With four specialists working in parallel their events
            interleave, and no single thread is followable end to end. */}
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("ui.filtrar-la-bitacora-por-agen.7495f5")}>
          <button
            type="button"
            onClick={() => setFocusedAgent(null)}
            aria-pressed={focusedAgent === null}
            className={cn(FILTER_CHIP, focusedAgent === null ? FILTER_CHIP_ON : FILTER_CHIP_OFF)}
          >
            {t("ui.todo-el-equipo.9763cb")}
          </button>
          {layout.map((node) => {
            const state = agentStates.get(node.personaId) ?? 'idle';
            const active = focusedAgent === node.personaId;
            return (
              <button
                key={`filter-${node.personaId}`}
                type="button"
                onClick={() => setFocusedAgent(active ? null : node.personaId)}
                aria-pressed={active}
                className={cn(FILTER_CHIP, active ? FILTER_CHIP_ON : FILTER_CHIP_OFF)}
              >
                {displayName(node.personaId)}
                {/* State as a coloured dot, not a middot glyph: a bare "·"
                    reads as punctuation the reader has to decode. The word is
                    carried for assistive technology, which cannot see colour. */}
                <span
                  className={cn('ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle', AGENT_STATE_DOTS[state])}
                  aria-hidden
                />
                <span className="sr-only">{`, ${t(AGENT_STATE_STYLES[state].label)}`}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The log. The picture shows the shape; this shows what was said. */}
      <ol
        className={cn('space-y-1.5 overflow-y-auto pr-1', expanded ? 'max-h-[26rem]' : 'max-h-56')}
        aria-label={focusedAgent
          ? t("uiTemplate.bitacora-de-coordinacion-fil.e21697", { p0: String(displayName(focusedAgent)) })
          : t("uiExpr.bitacora-de-coordinacion.5928f3")}
      >
        {/* Only a *filter* that hides everything needs explaining. An empty
            log with no filter means the operation has not started, which the
            header already says. */}
        {visibleEvents.length === 0 && focusedAgent !== null && (
          <li className="rounded-lg bg-gray-50 px-3 py-4 text-center text-2xs text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
            {displayName(focusedAgent)} {t("ui.todavia-no-ha-intervenido.9dde01")}
          </li>
        )}
        {visibleEvents.map((event) => {

          const failed = event.kind === 'agent-failed' || event.kind === 'operation-failed';
          return (
            <li
              key={event.id}
              className={cn(
                'flex items-start gap-2 rounded-lg px-2 py-1.5 text-2xs',
                failed
                  ? 'bg-red-50 text-[#dc2626] dark:bg-red-950/30 dark:text-[#ef4444]'
                  : 'bg-gray-50 text-gray-600 dark:bg-gray-900/60 dark:text-gray-300',
              )}
            >
              {event.from
                ? <PersonaAvatar personaId={event.from} size="xs" decorative />
                : <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-[9px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">Tú</span>}
              <span className="min-w-0 flex-1">
                <span className="block leading-snug">{event.summary}</span>
                <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {translateConfig(PHASE_LABELS[event.phase])} · {(event.elapsedMs / 1000).toFixed(1)} s
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default TeamCoordinationPanel;
