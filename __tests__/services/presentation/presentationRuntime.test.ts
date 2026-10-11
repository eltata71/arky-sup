import { describe, expect, it } from 'vitest';
import { SUPPORTED_LAYOUTS } from '../../../services/presentation';
import {
  LASER_COARSE_STEP,
  LASER_STEP,
  formatElapsed,
  formatKpiAtProgress,
  moveLaser,
  parseKpiCountTarget,
} from '../../../services/presentation/presentationRuntime';
import { SLIDE_LAYOUT_BRAND, SLIDE_PALETTE } from '../../../services/presentation/slideBrand';
import { LAYOUT_SPECS, PPTX_PALETTE } from '../../../services/export/adapters/pptx/branding';

describe('KPI count-up (12.4)', () => {
  it('counts the one number a KPI states, keeping what surrounds it', () => {
    expect(parseKpiCountTarget('98,5 %')).toEqual({ prefix: '', value: 98.5, suffix: ' %', decimals: 1, decimalSeparator: ',' });
    expect(parseKpiCountTarget('$1.2M')).toEqual({ prefix: '$', value: 1.2, suffix: 'M', decimals: 1, decimalSeparator: '.' });
    expect(parseKpiCountTarget('-12 días')?.value).toBe(-12);
  });

  it('refuses a value with no number or with several, rather than animating the wrong one', () => {
    expect(parseKpiCountTarget('Alto')).toBeNull();
    expect(parseKpiCountTarget('Q3 2026')).toBeNull();
    expect(parseKpiCountTarget('3 de 5')).toBeNull();
  });

  it('starts at zero and ends at the value exactly as written', () => {
    const target = parseKpiCountTarget('98,5 %')!;
    expect(formatKpiAtProgress(target, 0)).toBe('0,0 %');
    expect(formatKpiAtProgress(target, 1)).toBe('98,5 %');
    expect(formatKpiAtProgress(target, 2)).toBe('98,5 %');
    const halfway = Number(formatKpiAtProgress(target, 0.5).replace(' %', '').replace(',', '.'));
    expect(halfway).toBeGreaterThan(49); // ease-out: past the midpoint at half time
    expect(halfway).toBeLessThan(98.5);
  });
});

describe('keyboard laser (12.4)', () => {
  it('moves by a step per arrow and a coarse step with Shift', () => {
    expect(moveLaser({ x: 50, y: 50 }, 'ArrowRight')).toEqual({ x: 50 + LASER_STEP, y: 50 });
    expect(moveLaser({ x: 50, y: 50 }, 'ArrowUp', true)).toEqual({ x: 50, y: 50 - LASER_COARSE_STEP });
  });

  it('stays on the slide', () => {
    expect(moveLaser({ x: 1, y: 99 }, 'ArrowLeft', true)).toEqual({ x: 0, y: 99 });
    expect(moveLaser({ x: 1, y: 99 }, 'ArrowDown', true)).toEqual({ x: 1, y: 100 });
  });

  it('lets every other key through', () => {
    expect(moveLaser({ x: 50, y: 50 }, 'PageDown')).toBeNull();
  });
});

describe('presenter clock (12.4)', () => {
  it('reads m:ss, and h:mm:ss past the hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_400)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('one brand for the screen and the PPTX (12.4)', () => {
  it('declares all fourteen layouts', () => {
    expect(Object.keys(SLIDE_LAYOUT_BRAND).sort()).toEqual([...SUPPORTED_LAYOUTS].sort());
    expect(SUPPORTED_LAYOUTS).toHaveLength(14);
  });

  it('is what the PPTX layouts are built from', () => {
    expect(PPTX_PALETTE).toBe(SLIDE_PALETTE);
    for (const layout of SUPPORTED_LAYOUTS) {
      const brand = SLIDE_LAYOUT_BRAND[layout];
      const spec = LAYOUT_SPECS[layout];
      expect({ layout, hero: spec.hero, decoration: spec.decoration, columns: spec.columns, align: spec.align })
        .toEqual({ layout, hero: brand.hero, decoration: brand.decoration, columns: brand.columns, align: brand.align === 'center' ? 'ctr' : 'l' });
    }
  });
});
