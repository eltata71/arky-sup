/**
 * Diagram theme variants.
 *
 * A theme is an opinionated skin applied on top of the canonical semantic
 * tokens (`lib/diagramTokens.ts`).  It does not replace the semantic palette;
 * it overrides structural bits — canvas background, node border radius,
 * shadow elevation, edge stroke scale, whether to add noise/roughness.
 *
 * The goal is to let the same IR ship as:
 *   - `editorial`    → comité / PDF ejecutivo (default).
 *   - `whiteboard`   → workshops, braindumps, rough feel.
 *   - `monochrome`   → impresión / auditorías.
 *   - `high-contrast`→ WCAG AAA accesibilidad.
 */

import type { DiagramTheme } from './diagram';

export interface ThemeDefinition {
    id: DiagramTheme;
    label: string;
    description: string;
    node: {
        radius: number;
        strokeWidthScale: number;
        roughness: number; // 0 = crisp, 1+ = sketchy
        shadow: 'none' | 'subtle' | 'elevated';
        fontWeightTitle: 400 | 500 | 600 | 700;
    };
    edge: {
        strokeWidthScale: number;
        dashScale: number;
        labelPill: 'solid' | 'ghost' | 'outlined';
    };
    canvas: {
        backgroundVariant: 'editorial' | 'whiteboard' | 'monochrome' | 'high-contrast';
        useGradient: boolean;
    };
}

export const DIAGRAM_THEMES: Readonly<Record<DiagramTheme, ThemeDefinition>> = {
    editorial: {
        id: 'editorial',
        label: 'Editorial',
        description: 'Limpio, listo para comité ejecutivo o PDF.',
        node: { radius: 14, strokeWidthScale: 1.0, roughness: 0, shadow: 'subtle', fontWeightTitle: 600 },
        edge: { strokeWidthScale: 1.0, dashScale: 1.0, labelPill: 'solid' },
        canvas: { backgroundVariant: 'editorial', useGradient: false },
    },
    whiteboard: {
        id: 'whiteboard',
        label: 'Pizarra',
        description: 'Estilo workshop / braindump. Líneas rugosas.',
        node: { radius: 10, strokeWidthScale: 1.25, roughness: 1.2, shadow: 'none', fontWeightTitle: 500 },
        edge: { strokeWidthScale: 1.1, dashScale: 1.0, labelPill: 'ghost' },
        canvas: { backgroundVariant: 'whiteboard', useGradient: false },
    },
    monochrome: {
        id: 'monochrome',
        label: 'Monocromo',
        description: 'Greyscale — ideal para impresión.',
        node: { radius: 12, strokeWidthScale: 1.1, roughness: 0, shadow: 'none', fontWeightTitle: 600 },
        edge: { strokeWidthScale: 1.0, dashScale: 1.0, labelPill: 'outlined' },
        canvas: { backgroundVariant: 'monochrome', useGradient: false },
    },
    'high-contrast': {
        id: 'high-contrast',
        label: 'Alto contraste',
        description: 'Accesibilidad WCAG AAA. Bordes anchos.',
        node: { radius: 10, strokeWidthScale: 1.5, roughness: 0, shadow: 'none', fontWeightTitle: 700 },
        edge: { strokeWidthScale: 1.35, dashScale: 0.9, labelPill: 'solid' },
        canvas: { backgroundVariant: 'high-contrast', useGradient: false },
    },
};

export function getTheme(theme?: DiagramTheme): ThemeDefinition {
    return DIAGRAM_THEMES[theme ?? 'editorial'];
}

export const DEFAULT_THEME: DiagramTheme = 'editorial';
