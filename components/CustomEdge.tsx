import React, { useMemo } from 'react';
import { EdgeProps, getBezierPath, getSmoothStepPath, EdgeLabelRenderer, BaseEdge, useStore } from 'reactflow';
import { EDGE_TOKENS, TYPOGRAPHY_TOKENS } from '../lib/diagramTokens';
import { BPMN_FLOW_TOKENS, detectBpmnFlowType, type BpmnFlowType } from '../lib/diagramBpmn';
import { slotOffsetPx, type EdgeLabelSlot } from '../services/diagram/edgeLabelSlots';

type EdgeRelation = 'sync' | 'async' | 'data-flow' | 'dependency' | 'inheritance' | 'default';

/**
 * Fallback edge-type detection when the relation is not present in `data`.
 * Left as a defensive hook for legacy diagrams generated before the IR
 * included `relation`; new IR output from mermaidToIR already sets it.
 */
const detectEdgeType = (label?: string, edgeType?: string): EdgeRelation => {
    if (edgeType && (EDGE_TOKENS.light as Record<string, unknown>)[edgeType]) {
        return edgeType as EdgeRelation;
    }
    const t = (label || '').toLowerCase();
    if (/\b(async|event|message|publish|subscribe|emit|notify)\b/.test(t)) return 'async';
    if (/\b(data|flow|stream|etl|transfer|replicate)\b/.test(t)) return 'data-flow';
    if (/\b(depends|uses|imports|references|reads)\b/.test(t)) return 'dependency';
    if (/\b(extends|implements|inherits|contains|composes)\b/.test(t)) return 'inheritance';
    if (/\b(http|rest|grpc|request|call|invoke|query)\b/.test(t)) return 'sync';
    return 'default';
};

function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) return hex;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CRITICALITY_BOOST: Record<string, number> = {
    low: 0,
    medium: 0.4,
    high: 1.0,
    critical: 1.6,
};

const EDGE_LABEL_VISIBLE_LIMIT = 56;

/**
 * Semantic zoom: below this viewport zoom the label pill would render at an
 * unreadable physical size (≈4px text) while still cluttering dense
 * diagrams, so edge labels are hidden and only the line + arrow remain.
 * Selected / narrative-focused edges keep their label at any zoom.
 */
const LABEL_MIN_ZOOM = 0.4;
const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

/**
 * Shorten an edge label so the canvas stays legible. Strategy:
 *  - Drop the protocol annotation after a `·` separator (already shown as
 *    a badge) when the prefix alone fits the limit.
 *  - Keep the first sentence when the label is a multi-sentence narrative.
 *  - Otherwise truncate with an ellipsis at a word boundary.
 *
 * The full label remains accessible via the title attribute and the
 * inspector panel — this is purely a visual concern.
 */
export function shortenEdgeLabel(raw: string, limit = EDGE_LABEL_VISIBLE_LIMIT): string {
    const text = raw.trim();

    // 1) ALWAYS strip the trailing "· protocol" annotation. The protocol is
    //    surfaced separately as a coloured badge next to the label, so
    //    keeping the duplicate in the main string just adds noise.
    const dotIdx = text.indexOf('·');
    if (dotIdx > 0) {
        const prefix = text.slice(0, dotIdx).trim();
        if (prefix.length > 0) {
            return shortenEdgeLabel(prefix, limit);
        }
    }

    if (text.length <= limit) return text;

    // 2) Keep the first sentence when there's a clean break.
    const sentenceMatch = text.match(/^([^.!?]{1,80}[.!?])/);
    if (sentenceMatch && sentenceMatch[1].length <= limit) return sentenceMatch[1].trim();

    // 3) Otherwise truncate at the last word boundary before `limit`.
    const truncated = text.slice(0, limit);
    const lastSpace = truncated.lastIndexOf(' ');
    const cut = lastSpace > limit * 0.6 ? truncated.slice(0, lastSpace) : truncated;
    return `${cut.trim()}…`;
}

