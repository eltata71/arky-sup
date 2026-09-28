/**
 * «Elevación sutil» como regla medible, no como valores copiados (ADR-007).
 *
 * Una prueba que fijara las cadenas exactas sólo diría que nadie las tocó; ésta
 * dice qué significa la decisión, así que un ajuste dentro de ella pasa y uno
 * que la contradiga —un halo, una sombra de tarjeta flotante— falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_SNAP_GRID, ELEVATION_TOKENS, focusElevation } from '../../lib/diagramTokens';

interface Layer { x: number; y: number; blur: number; spread: number; alpha: number }

/** `0 4px 12px rgba(…,0.08), 0 1px 3px rgba(…)` → capas. */
const layers = (shadow: string): Layer[] =>
  shadow.split(/,(?![^(]*\))/).map((part) => {
    const lengths = [...part.matchAll(/(-?\d+(?:\.\d+)?)(?:px)?(?=\s|$|\s*rgba|\s*#)/g)].map((m) => Number(m[1]));
    const alpha = part.match(/rgba\([^)]*,\s*([\d.]+)\)/);
    return {
      x: lengths[0] ?? 0,
      y: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      alpha: alpha ? Number(alpha[1]) : 1,
    };
  });

const MAX_BLUR = 12;
const MAX_OFFSET = 4;
const MAX_ALPHA = { light: 0.08, dark: 0.4 } as const;

describe('elevación sutil (ADR-007)', () => {
  it.each(['light', 'dark'] as const)('reposo y realce en tema %s: difuminado, desplazamiento y opacidad contenidos', (theme) => {
    for (const state of ['card', 'hover'] as const) {
      for (const layer of layers(ELEVATION_TOKENS[theme][state])) {
        expect(layer.blur, `${theme}.${state}`).toBeLessThanOrEqual(MAX_BLUR);
        expect(Math.abs(layer.y), `${theme}.${state}`).toBeLessThanOrEqual(MAX_OFFSET);
        expect(layer.alpha, `${theme}.${state}`).toBeLessThanOrEqual(MAX_ALPHA[theme]);
      }
    }
  });

  it('el reposo es más discreto que el realce', () => {
    for (const theme of ['light', 'dark'] as const) {
      const card = Math.max(...layers(ELEVATION_TOKENS[theme].card).map((l) => l.blur));
      const hover = Math.max(...layers(ELEVATION_TOKENS[theme].hover).map((l) => l.blur));
      expect(card).toBeLessThan(hover);
    }
  });

  it('el foco narrativo es un anillo, no un halo', () => {
    const focus = focusElevation(ELEVATION_TOKENS.light.hover, '#1d4ed8');
    expect(focus).toContain('0 0 0 3px #1d4ed855');
    for (const layer of layers(focus)) expect(layer.blur).toBeLessThanOrEqual(MAX_BLUR);
  });

  it('ningún nodo compone una sombra a mano: todas salen de los tokens', () => {
    const code = fs.readFileSync(path.join(process.cwd(), 'components/CustomNode.tsx'), 'utf-8');
    expect(code).not.toMatch(/\b0 0 \d+px\b/);
  });

  it('el arrastre manual se ajusta a una rejilla de 8 px', () => {
    expect(DIAGRAM_SNAP_GRID).toEqual([8, 8]);
    const canvas = fs.readFileSync(path.join(process.cwd(), 'components/ReactFlowCanvas.tsx'), 'utf-8');
    expect(canvas).toMatch(/snapToGrid\s+snapGrid=\{DIAGRAM_SNAP_GRID\}/);
  });
});
