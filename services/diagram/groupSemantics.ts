import type { DiagramIRGroup } from '../../lib/diagram';

export type GroupSemanticKind = NonNullable<DiagramIRGroup['kind']>;

export interface GroupSemanticColor {
  light: string;
  dark: string;
  border: string;
}

export interface GroupSemanticStyle {
  color: GroupSemanticColor;
  borderStyle: 'solid' | 'dashed';
  borderWidth: number;
  labelTransform: 'uppercase' | 'none';
  zIndex: number;
  padX: number;
  padTop: number;
  padBottom: number;
  semanticRole: 'lane' | 'boundary' | 'zone' | 'cluster';
}

const FALLBACK_COLORS: GroupSemanticColor[] = [
  { light: 'rgba(99,102,241,0.05)', dark: 'rgba(99,102,241,0.08)', border: '#818cf8' },
  { light: 'rgba(16,185,129,0.05)', dark: 'rgba(16,185,129,0.08)', border: '#34d399' },
  { light: 'rgba(245,158,11,0.05)', dark: 'rgba(245,158,11,0.08)', border: '#fbbf24' },
  { light: 'rgba(6,182,212,0.05)', dark: 'rgba(6,182,212,0.08)', border: '#22d3ee' },
  { light: 'rgba(139,92,246,0.05)', dark: 'rgba(139,92,246,0.08)', border: '#a78bfa' },
  { light: 'rgba(239,68,68,0.05)', dark: 'rgba(239,68,68,0.08)', border: '#f87171' },
];

const BY_KIND: Record<GroupSemanticKind, GroupSemanticStyle> = {
  'swimlane': { color: { light: 'rgba(99,102,241,0.05)', dark: 'rgba(99,102,241,0.10)', border: '#818cf8' }, borderStyle: 'solid', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 36, padTop: 48, padBottom: 32, semanticRole: 'lane' },
  'system-boundary': { color: { light: 'rgba(99,102,241,0.04)', dark: 'rgba(99,102,241,0.08)', border: '#a5b4fc' }, borderStyle: 'dashed', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -2, padX: 32, padTop: 44, padBottom: 30, semanticRole: 'boundary' },
  'enterprise': { color: { light: 'rgba(168,85,247,0.04)', dark: 'rgba(168,85,247,0.08)', border: '#c084fc' }, borderStyle: 'dashed', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -3, padX: 36, padTop: 46, padBottom: 30, semanticRole: 'boundary' },
  'security': { color: { light: 'rgba(244,63,94,0.06)', dark: 'rgba(244,63,94,0.10)', border: '#fb7185' }, borderStyle: 'dashed', borderWidth: 1.8, labelTransform: 'uppercase', zIndex: -1, padX: 40, padTop: 48, padBottom: 34, semanticRole: 'boundary' },
  'external-provider': { color: { light: 'rgba(14,165,233,0.05)', dark: 'rgba(14,165,233,0.10)', border: '#38bdf8' }, borderStyle: 'solid', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 34, padTop: 44, padBottom: 30, semanticRole: 'zone' },
  'data': { color: { light: 'rgba(16,185,129,0.05)', dark: 'rgba(16,185,129,0.10)', border: '#34d399' }, borderStyle: 'solid', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 34, padTop: 44, padBottom: 30, semanticRole: 'zone' },
  'cloud': { color: { light: 'rgba(56,189,248,0.05)', dark: 'rgba(56,189,248,0.10)', border: '#7dd3fc' }, borderStyle: 'solid', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 34, padTop: 44, padBottom: 30, semanticRole: 'zone' },
  'legacy': { color: { light: 'rgba(239,68,68,0.05)', dark: 'rgba(239,68,68,0.10)', border: '#f87171' }, borderStyle: 'dashed', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 34, padTop: 44, padBottom: 30, semanticRole: 'zone' },
  'integration': { color: { light: 'rgba(139,92,246,0.05)', dark: 'rgba(139,92,246,0.10)', border: '#a78bfa' }, borderStyle: 'solid', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 36, padTop: 46, padBottom: 30, semanticRole: 'lane' },
  'cluster': { color: { light: 'rgba(99,102,241,0.04)', dark: 'rgba(99,102,241,0.08)', border: '#818cf8' }, borderStyle: 'solid', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -2, padX: 32, padTop: 42, padBottom: 28, semanticRole: 'cluster' },
};

export function resolveGroupSemanticStyle(kind: DiagramIRGroup['kind'] | undefined, fallbackIndex = 0): GroupSemanticStyle {
  if (kind && BY_KIND[kind]) return BY_KIND[kind];
  const color = FALLBACK_COLORS[Math.abs(fallbackIndex) % FALLBACK_COLORS.length];
  return { color, borderStyle: 'dashed', borderWidth: 1.5, labelTransform: 'uppercase', zIndex: -1, padX: 32, padTop: 44, padBottom: 30, semanticRole: 'zone' };
}