const CustomEdge: React.FC<EdgeProps> = ({
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, label, data, style,
    markerEnd, markerStart, selected,
}) => {
    const edgeData = (data ?? {}) as {
        edgeType?: string;
        animated?: boolean;
        isDimmed?: boolean;
        isNarrativeFocus?: boolean;
        criticality?: 'low' | 'medium' | 'high' | 'critical';
        protocol?: string;
        direction?: 'unidirectional' | 'bidirectional';
        dataSensitivity?: 'public' | 'internal' | 'confidential' | 'restricted' | 'pii' | 'phi' | 'pci';
        retryPolicy?: string;
        semanticType?: string;
        frequency?: 'real-time' | 'near-real-time' | 'batch' | 'on-demand' | 'periodic';
        synchrony?: 'sync' | 'async' | 'fire-and-forget' | 'request-reply';
        security?: string;
        payload?: string;
        trust?: 'internal' | 'partner' | 'external' | 'public';
        sla?: string;
        relation?: string;
        bpmnFlowType?: string;
        messageFlow?: boolean;
        sequenceFlow?: boolean;
        association?: boolean;
        defaultFlow?: boolean;
        condition?: string;
        crossLane?: boolean;
        routingStyle?: 'orthogonal' | 'smooth' | 'bezier';
        visualPriority?: 'critical' | 'primary' | 'secondary';
        bundled?: boolean;
        crossBoundary?: boolean;
        isSecondary?: boolean;
        fullLabel?: string;
        labelTooltip?: string;
        labelSlot?: EdgeLabelSlot;
    };
    const zoom = useStore(zoomSelector);
    const relation = detectEdgeType(label as string, edgeData.edgeType);
    const bpmnFlow: BpmnFlowType | null = detectBpmnFlowType({
        bpmnFlowType: edgeData.bpmnFlowType,
        messageFlow: edgeData.messageFlow,
        sequenceFlow: edgeData.sequenceFlow,
        association: edgeData.association,
        defaultFlow: edgeData.defaultFlow,
        condition: edgeData.condition,
        semanticType: edgeData.semanticType,
        relation: edgeData.relation,
        label: typeof label === 'string' ? label : undefined,
        crossLane: edgeData.crossLane,
    });

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const palette = (isDark ? EDGE_TOKENS.dark : EDGE_TOKENS.light)[relation];

    // BPMN tokens take precedence when the edge declares (directly or by
    // structural inference) a BPMN flow type. They override the generic
    // relation palette so sequence / message / association / conditional /
    // default flows are visually distinguishable per BPMN 2.0 conventions.
    const bpmnTokens = bpmnFlow ? BPMN_FLOW_TOKENS[bpmnFlow] : null;
    const strokeColor = bpmnTokens
        ? (isDark ? bpmnTokens.dark : bpmnTokens.light)
        : ((style?.stroke as string) || palette.stroke);
    const isDimmed = Boolean(edgeData.isDimmed);
    const isNarrativeFocus = Boolean(edgeData.isNarrativeFocus);
    const priorityOpacity = edgeData.visualPriority === 'secondary' || edgeData.isSecondary ? 0.72 : 1;
    const edgeOpacity = isDimmed ? 0.18 : priorityOpacity;

    // Phase 2: respect the user's reduced-motion preference. The animated
    // dashed overlay is purely decorative; disabling it does not change the
    // semantic meaning of the edge.
    const prefersReducedMotion = useMemo(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    }, []);

    // BPMN message flows are visually animated by default to emphasise the
    // cross-participant nature; sequence/association/default/conditional are
    // never animated even when the legacy relation would have animated them.
    const bpmnWantsAnimation = bpmnFlow === 'message-flow';
    const animated = !prefersReducedMotion && (
        bpmnFlow
            ? bpmnWantsAnimation
            : (relation === 'async' || relation === 'data-flow' || edgeData.animated)
    );
    const criticalityBoost = CRITICALITY_BOOST[edgeData.criticality ?? 'low'] ?? 0;
    const baseStrokeWidth = (bpmnTokens?.strokeWidth ?? palette.strokeWidth) + criticalityBoost;
    const boundaryPenalty = edgeData.crossBoundary && (edgeData.visualPriority === 'secondary' || edgeData.isSecondary) ? -0.3 : 0;
    const strokeWidth = (selected || isNarrativeFocus ? baseStrokeWidth + 1 : baseStrokeWidth) + boundaryPenalty;
    const strokeDashArray = edgeData.bundled ? (bpmnTokens?.dash ?? '5 5') : (bpmnTokens?.dash ?? palette.dash);

    // Phase 2: bidirectional edges must visually carry an arrow on BOTH
    // ends. ReactFlow only auto-applies `markerEnd` from the edge spec, so
    // we synthesise a matching `markerStart` here when the IR declares
    // `direction === 'bidirectional'`. The marker is a *type* descriptor
    // (`MarkerType.ArrowClosed`) so ReactFlow registers it in its <defs>
    // automatically.
    /**
     * Same story as `markerEnd` below: an object here became
     * `marker-start="[object Object]"`, so a bidirectional relation has been
     * drawing an arrowhead at one end only. It now points at a local def.
     */
    const startMarkerId = `bidirectional-marker-${id}`;
    const needsStartMarker = edgeData.direction === 'bidirectional' && !markerStart;
    const effectiveMarkerStart: string | undefined = needsStartMarker
        ? `url(#${startMarkerId})`
        : markerStart;

    // BPMN markerEnd overrides: association removes the arrow entirely;
    // message-flow uses an open / hollow arrow (`Arrow` type) so it is
    // visually distinct from sequence-flow's solid arrow. We never touch
    // the markerEnd when the diagram is not BPMN.
    /**
     * Id of this edge's own arrowhead definition, rendered below.
     *
     * `BaseEdge` takes `markerEnd` as a **string** — a `url(#id)` reference —
     * because ReactFlow resolves marker objects into `<defs>` at the graph
     * level, before an edge component ever sees them. This code returned
     * `{ type: MarkerType.Arrow, … }` objects instead, which React wrote out
     * as `marker-end="[object Object]"`: an invalid reference, so every BPMN
     * message flow and every fallback arrowhead rendered with **no marker at
     * all**. The type error was reporting a live rendering defect, not a
     * notational one.
     *
     * Defining the marker here keeps the fix local to the component that
     * decides it needs one. Moving the BPMN override up into `irToReactFlow`,
     * where ReactFlow would build the defs itself, is the tidier end state.
     */
    const ownMarkerId = `bpmn-marker-${id}`;

    /** `'hollow'` and `'solid'` need a local def; anything else reuses the spec. */
    const bpmnMarkerShape = bpmnTokens && bpmnTokens.marker !== 'none' && (bpmnTokens.marker === 'hollow' || !markerEnd)
        ? (bpmnTokens.marker === 'hollow' ? 'hollow' : 'solid')
        : null;

    const effectiveMarkerEnd = useMemo((): string | undefined => {
        if (!bpmnTokens) return markerEnd;
        // An association line deliberately has no arrowhead.
        if (bpmnTokens.marker === 'none') return undefined;
        if (bpmnMarkerShape) return `url(#${ownMarkerId})`;
        return markerEnd;
    }, [bpmnTokens, bpmnMarkerShape, markerEnd, ownMarkerId]);

    // Routing: smoothstep is the default for every relation — free-form
    // bezier curves between distant nodes are what produced the long
    // sweeping arcs crossing half the canvas. Bezier survives only when the
    // IR explicitly requests it AND the edge is short enough for the curve
    // to read as a deliberate organic connector rather than spaghetti.
    const requestedStyle = edgeData.routingStyle ?? 'smooth';
    const manhattanDistance = Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY);
    const BEZIER_MAX_DISTANCE = 480;
    const routingStyle = requestedStyle === 'bezier' && manhattanDistance > BEZIER_MAX_DISTANCE
        ? 'smooth'
        : requestedStyle;
    const usesSmoothStep = routingStyle === 'orthogonal' || routingStyle === 'smooth';
    // Make the policy decision visually meaningful: 'orthogonal' picks square
    // corners (technical / integration diagrams where right angles communicate
    // strict routing); 'smooth' picks a rounded corner radius so generic
    // diagrams keep their friendlier feel. 'bezier' is handled by the curve
    // path below.
    const smoothStepBorderRadius = routingStyle === 'orthogonal' ? 0 : 18;
    const [edgePath, rawLabelX, rawLabelY] = usesSmoothStep
        ? getSmoothStepPath({
            sourceX, sourceY, targetX, targetY,
            sourcePosition, targetPosition,
            borderRadius: smoothStepBorderRadius,
        })
        : getBezierPath({
            sourceX, sourceY, targetX, targetY,
            sourcePosition, targetPosition,
        });

    // Parallel-edge label ladder: when several edges share the same node
    // pair, fan their labels out perpendicular to the dominant edge axis so
    // they never stack at the shared midpoint. Single edges keep offset 0.
    const ladderOffset = slotOffsetPx(edgeData.labelSlot);
    const isMostlyHorizontal = Math.abs(targetX - sourceX) >= Math.abs(targetY - sourceY);
    const labelX = rawLabelX + (isMostlyHorizontal ? 0 : ladderOffset);
    const labelY = rawLabelY + (isMostlyHorizontal ? ladderOffset : 0);

    // Higher-contrast label backgrounds: in light mode the previous 10%
    // tint was too faint against the editorial canvas (the iPad screenshots
    // showed edge labels disappearing on busy diagrams). Switch to a solid
    // near-white background with a colour-tinted border so the text stays
    // readable while the relation hue still communicates the edge type.
    const labelBg = isDark
        ? 'rgba(15,23,42,0.92)'
        : 'rgba(255,255,255,0.96)';
    const labelBorderColor = isDark
        ? hexToRgba(strokeColor, 0.40)
        : hexToRgba(strokeColor, 0.55);
    const labelColor = isDark ? '#f1f5f9' : strokeColor;

    // Phase 2: discreet extra badges. Each badge surfaces one piece of
    // governance metadata (sensitivity, frequency, retry, security) so the
    // architect can audit a diagram visually. We deliberately cap visible
    // badges at 2 to avoid label saturation — the full tooltip below
    // contains the rest.
    type BadgeSpec = { key: string; label: string; tooltip: string; tone: 'sensitivity' | 'frequency' | 'retry' | 'security' };
    const extraBadges = useMemo<BadgeSpec[]>(() => {
        const out: BadgeSpec[] = [];
        if (edgeData.dataSensitivity && edgeData.dataSensitivity !== 'public' && edgeData.dataSensitivity !== 'internal') {
            const lookup: Record<string, string> = {
                confidential: 'CONF', restricted: 'REST', pii: 'PII', phi: 'PHI', pci: 'PCI',
            };
            const label = lookup[edgeData.dataSensitivity] ?? edgeData.dataSensitivity.toUpperCase();
            out.push({
                key: 'sensitivity',
                label,
                tooltip: `Datos: ${edgeData.dataSensitivity}`,
                tone: 'sensitivity',
            });
        }
        if (edgeData.frequency) {
            const lookup: Record<string, string> = {
                'real-time': 'RT', 'near-real-time': 'NRT', batch: 'BATCH',
                'on-demand': 'OND', periodic: 'PER',
            };
            const label = lookup[edgeData.frequency] ?? edgeData.frequency.toUpperCase();
            out.push({
                key: 'frequency',
                label,
                tooltip: `Frecuencia: ${edgeData.frequency}`,
                tone: 'frequency',
            });
        }
        if (edgeData.security && edgeData.security.trim().length > 0) {
            out.push({
                key: 'security',
                label: 'SEC',
                tooltip: `Seguridad: ${edgeData.security}`,
                tone: 'security',
            });
        }
        if (edgeData.retryPolicy && edgeData.retryPolicy.trim().length > 0) {
            out.push({
                key: 'retry',
                label: 'RETRY',
                tooltip: `Reintentos: ${edgeData.retryPolicy}`,
                tone: 'retry',
            });
        }
        return out;
    }, [edgeData.dataSensitivity, edgeData.frequency, edgeData.security, edgeData.retryPolicy]);

    const visibleBadges = extraBadges.slice(0, 2);
    const hiddenBadgeCount = extraBadges.length - visibleBadges.length;

    // Accessible tooltip: composes every dimension into a single descriptive
    // string. Surfaced via `title` on the label group so keyboard / screen
    // reader users can audit the edge without the inspector.
    const accessibleTooltip = useMemo(() => {
        const parts: string[] = [];
        const fullLabel = (edgeData.fullLabel as string | undefined) ?? (typeof label === 'string' ? label : String(label ?? ''));
        if (fullLabel) parts.push(fullLabel);
        if (bpmnTokens) parts.push(`BPMN: ${bpmnTokens.label}`);
        if (edgeData.protocol) parts.push(`Protocolo: ${edgeData.protocol}`);
        if (edgeData.direction === 'bidirectional') parts.push('Dirección: bidireccional');
        if (edgeData.criticality) parts.push(`Criticidad: ${edgeData.criticality}`);
        if (edgeData.dataSensitivity) parts.push(`Sensibilidad: ${edgeData.dataSensitivity}`);
        if (edgeData.frequency) parts.push(`Frecuencia: ${edgeData.frequency}`);
        if (edgeData.synchrony) parts.push(`Sincronía: ${edgeData.synchrony}`);
        if (edgeData.security) parts.push(`Seguridad: ${edgeData.security}`);
        if (edgeData.retryPolicy) parts.push(`Reintentos: ${edgeData.retryPolicy}`);
        if (edgeData.sla) parts.push(`SLA: ${edgeData.sla}`);
        if (edgeData.payload) parts.push(`Payload: ${edgeData.payload}`);
        return parts.join(' · ');
    }, [label, bpmnTokens, edgeData.fullLabel, edgeData.protocol, edgeData.direction, edgeData.criticality, edgeData.dataSensitivity, edgeData.frequency, edgeData.synchrony, edgeData.security, edgeData.retryPolicy, edgeData.sla, edgeData.payload]);

    const filter = useMemo(() => {
        if (selected) return `drop-shadow(0 0 4px ${strokeColor})`;
        if (isNarrativeFocus) return `drop-shadow(0 0 6px ${strokeColor}aa)`;
        if (edgeData.criticality === 'critical') return `drop-shadow(0 0 5px ${strokeColor}88)`;
        return undefined;
    }, [selected, isNarrativeFocus, edgeData.criticality, strokeColor]);

    return (
        <>
            {/* The arrowhead this edge references by id. Hollow for a BPMN
                message flow, solid otherwise, so the two read as different
                relations rather than as the same one drawn twice. */}
            {needsStartMarker && (
                <defs>
                    <marker
                        id={startMarkerId}
                        markerWidth={16}
                        markerHeight={16}
                        viewBox="0 0 20 20"
                        markerUnits="strokeWidth"
                        refX={2}
                        refY={10}
                        orient="auto-start-reverse"
                    >
                        <path d="M 18 3 L 2 10 L 18 17 z" fill={strokeColor} strokeLinejoin="round" />
                    </marker>
                </defs>
            )}
            {bpmnMarkerShape && (
                <defs>
                    <marker
                        id={ownMarkerId}
                        markerWidth={bpmnMarkerShape === 'hollow' ? 18 : 16}
                        markerHeight={bpmnMarkerShape === 'hollow' ? 18 : 16}
                        viewBox="0 0 20 20"
                        markerUnits="strokeWidth"
                        refX={bpmnMarkerShape === 'hollow' ? 18 : 16}
                        refY={10}
                        orient="auto-start-reverse"
                    >
                        <path
                            d="M 2 3 L 18 10 L 2 17 z"
                            fill={bpmnMarkerShape === 'hollow' ? 'none' : strokeColor}
                            stroke={strokeColor}
                            strokeWidth={bpmnMarkerShape === 'hollow' ? 1.5 : 1}
                            strokeLinejoin="round"
                        />
                    </marker>
                </defs>
            )}
            {/* Hover hit area - invisible wider path for easier selection */}
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                className="react-flow__edge-interaction"
            />
            <BaseEdge
                id={id}
                path={edgePath}
                style={{
                    stroke: strokeColor,
                    strokeWidth,
                    strokeDasharray: strokeDashArray,
                    transition: 'stroke-width 0.2s ease, stroke 0.2s ease, filter 0.2s ease',
                    filter,
                    opacity: edgeOpacity,
                    ...style,
                }}
                markerEnd={effectiveMarkerEnd}
                markerStart={effectiveMarkerStart}
                data-bpmn-flow={bpmnFlow ?? undefined}
            />
            {/* BPMN origin badge — message flows render a small open circle
                at the source end (per BPMN 2.0 spec), conditional flows
                render a diamond, default flows render a tick mark. The
                badge is purely decorative; the strokeDashArray + marker
                already make the type visually unambiguous, so this is a
                refinement, not a critical signal. */}
            {bpmnTokens?.originBadge && !isDimmed && (() => {
                const badgeProps = { stroke: strokeColor, fill: isDark ? '#0b0b0f' : '#ffffff' };
                if (bpmnTokens.originBadge === 'circle') {
                    return (
                        <circle
                            cx={sourceX}
                            cy={sourceY}
                            r={4}
                            fill={badgeProps.fill}
                            stroke={badgeProps.stroke}
                            strokeWidth={1.5}
                            aria-hidden
                        />
                    );
                }
                if (bpmnTokens.originBadge === 'diamond') {
                    const s = 6;
                    return (
                        <polygon
                            points={`${sourceX},${sourceY - s} ${sourceX + s},${sourceY} ${sourceX},${sourceY + s} ${sourceX - s},${sourceY}`}
                            fill={badgeProps.fill}
                            stroke={badgeProps.stroke}
                            strokeWidth={1.5}
                            aria-hidden
                        />
                    );
                }
                if (bpmnTokens.originBadge === 'tick') {
                    return (
                        <line
                            x1={sourceX - 6}
                            y1={sourceY + 6}
                            x2={sourceX + 6}
                            y2={sourceY - 6}
                            stroke={badgeProps.stroke}
                            strokeWidth={2}
                            aria-hidden
                        />
                    );
                }
                return null;
            })()}
            {/* Animated flow indicator for async / data-flow edges.
                We deliberately use a CSS-driven dash animation instead of
                SVG <animateMotion> + <circle>.  animateMotion silently
                breaks the entire SVG layer when the path string contains
                non-finite coordinates (a real possibility when ELK / dagre
                emit unexpected waypoints), and the failure mode is
                catastrophic: every node and edge disappears from the
                canvas with no console error.  CSS dash animation degrades
                gracefully and never blocks render. */}
            {animated && (
                <path
                    d={edgePath}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={baseStrokeWidth}
                    strokeDasharray="6 8"
                    className="animate-flow-dash"
                    style={{ opacity: isDimmed ? 0.15 : 0.6 }}
                />
            )}
            {/* Edge label — short visible text + full text via tooltip.
                Long labels (>56 chars) collapse to the first sentence /
                first "·" segment so the canvas stays legible; the inspector
                panel and the title attribute keep the full text available. */}
            {label && !isDimmed && (zoom >= LABEL_MIN_ZOOM || selected || isNarrativeFocus) && (() => {
                const fullLabel = (edgeData.fullLabel as string | undefined) ?? (typeof label === 'string' ? label : String(label));
                const shortLabel = shortenEdgeLabel(fullLabel);
                const wasShortened = shortLabel !== fullLabel;
                return (
                    <EdgeLabelRenderer>
                        <div
                            className="absolute pointer-events-auto nodrag nopan"
                            style={{
                                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            }}
                        >
                            <div
                                className={`
                                    flex items-center gap-1.5
                                    px-2.5 py-1 rounded-md
                                    shadow-sm
                                    max-w-[260px] text-center whitespace-normal
                                    transition-all duration-200
                                    ${selected ? 'scale-110 shadow-md' : ''}
                                    ${isNarrativeFocus ? 'ring-1 ring-cyan-400/70 dark:ring-cyan-300/70 scale-105' : ''}
                                `}
                                style={{
                                    backgroundColor: labelBg,
                                    color: labelColor,
                                    border: `1px solid ${labelBorderColor}`,
                                    fontSize: TYPOGRAPHY_TOKENS.scale.edge.size,
                                    fontWeight: TYPOGRAPHY_TOKENS.scale.edge.weight,
                                    lineHeight: `${TYPOGRAPHY_TOKENS.scale.edge.lineHeight}px`,
                                    backdropFilter: 'blur(6px) saturate(140%)',
                                    WebkitBackdropFilter: 'blur(6px) saturate(140%)',
                                }}
                                title={accessibleTooltip.length > 0 ? accessibleTooltip : (wasShortened ? fullLabel : undefined)}
                                role="group"
                                aria-label={accessibleTooltip.length > 0 ? accessibleTooltip : fullLabel}
                            >
                                {/* Colored type indicator dot */}
                                <span
                                    className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                                    style={{ backgroundColor: strokeColor, boxShadow: `0 0 6px ${strokeColor}88` }}
                                />
                                <span className="line-clamp-2">{shortLabel}</span>
                                {bpmnTokens && (
                                    <span
                                        className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider"
                                        style={{
                                            backgroundColor: `${strokeColor}22`,
                                            color: strokeColor,
                                        }}
                                                aria-label={`BPMN ${bpmnTokens.label}`}
                                    >
                                        {bpmnFlow === 'message-flow' ? 'MSG'
                                            : bpmnFlow === 'association' ? 'ASSOC'
                                                : bpmnFlow === 'conditional-flow' ? 'COND'
                                                    : bpmnFlow === 'default-flow' ? 'DEF'
                                                        : 'SEQ'}
                                    </span>
                                )}
                                {edgeData.protocol && (
                                    <span                                         className="ml-1 px-1 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                                        style={{
                                            backgroundColor: `${strokeColor}22`,
                                            color: strokeColor,
                                        }}
                                    >
                                        {edgeData.protocol}
                                    </span>
                                )}
                                {edgeData.criticality === 'critical' && (
                                    <span
                                        className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-600 dark:text-rose-300"
                                        title="Relación crítica"
                                    >
                                        Crítica
                                    </span>
                                )}
                                {visibleBadges.map((badge) => {
                                    const toneClass = badge.tone === 'sensitivity'
                                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                        : badge.tone === 'security'
                                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                            : badge.tone === 'retry'
                                                ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                                                : 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
                                    return (
                                        <span
                                            key={badge.key}
                                            className={`ml-1 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${toneClass}`}
                                            aria-label={badge.tooltip}
                                        >
                                            {badge.label}
                                        </span>
                                    );
                                })}
                                {hiddenBadgeCount > 0 && (
                                    <span
                                        className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-slate-500/15 text-slate-600 dark:text-slate-300"
                                        title={extraBadges.slice(2).map((b) => b.tooltip).join(' · ')}
                                        aria-label={`Otros ${hiddenBadgeCount}: ${extraBadges.slice(2).map((b) => b.tooltip).join(', ')}`}
                                    >
                                        +{hiddenBadgeCount}
                                    </span>
                                )}
                            </div>
                        </div>
                    </EdgeLabelRenderer>
                );
            })()}
        </>
    );
};

export default CustomEdge;
