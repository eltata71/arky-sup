import { describe, expect, it } from 'vitest';
import { ARCHIMATE_LAYER_PALETTE } from '../../lib/diagramTokens';
import { ARCHIMATE_LAYERS } from '../../lib/archimate/archimateMetamodel';
import { contrastRatio, parseColor } from '../../lib/colorContrast';

describe('ArchiMate layer palette', () => {
  it('covers every layer', () => {
    expect(Object.keys(ARCHIMATE_LAYER_PALETTE).sort()).toEqual([...ARCHIMATE_LAYERS].sort());
  });
  it.each(Object.entries(ARCHIMATE_LAYER_PALETTE))('%s text reads over its fill (AA)', (_layer, p) => {
    const ratio = contrastRatio(parseColor(p.text)!, parseColor(p.bg)!);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
