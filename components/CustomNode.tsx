import React, { memo, useMemo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { getNodeIcon } from './NodeIcons';
import type { DiagramDensity, DiagramNodeData, NodeShape } from '../lib/diagram';
import { detectSemanticRole, ELEVATION_TOKENS, paletteFor, TYPOGRAPHY_TOKENS, type SemanticRole } from '../lib/diagramTokens';
import { detectTechBadge } from '../lib/diagramTechBadges';
import { detectC4Ribbon } from '../lib/diagramC4Levels';
import { evaluateNodeContrast } from '../lib/colorContrast';
import { detectBpmnElement, BPMN_PALETTE, type BpmnElement } from '../lib/diagramBpmn';

// --- Shape detection ---------------------------------------------------------
const detectShape = (data: DiagramNodeData): NodeShape => {
    if (data.shape) return data.shape;
    // Trust an upstream-resolved semantic role first — it captures the C4
    // syntax / insurance-domain dictionary that the legacy regex below cannot
    // match (e.g. "Asegurado", "Proveedor Médico", "Corredor").
    if (data.semanticRole === 'person') return 'person';
    if (data.semanticRole === 'data') return 'cylinder';
    if (data.semanticRole === 'external') return 'cloud';
    const t = (data.type || '').toLowerCase();
    if (/\b(database|db|sql|store|storage|redis|mongo|cache)\b/.test(t)) return 'cylinder';
    if (/\b(person|actor|user|cliente|customer|stakeholder)\b/.test(t)) return 'person';
    if (/\b(cloud|aws|azure|gcp|saas|external|third-party)\b/.test(t)) return 'cloud';
    if (/\b(microservice|lambda|function|serverless|faas)\b/.test(t)) return 'hexagon';
    if (/\b(gateway|router|load-balancer|decision|balancer)\b/.test(t)) return 'diamond';
    if (/\b(container|docker|kubernetes|k8s|namespace|pod)\b/.test(t)) return 'tab-box';
    return 'rectangle';
};

// --- Connection anchors --------------------------------------------------------
//
// Every node variant exposes the full 8-anchor contract (4 sides × source/
// target) with stable ids (`s-top`, `t-left`, …) so the geometric edge-anchor
// assigner (`services/diagram/edgeHandleAssignment`) can route each edge out
// of the side that faces its counterpart. Variants that only make sense with
// fewer visible connection dots (BPMN events, data objects…) render the
// remaining anchors invisibly — the ids must always exist or ReactFlow drops
// the edge.
const ANCHOR_SIDES: Array<{ side: 'top' | 'bottom' | 'left' | 'right'; pos: Position }> = [
    { side: 'top', pos: Position.Top },
    { side: 'bottom', pos: Position.Bottom },
    { side: 'left', pos: Position.Left },
    { side: 'right', pos: Position.Right },
];

const HIDDEN_ANCHOR_CLASS = '!w-1 !h-1 !min-w-0 !min-h-0 !border-0 !bg-transparent !pointer-events-none';

const AnchorHandles: React.FC<{
    isConnectable: boolean;
    /** Sides that render the visible connection dot; others stay invisible. */
    visibleSides?: Array<'top' | 'bottom' | 'left' | 'right'>;
    visibleClassName?: string;
    visibleStyle?: React.CSSProperties;
}> = ({ isConnectable, visibleSides, visibleClassName = '', visibleStyle }) => (
    <>
        {ANCHOR_SIDES.map(({ side, pos }) => {
            const visible = !visibleSides || visibleSides.includes(side);
            return (
                <React.Fragment key={side}>
                    <Handle
                        type="target"
                        id={`t-${side}`}
                        position={pos}
                        isConnectable={isConnectable && visible}
                        className={visible ? visibleClassName : HIDDEN_ANCHOR_CLASS}
                        style={visible ? visibleStyle : undefined}
                    />
                    <Handle
                        type="source"
                        id={`s-${side}`}
                        position={pos}
                        isConnectable={isConnectable && visible}
                        className={visible ? visibleClassName : HIDDEN_ANCHOR_CLASS}
                        style={visible ? visibleStyle : undefined}
                    />
                </React.Fragment>
            );
        })}
    </>
);

// --- Status indicator --------------------------------------------------------
const StatusDot: React.FC<{ status: 'active' | 'warning' | 'error' }> = ({ status }) => {
    const colours = { active: 'bg-emerald-400', warning: 'bg-amber-400', error: 'bg-rose-500' };
    return (
        <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colours[status]} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colours[status]}`} />
        </span>
    );
};

// --- Shape decorations -------------------------------------------------------
const CylinderDecoration: React.FC<{ stroke: string; bg: string }> = ({ stroke, bg }) => (
    <>
        <div
            className="absolute -top-2 left-0 right-0 h-4 rounded-[50%] z-10"
            style={{ border: `2px solid ${stroke}`, background: bg }}
        />
        <div
            className="absolute -bottom-2 left-0 right-0 h-4 rounded-[50%] opacity-60"
            style={{ border: `2px solid ${stroke}`, background: bg }}
        />
    </>
);

const PersonAvatar: React.FC<{ stroke: string; bg: string; accent: string }> = ({ stroke, bg, accent }) => (
    <div
        className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full border-2 flex items-center justify-center z-20"
        style={{ borderColor: stroke, background: bg, boxShadow: ELEVATION_TOKENS.light.card }}
    >
        <div style={{ color: accent }}>{getNodeIcon('person', 5)}</div>
    </div>
);

function isDarkMode(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/**
 * Build a subtle gradient mesh for the node background. Renders a radial
 * highlight on top of the palette colour so the node feels three-dimensional
 * without overwhelming the diagram.  Pure CSS — no motion library involved
 * so the node ALWAYS renders even if a third-party animation hook fails.
 */
function gradientFor(bg: string, accent: string, isDark: boolean): string {
    if (isDark) {
        return `radial-gradient(120% 90% at 0% 0%, ${accent}26 0%, ${bg} 65%), radial-gradient(80% 60% at 100% 100%, ${accent}1f 0%, transparent 70%)`;
    }
    return `radial-gradient(120% 90% at 0% 0%, ${accent}26 0%, ${bg} 60%), linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 70%)`;
}

// --- Main component ----------------------------------------------------------
const CustomNode: React.FC<NodeProps> = ({ data, isConnectable, selected }) => {
    const [isHovered, setIsHovered] = useState(false);
    // The runtime payload coming from `irToReactFlow.buildNode` carries a
    // superset of `DiagramNodeData`: every extended IR field
    // (owner, dataClassification, compliance, criticality, …) is propagated
    // verbatim so the inspector, tooltip and aria-label can consume them
    // without re-querying the IR. We type the surplus loosely with a known
    // shape to keep the field access type-safe but tolerant of legacy
    // payloads that did not yet carry these signals.
    const nodeData = (data ?? {}) as DiagramNodeData & {
        isDimmed?: boolean;
        isNarrativeFocus?: boolean;
        density?: DiagramDensity;
        owner?: string;
        domain?: string;
        dataClassification?: string;
        securityLevel?: string;
        compliance?: string[];
        criticality?: string;
        trust?: string;
        businessMeaning?: string;
        technicalMeaning?: string;
        hierarchyLevel?: 'focal' | 'primary' | 'secondary' | 'supporting' | 'external' | 'risk';
        hierarchyEmphasis?: 'high' | 'normal' | 'low';
        hideByDefault?: boolean;
        subtitle?: string;
        labelTooltip?: string;
        width?: number;
        height?: number;
    };
    const isDark = isDarkMode();
    // Gap 10: detect BPMN-specific intents from the node's kind / semanticType
    // / label so the renderer can paint circles for events, diamonds for
    // gateways and dedicated header glyphs for User / Service tasks.
    const bpmnElement: BpmnElement = detectBpmnElement({
        kind: (nodeData.kind ?? nodeData.type) as string | undefined,
        label: nodeData.label,
        semanticType: nodeData.semanticType as string | undefined,
        technology: nodeData.technology as string | undefined,
        description: nodeData.description,
    });
    const shape = detectShape(nodeData);
    // Prefer the IR-resolved role when the pipeline pre-computed it. This is
    // what guarantees `Person(...)` C4 nodes always paint as actors even when
    // the label alone would not match a keyword pattern.
    const role: SemanticRole = (nodeData.semanticRole as SemanticRole | undefined)
        ?? detectSemanticRole(nodeData.label ?? '', nodeData.kind ?? nodeData.type);
    const palette = nodeData.color ? null : paletteFor(role, isDark);

    // Pass every available semantic signal to the icon resolver so the
    // keyword matcher can still find the right glyph after we replaced the
    // raw `type` field with the human-readable category label. The icon
    // matcher only does `string.includes(keyword)`, so concatenating the
    // candidates is safe and inexpensive.
    const iconSignal = nodeData.icon
        ?? [nodeData.kind, nodeData.label, nodeData.technology, nodeData.type, nodeData.semanticType]
            .filter(Boolean)
            .join(' ');
    const icon = getNodeIcon(iconSignal, 5);
    const c4Ribbon = detectC4Ribbon(nodeData.kind ?? nodeData.type);
    const techBadge = detectTechBadge(
        nodeData.label,
        nodeData.technology ?? nodeData.type,
    );
    const stackHint =
        !techBadge && nodeData.technology && nodeData.technology.length > 0
            ? nodeData.technology.length > 28
                ? `${nodeData.technology.slice(0, 26)}…`
                : nodeData.technology
            : null;
    const isDimmed = Boolean(nodeData.isDimmed);
    const isNarrativeFocus = Boolean(nodeData.isNarrativeFocus);
    const density: DiagramDensity = nodeData.density ?? 'standard';
    const hierarchyLevel = nodeData.hierarchyLevel ?? 'primary';
    const hierarchyEmphasis = nodeData.hierarchyEmphasis ?? 'normal';
    const hiddenByAudience = Boolean(nodeData.hideByDefault);

    // Derive colours.  Custom colour overrides take precedence; otherwise the
    // canonical palette is used directly with hard-coded fallbacks so the
    // node ALWAYS has a visible background — even when palette resolution
    // fails for an unfamiliar role.
    const stroke = nodeData.color ?? palette?.stroke ?? (isDark ? '#94a3b8' : '#64748b');
    const fallbackBg = isDark ? '#1e293b' : '#f1f5f9';
    const bg = nodeData.color ? `${nodeData.color}22` : palette?.bg ?? fallbackBg;
    const headerBg = nodeData.color ? `${nodeData.color}33` : palette?.bg ?? (isDark ? '#0f172a' : '#f8fafc');
    const textColor = palette?.text ?? (isDark ? '#f1f5f9' : '#0f172a');
    const iconColor = nodeData.color ?? palette?.accent ?? stroke;

    const baseShadow = isDark ? ELEVATION_TOKENS.dark.card : ELEVATION_TOKENS.light.card;
    const hoverShadow = isDark ? ELEVATION_TOKENS.dark.hover : ELEVATION_TOKENS.light.hover;
    const focusShadow = isNarrativeFocus
        ? `${hoverShadow}, 0 0 0 3px ${iconColor}55, 0 0 24px ${iconColor}66`
        : null;
    const shadow = focusShadow ?? (isHovered ? hoverShadow : baseShadow);

    // Hierarchy ring (Gap 1 enhancement): the policy already classifies nodes
    // by `hierarchyLevel`, but the existing render only surfaces a small "Sec."
    // or "Riesgo" badge. A ring is more legible at a glance and survives the
    // executive zoom-out scenario. Selected state still wins so the user's
    // explicit click is never obscured.
    const hierarchyRing = selected
        ? ''
        : hierarchyLevel === 'risk'
            ? 'ring-2 ring-rose-400/70 dark:ring-rose-300/60'
            : hierarchyLevel === 'focal' && hierarchyEmphasis === 'high'
                ? 'ring-1 ring-primary-400/60 dark:ring-primary-300/50'
                : '';

    // Content-adaptive card width: the layout engine reserves a per-node box
    // (estimateNodeDims) and ships it through `data.width`; painting the card
    // at the same width keeps the dagre plan and the DOM in sync. Legacy
    // payloads without the hint keep the classic 256px card.
    const cardWidth = Number.isFinite(nodeData.width) && (nodeData.width as number) > 0
        ? Math.round(nodeData.width as number)
        : 256;

    const baseClasses = [
        'rounded-2xl animate-node-enter relative flex flex-col overflow-hidden transition-all duration-300 ease-out',
        selected ? 'ring-2 ring-primary-400 dark:ring-primary-500 ring-offset-2 dark:ring-offset-gray-900' : hierarchyRing,
        isDimmed || hiddenByAudience ? 'opacity-40 saturate-50' : hierarchyEmphasis === 'low' ? 'opacity-80' : 'opacity-100',
        isNarrativeFocus ? 'scale-[1.03]' : isHovered ? 'scale-[1.01]' : '',
        shape === 'diamond' ? 'min-h-[120px]' :
            shape === 'person' ? 'mt-5 min-h-[100px]' :
            shape === 'cylinder' ? 'my-3 min-h-[100px]' :
            density === 'compact' ? 'min-h-[64px]' :
            'min-h-[100px]',
    ].join(' ');

    const titleSize = density === 'compact'
        ? TYPOGRAPHY_TOKENS.scale.body.size
        : TYPOGRAPHY_TOKENS.scale.title.size;

    const showDescription = density !== 'compact' && !!nodeData.description;
    const gradient = gradientFor(bg, iconColor, isDark);

    // Display-safe label: never render an empty string (the "blank box" bug).
    const displayLabel = (nodeData.label ?? '').trim() || 'Componente';
    const semanticSubtitle = (nodeData.subtitle ?? nodeData.technology ?? nodeData.kind ?? '').toString().trim();

    // Gap 11: accessibility — every node MUST expose a semantic role, a
    // tabIndex so keyboard users can focus it, a complete aria-label that
    // summarises every visible signal (label, kind, technology, owner,
    // compliance, criticality), and a tooltip with the same payload for
    // mouse / touch users.
    const ariaParts: string[] = [displayLabel];
    const kindLabel = String(nodeData.category ?? nodeData.type ?? nodeData.kind ?? '').trim();
    if (kindLabel) ariaParts.push(`tipo ${kindLabel}`);
    if (nodeData.description) ariaParts.push(String(nodeData.description));
    if (nodeData.technology) ariaParts.push(`tecnología ${String(nodeData.technology)}`);
    if (nodeData.owner) ariaParts.push(`responsable ${String(nodeData.owner)}`);
    if (nodeData.dataClassification) ariaParts.push(`clasificación ${String(nodeData.dataClassification)}`);
    if (nodeData.criticality) ariaParts.push(`criticidad ${String(nodeData.criticality)}`);
    if (Array.isArray(nodeData.compliance) && nodeData.compliance.length > 0) {
        ariaParts.push(`compliance ${nodeData.compliance.join(', ')}`);
    }
    const ariaLabel = ariaParts.join('; ');
    // Only a *distinct* tooltip earns a `title`. Falling back to `ariaLabel`
    // made the attribute restate the accessible name, so VoiceOver announced
    // the node twice — see rule 1 in `lib/a11y.ts`.
    const tooltipTitle = (nodeData.labelTooltip as string | undefined) || undefined;

    // Gap 11: validate the user-picked custom colour against the text colour.
    // When it falls below WCAG AA, swap to the high-contrast fallback and
    // surface a discreet warning chip so the architect can fix it.
    const contrastReport = useMemo(() => {
        if (!nodeData.color) return null;
        return evaluateNodeContrast(bg, textColor);
    }, [nodeData.color, bg, textColor]);

    const safeTextColor = contrastReport?.needsWarning && contrastReport.suggestedTextColor
        ? contrastReport.suggestedTextColor
        : textColor;
    const showContrastWarning = !!(contrastReport && contrastReport.needsWarning);

    // Gap 10: BPMN-specialised render. Events use a circular shape with
    // a thick green / red ring, gateways use a diamond with a glyph
    // ("X" / "+" / "O"). Tasks reuse the standard rounded card with a
    // dedicated header glyph for User / Service tasks.
    if (bpmnElement && (bpmnElement === 'start-event' || bpmnElement === 'end-event' || bpmnElement === 'intermediate-event')) {
        const palette = BPMN_PALETTE[bpmnElement];
        const ring = bpmnElement === 'end-event' ? 6 : bpmnElement === 'intermediate-event' ? 3 : 4;
        return (
            <div
                className="relative w-32 h-32 rounded-full flex items-center justify-center text-center px-2 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                style={{ backgroundColor: palette.bg, border: `${ring}px solid ${palette.stroke}`, color: palette.accent, boxShadow: shadow }}
                role="group"
                tabIndex={0}
                aria-label={ariaLabel}
                title={tooltipTitle}
                data-bpmn-element={bpmnElement}
            >
                <AnchorHandles isConnectable={isConnectable} visibleSides={['left', 'right']} visibleClassName="!w-3 !h-3 !bg-white !border-2 z-30" visibleStyle={{ borderColor: palette.stroke }} />
                <span className="text-xs font-bold leading-tight break-words">{displayLabel}
                        {semanticSubtitle ? <span className="block text-[10px] opacity-70 truncate">{semanticSubtitle}</span> : null}</span>
                <span className="absolute -bottom-5 left-0 right-0 text-[10px] font-semibold uppercase tracking-wider opacity-70" style={{ color: palette.stroke }}>{palette.label}</span>
            </div>
        );
    }
    if (bpmnElement && (bpmnElement === 'gateway-exclusive' || bpmnElement === 'gateway-parallel' || bpmnElement === 'gateway-inclusive' || bpmnElement === 'gateway-event-based')) {
        const palette = BPMN_PALETTE[bpmnElement];
        const glyph = bpmnElement === 'gateway-exclusive' ? '✕'
            : bpmnElement === 'gateway-parallel' ? '+'
                : bpmnElement === 'gateway-event-based' ? '⬠'
                    : '○';
        return (
            <div
                className="relative w-32 h-32 flex items-center justify-center text-center transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                role="group"
                tabIndex={0}
                aria-label={ariaLabel}
                title={tooltipTitle}
                data-bpmn-element={bpmnElement}
                style={{ boxShadow: shadow }}
            >
                <AnchorHandles isConnectable={isConnectable} visibleSides={['left', 'right']} visibleClassName="!w-3 !h-3 !bg-white !border-2 z-30" visibleStyle={{ borderColor: palette.stroke }} />
                <div
                    className="absolute inset-2 rotate-45 rounded-md"
                    style={{ backgroundColor: palette.bg, border: `3px solid ${palette.stroke}` }}
                    aria-hidden
                />
                <span className="relative z-10 text-3xl font-bold" style={{ color: palette.accent }}>{glyph}</span>
                <span className="absolute -bottom-5 left-0 right-0 text-[10px] font-semibold uppercase tracking-wider opacity-80" style={{ color: palette.stroke }}>{palette.label}</span>
                <span className="absolute -top-5 left-0 right-0 text-[10px] font-medium opacity-90 truncate" style={{ color: palette.accent }}>{displayLabel}</span>
            </div>
        );
    }

    // Data Object — rendered as a small page with a folded corner. Connects
    // via `association` edges in BPMN; the node stays narrow so it does
    // not dominate the canvas next to tasks.
    if (bpmnElement === 'data-object') {
        const palette = BPMN_PALETTE[bpmnElement];
        return (
            <div
                className="relative w-24 h-28 flex items-end justify-center text-center px-1 pb-2 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                style={{ boxShadow: shadow }}
                role="group"
                tabIndex={0}
                aria-label={ariaLabel}
                title={tooltipTitle}
                data-bpmn-element={bpmnElement}
            >
                <AnchorHandles isConnectable={isConnectable} visibleSides={['top', 'bottom']} visibleClassName="!w-2.5 !h-2.5 !bg-white !border-2 z-30" visibleStyle={{ borderColor: palette.stroke }} />
                <svg viewBox="0 0 64 80" className="absolute inset-0 w-full h-full" aria-hidden>
                    <path d="M 4 4 L 48 4 L 60 16 L 60 76 L 4 76 Z" fill={palette.bg} stroke={palette.stroke} strokeWidth={2} />
                    <path d="M 48 4 L 48 16 L 60 16" fill="none" stroke={palette.stroke} strokeWidth={2} />
                </svg>
                <span className="relative z-10 text-[10px] font-semibold leading-tight break-words" style={{ color: palette.accent }}>{displayLabel}</span>
                <span className="absolute -bottom-4 left-0 right-0 text-[9px] font-semibold uppercase tracking-wider opacity-80" style={{ color: palette.stroke }}>{palette.label}</span>
            </div>
        );
    }

    // Data Store — short cylinder with stacked rings. Same connection
    // posture as a Data Object but visually wider and richer.
    if (bpmnElement === 'data-store') {
        const palette = BPMN_PALETTE[bpmnElement];
        return (
            <div
                className="relative w-28 h-24 flex items-center justify-center text-center px-1 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                style={{ boxShadow: shadow }}
                role="group"
                tabIndex={0}
                aria-label={ariaLabel}
                title={tooltipTitle}
                data-bpmn-element={bpmnElement}
            >
                <AnchorHandles isConnectable={isConnectable} visibleSides={['top', 'bottom']} visibleClassName="!w-2.5 !h-2.5 !bg-white !border-2 z-30" visibleStyle={{ borderColor: palette.stroke }} />
                <svg viewBox="0 0 80 70" className="absolute inset-0 w-full h-full" aria-hidden>
                    <ellipse cx={40} cy={10} rx={32} ry={6} fill={palette.bg} stroke={palette.stroke} strokeWidth={2} />
                    <path d={`M 8 10 L 8 60 Q 8 66 40 66 Q 72 66 72 60 L 72 10`} fill={palette.bg} stroke={palette.stroke} strokeWidth={2} />
                    <ellipse cx={40} cy={10} rx={32} ry={6} fill="none" stroke={palette.stroke} strokeWidth={1.2} opacity={0.6} />
                    <ellipse cx={40} cy={22} rx={32} ry={6} fill="none" stroke={palette.stroke} strokeWidth={1} opacity={0.4} />
                </svg>
                <span className="relative z-10 text-[11px] font-semibold leading-tight break-words mt-3" style={{ color: palette.accent }}>{displayLabel}</span>
                <span className="absolute -bottom-4 left-0 right-0 text-[9px] font-semibold uppercase tracking-wider opacity-80" style={{ color: palette.stroke }}>{palette.label}</span>
            </div>
        );
    }

    // Annotation — bracketed note that does NOT carry sequence handles by
    // BPMN convention. It connects to other shapes through `association`
    // edges only.
    if (bpmnElement === 'annotation') {
        const palette = BPMN_PALETTE[bpmnElement];
        return (
            <div
                className="relative w-48 min-h-[64px] flex items-center px-3 py-2 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                style={{ boxShadow: shadow, backgroundColor: palette.bg, borderLeft: `3px solid ${palette.stroke}`, borderTop: `1px solid ${palette.stroke}`, borderBottom: `1px solid ${palette.stroke}` }}
                role="note"
                tabIndex={0}
                aria-label={ariaLabel}
                title={tooltipTitle}
                data-bpmn-element={bpmnElement}
            >
                <AnchorHandles isConnectable={isConnectable} visibleSides={['left']} visibleClassName="!w-2 !h-2 !bg-white !border-2 z-30" visibleStyle={{ borderColor: palette.stroke }} />
                <span className="text-[11px] italic leading-snug" style={{ color: palette.accent }}>{displayLabel}</span>
            </div>
        );
    }

    // Specialised BPMN task type chip — surfaces user / service / manual /
    // business-rule task with a dedicated glyph in the top-left corner of
    // the default task card. We render it as an overlay so it never
    // displaces the existing header layout.
    const bpmnTaskInfo: { glyph: string; label: string; tone: { bg: string; text: string } } | null = (() => {
        if (!bpmnElement) return null;
        if (bpmnElement === 'user-task') return { glyph: '👤', label: 'Tarea de usuario', tone: { bg: BPMN_PALETTE['user-task'].bg, text: BPMN_PALETTE['user-task'].accent } };
        if (bpmnElement === 'service-task') return { glyph: '⚙', label: 'Tarea de servicio', tone: { bg: BPMN_PALETTE['service-task'].bg, text: BPMN_PALETTE['service-task'].accent } };
        if (bpmnElement === 'manual-task') return { glyph: '✋', label: 'Tarea manual', tone: { bg: BPMN_PALETTE['manual-task'].bg, text: BPMN_PALETTE['manual-task'].accent } };
        if (bpmnElement === 'business-rule-task') return { glyph: '📋', label: 'Regla de negocio', tone: { bg: BPMN_PALETTE['business-rule-task'].bg, text: BPMN_PALETTE['business-rule-task'].accent } };
        return null;
    })();

    return (
        <div
            className={`${baseClasses} focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900`}
            style={{
                width: cardWidth,
                background: gradient,
                backgroundColor: bg,
                border: `2px solid ${stroke}`,
                boxShadow: shadow,
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            role="group"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-selected={selected ? true : undefined}
            title={tooltipTitle}
            data-bpmn-element={bpmnElement ?? undefined}
        >
            {bpmnTaskInfo && (
                <span
                    className="absolute -top-2.5 -left-2.5 z-30 inline-flex items-center justify-center w-7 h-7 rounded-full text-sm shadow-sm border-2"
                    style={{ backgroundColor: bpmnTaskInfo.tone.bg, color: bpmnTaskInfo.tone.text, borderColor: bpmnTaskInfo.tone.text }}
                    aria-label={bpmnTaskInfo.label}
                    data-bpmn-task-kind={bpmnElement}
                >
                    {bpmnTaskInfo.glyph}
                </span>
            )}
            {/* Glassmorphism sheen — visible only on hover */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
                style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 45%, transparent 65%, rgba(255,255,255,0.06) 100%)',
                    opacity: isHovered ? 1 : 0,
                    mixBlendMode: isDark ? 'soft-light' : 'overlay',
                }}
            />

            {/* Connection anchors (8 ids: 4 sides x source/target) */}
            <AnchorHandles
                isConnectable={isConnectable}
                visibleClassName={`!w-3 !h-3 !border-2 !border-white dark:!border-gray-800 z-30 transition-colors ${isHovered ? '!bg-primary-500' : '!bg-gray-400 dark:!bg-gray-500'}`}
            />

            {/* Shape decorations */}
            {shape === 'cylinder' && <CylinderDecoration stroke={stroke} bg={bg} />}
            {shape === 'person' && palette && <PersonAvatar stroke={stroke} bg={bg} accent={iconColor} />}
            {shape === 'hexagon' && (
                <div
                    className="absolute top-0 left-0 w-1.5 h-full rounded-l-2xl"
                    style={{ backgroundColor: iconColor }}
                />
            )}
            {shape === 'tab-box' && (
                <div
                    className="absolute -top-3 left-3 px-3 py-0.5 rounded-t-lg text-[9px] font-bold uppercase tracking-widest border-2 border-b-0 z-20"
                    style={{ borderColor: stroke, backgroundColor: headerBg, color: iconColor }}
                >
                    {nodeData.type?.split(/[\s-]+/).slice(0, 2).join(' ') || 'Container'}
                </div>
            )}

            {/* C4 kind ribbon */}
            {c4Ribbon && shape !== 'tab-box' && (
                <div
                    className={`absolute -top-2.5 left-4 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-[0.14em] shadow-sm z-20 ${c4Ribbon.bg} ${c4Ribbon.darkBg} ${c4Ribbon.text} ${c4Ribbon.darkText}`}
                >
                    {c4Ribbon.label}
                </div>
            )}

            {/* Header */}
            <div
                className="relative flex items-center gap-2.5 px-3 py-2.5 rounded-t-[14px] border-b border-black/5 dark:border-white/5 z-10"
                style={{ backgroundColor: headerBg }}
            >
                <div
                    className="flex-shrink-0 p-1.5 rounded-lg"
                    style={{ color: iconColor, backgroundColor: `${iconColor}1f` }}
                >
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div
                        className="leading-tight break-words"
                        style={{ color: safeTextColor, fontSize: titleSize, fontWeight: 600 }}
                    >
                        {displayLabel}
                    </div>
                    {density !== 'compact' && (nodeData.category ?? nodeData.type) && !c4Ribbon && (
                        <div
                            className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider"
                            style={{ backgroundColor: `${stroke}33`, color: stroke }}
                            // Full kind exposed via the title attribute so the user can hover to see
                            // the original C4 / IR kind even when we badge with the friendly category.
                            title={nodeData.kind && nodeData.kind !== (nodeData.category ?? nodeData.type) ? nodeData.kind : undefined}
                        >
                            {nodeData.category ?? nodeData.type}
                        </div>
                    )}
                    {density !== 'compact' && techBadge && (
                        <div
                            className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wide shadow-sm border border-black/10"
                            style={{ backgroundColor: techBadge.bg, color: techBadge.text }}
                        >
                            {techBadge.label}
                        </div>
                    )}
                    {density !== 'compact' && !techBadge && stackHint && (
                        <div
                            className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold tracking-wide border"
                            style={{
                                backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.06)',
                                color: textColor,
                                borderColor: isDark ? 'rgba(148,163,184,0.35)' : 'rgba(15,23,42,0.12)',
                                opacity: 0.9,
                            }}
                            title={nodeData.technology}
                        >
                            {stackHint}
                        </div>
                    )}
                </div>
                <div className="flex flex-col items-end gap-1">
                    {hierarchyLevel === 'risk' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            Riesgo
                        </span>
                    )}
                    {hierarchyEmphasis === 'low' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300">
                            Sec.
                        </span>
                    )}
                    {nodeData.status && <StatusDot status={nodeData.status} />}
                    {nodeData.badge && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                            {nodeData.badge}
                        </span>
                    )}
                </div>
            </div>

            {/* Body */}
            {showDescription && (
                <div className="relative px-3 py-2 flex-1 z-10">
                    <p
                        className="leading-relaxed break-words line-clamp-3"
                        style={{
                            color: safeTextColor,
                            fontSize: TYPOGRAPHY_TOKENS.scale.body.size,
                            opacity: 0.85,
                        }}
                    >
                        {nodeData.description}
                    </p>
                </div>
            )}

            {showContrastWarning && (
                <div
                    className="absolute -bottom-2 left-3 z-30 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-400 dark:bg-amber-900/70 dark:text-amber-100 dark:border-amber-700 shadow-sm"
                    role="status"
                    aria-label="Contraste insuficiente para WCAG AA en el color personalizado del nodo"
                    title={`Color personalizado por debajo de WCAG AA (ratio ${contrastReport?.verdict?.ratio.toFixed(2) ?? '?'}). Se aplicó un texto seguro automáticamente.`}
                >
                    <span aria-hidden>!</span>
                    <span>Bajo contraste</span>
                </div>
            )}

            {/* Opt-in: role chip when no explicit type */}
            {!c4Ribbon && role !== 'generic' && !nodeData.type && (
                <div
                    className="absolute bottom-1 right-2 text-[9px] font-semibold uppercase tracking-wider opacity-70 z-10"
                    style={{ color: iconColor }}
                >
                    {role}
                </div>
            )}
        </div>
    );
};

export default memo(CustomNode);
