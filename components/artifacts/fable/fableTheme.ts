/**
 * Design tokens for the "Vista Fable" diagram renderer.
 *
 * The visual language was authored with Anthropic's design-generation
 * capability (Claude Fable) and is intentionally richer than the canonical
 * `lib/diagramTokens` palette: per-role gradients, glow shadows and two
 * curated canvas atmospheres ("aurora" dark / "gallery" light).
 *
 * It still derives every node's role through the canonical
 * `detectSemanticRole` resolver so the Fable view, the ReactFlow canvas and
 * the AI prompts always agree on a node's semantics.
 */
import { detectSemanticRole, type SemanticRole } from '../../../lib/diagramTokens';
import type { DiagramIRGroup, DiagramIRNode } from '../../../lib/diagram';

export type FableThemeName = 'aurora' | 'gallery';

export interface FableRoleStyle {
    /** Gradient start / end for the node card fill. */
    from: string;
    to: string;
    /** Solid accent used by edges, legend dots and chips. */
    accent: string;
    /** Soft glow colour painted behind the card. */
    glow: string;
    /** Title / supporting text colours over the gradient. */
    text: string;
    subtext: string;
    /** Human label for the legend (Spanish, matches the product locale). */
    label: string;
}

export interface FableCanvasStyle {
    /** Page background + the two radial atmosphere glows. */
    bg: string;
    glowA: string;
    glowB: string;
    /** Dotted grid colour. */
    grid: string;
    /** Default card border + edge label pill. */
    cardStroke: string;
    labelBg: string;
    labelText: string;
    /** Floating panels (header, legend, detail card). */
    panelBg: string;
    panelBorder: string;
    panelText: string;
    panelSubtext: string;
    /** Group boundary fill/stroke base (tinted per kind). */
    groupFill: string;
    groupStroke: string;
    groupLabel: string;
    /** Neutral edge colour when both endpoints share a role. */
    edgeNeutral: string;
}

const AURORA_ROLES: Record<SemanticRole, FableRoleStyle> = {
    person:    { from: '#1d4ed8', to: '#0ea5e9', accent: '#38bdf8', glow: 'rgba(56,189,248,0.35)',  text: '#f0f9ff', subtext: '#bae6fd', label: 'Personas' },
    system:    { from: '#4338ca', to: '#7c3aed', accent: '#818cf8', glow: 'rgba(129,140,248,0.35)', text: '#eef2ff', subtext: '#c7d2fe', label: 'Sistemas' },
    gateway:   { from: '#7c3aed', to: '#c026d3', accent: '#c084fc', glow: 'rgba(192,132,252,0.35)', text: '#faf5ff', subtext: '#e9d5ff', label: 'Gateways' },
    data:      { from: '#047857', to: '#0d9488', accent: '#34d399', glow: 'rgba(52,211,153,0.35)',  text: '#ecfdf5', subtext: '#a7f3d0', label: 'Datos' },
    messaging: { from: '#b45309', to: '#d97706', accent: '#fbbf24', glow: 'rgba(251,191,36,0.35)',  text: '#fffbeb', subtext: '#fde68a', label: 'Mensajería' },
    external:  { from: '#0369a1', to: '#0891b2', accent: '#22d3ee', glow: 'rgba(34,211,238,0.32)',  text: '#ecfeff', subtext: '#a5f3fc', label: 'Externos' },
    service:   { from: '#3730a3', to: '#4f46e5', accent: '#a5b4fc', glow: 'rgba(165,180,252,0.32)', text: '#eef2ff', subtext: '#c7d2fe', label: 'Servicios' },
    process:   { from: '#9d174d', to: '#db2777', accent: '#f472b6', glow: 'rgba(244,114,182,0.34)', text: '#fdf2f8', subtext: '#fbcfe8', label: 'Procesos' },
    generic:   { from: '#334155', to: '#475569', accent: '#94a3b8', glow: 'rgba(148,163,184,0.28)', text: '#f8fafc', subtext: '#cbd5e1', label: 'Otros' },
};

const GALLERY_ROLES: Record<SemanticRole, FableRoleStyle> = {
    person:    { from: '#dbeafe', to: '#e0f2fe', accent: '#2563eb', glow: 'rgba(37,99,235,0.16)',   text: '#1e3a8a', subtext: '#1d4ed8', label: 'Personas' },
    system:    { from: '#e0e7ff', to: '#ede9fe', accent: '#4f46e5', glow: 'rgba(79,70,229,0.16)',   text: '#1e1b4b', subtext: '#4338ca', label: 'Sistemas' },
    gateway:   { from: '#ede9fe', to: '#fae8ff', accent: '#7c3aed', glow: 'rgba(124,58,237,0.16)',  text: '#4c1d95', subtext: '#6d28d9', label: 'Gateways' },
    data:      { from: '#d1fae5', to: '#ccfbf1', accent: '#059669', glow: 'rgba(5,150,105,0.16)',   text: '#064e3b', subtext: '#047857', label: 'Datos' },
    messaging: { from: '#fef3c7', to: '#fef9c3', accent: '#d97706', glow: 'rgba(217,119,6,0.16)',   text: '#713f12', subtext: '#b45309', label: 'Mensajería' },
    external:  { from: '#e0f2fe', to: '#cffafe', accent: '#0284c7', glow: 'rgba(2,132,199,0.16)',   text: '#0c4a6e', subtext: '#0369a1', label: 'Externos' },
    service:   { from: '#eef2ff', to: '#e0e7ff', accent: '#4f46e5', glow: 'rgba(79,70,229,0.14)',   text: '#312e81', subtext: '#4338ca', label: 'Servicios' },
    process:   { from: '#fce7f3', to: '#ffe4e6', accent: '#db2777', glow: 'rgba(219,39,119,0.16)',  text: '#831843', subtext: '#be185d', label: 'Procesos' },
    generic:   { from: '#f1f5f9', to: '#e2e8f0', accent: '#64748b', glow: 'rgba(100,116,139,0.14)', text: '#334155', subtext: '#475569', label: 'Otros' },
};

const AURORA_CANVAS: FableCanvasStyle = {
    bg: '#070b16',
    glowA: 'rgba(79,70,229,0.16)',
    glowB: 'rgba(14,165,233,0.10)',
    grid: 'rgba(148,163,184,0.10)',
    cardStroke: 'rgba(148,163,184,0.28)',
    labelBg: 'rgba(15,23,42,0.88)',
    labelText: '#e2e8f0',
    panelBg: 'rgba(10,15,30,0.86)',
    panelBorder: 'rgba(148,163,184,0.22)',
    panelText: '#f1f5f9',
    panelSubtext: '#94a3b8',
    groupFill: 'rgba(99,102,241,0.05)',
    groupStroke: 'rgba(129,140,248,0.30)',
    groupLabel: '#a5b4fc',
    edgeNeutral: 'rgba(148,163,184,0.65)',
};

const GALLERY_CANVAS: FableCanvasStyle = {
    bg: '#f8f7f4',
    glowA: 'rgba(99,102,241,0.08)',
    glowB: 'rgba(14,165,233,0.06)',
    grid: 'rgba(100,116,139,0.14)',
    cardStroke: 'rgba(100,116,139,0.30)',
    labelBg: 'rgba(255,255,255,0.92)',
    labelText: '#334155',
    panelBg: 'rgba(255,255,255,0.90)',
    panelBorder: 'rgba(100,116,139,0.24)',
    panelText: '#0f172a',
    panelSubtext: '#64748b',
    groupFill: 'rgba(99,102,241,0.04)',
    groupStroke: 'rgba(99,102,241,0.32)',
    groupLabel: '#4f46e5',
    edgeNeutral: 'rgba(71,85,105,0.55)',
};

export const FABLE_THEMES: Record<FableThemeName, { roles: Record<SemanticRole, FableRoleStyle>; canvas: FableCanvasStyle }> = {
    aurora: { roles: AURORA_ROLES, canvas: AURORA_CANVAS },
    gallery: { roles: GALLERY_ROLES, canvas: GALLERY_CANVAS },
};

/**
 * Minimal 24×24 glyphs per semantic role, drawn with `currentColor` strokes
 * so they inherit the card's text colour. Kept as raw path data to avoid
 * pulling the HTML-oriented `NodeIcons` into an SVG subtree.
 */
export const FABLE_ROLE_GLYPHS: Record<SemanticRole, string> = {
    person:    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
    system:    'M4 5h16v6H4zM4 14h7v5H4zM13 14h7v5h-7z',
    gateway:   'M12 3l9 9-9 9-9-9 9-9Zm0 5v8m-4-4h8',
    data:      'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3V6Zm0 0c0 1.7 3.1 3 7 3s7-1.3 7-3M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
    messaging: 'M3 8l9 6 9-6M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    external:  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9Z',
    service:   'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3Zm0 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
    process:   'M5 8h11l-2.5-2.5M19 16H8l2.5 2.5M5 8v8m14-8v8',
    generic:   'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
};

const GROUP_KIND_LABELS: Record<NonNullable<DiagramIRGroup['kind']> | 'default', string> = {
    swimlane: 'Carril',
    'system-boundary': 'Frontera del sistema',
    enterprise: 'Empresa',
    security: 'Zona de seguridad',
    'external-provider': 'Proveedor externo',
    data: 'Zona de datos',
    cloud: 'Nube',
    legacy: 'Legado',
    integration: 'Integración',
    cluster: 'Clúster',
    default: 'Dominio',
};

export const fableGroupKindLabel = (kind?: DiagramIRGroup['kind']): string =>
    GROUP_KIND_LABELS[kind ?? 'default'];

/** Resolves a node's role with the canonical resolver (semanticRole wins). */
export const fableRoleFor = (node: DiagramIRNode): SemanticRole =>
    (node.semanticRole as SemanticRole | undefined) ?? detectSemanticRole(node.label, node.kind);

/** Edge relations that animate a flowing dash in the Fable view. */
export const FABLE_ANIMATED_SEMANTICS = new Set([
    'event',
    'async-messaging',
    'publish',
    'subscribe',
    'data-flow',
    'data-transfer',
    'notification',
    'synchronization',
]);

export const FABLE_CRITICALITY_COLORS: Record<string, string> = {
    critical: '#f87171',
    high: '#fb923c',
    medium: '#fbbf24',
    low: '#94a3b8',
};
