import { describe, expect, it } from 'vitest';
import { buildRoadmapDeck } from '../../services/export/deckExport';

const base = { title: 'Plan', subtitle: 's', gapTitle: 'Brechas', gapHeaders: ['Elemento', 'Acción'], timelineTitle: 'Hoja de ruta' };

describe('buildRoadmapDeck', () => {
  it('lleva las mesetas a la línea de tiempo nativa, en orden', () => {
    const deck = buildRoadmapDeck({ ...base, gapRows: [['CRM', 'Nuevo']], steps: ['Meseta 1 — 2027-01-01', 'Meseta 2 — sin fecha'] });
    expect(deck.slides.map((s) => s.layout)).toEqual(['titleSlide', 'comparisonTable', 'timeline']);
    expect(deck.slides[2].contentBlocks.map((b) => b.content)).toEqual(['Meseta 1 — 2027-01-01', 'Meseta 2 — sin fecha']);
  });

  it('no dibuja diapositivas de nada', () => {
    const deck = buildRoadmapDeck({ ...base, gapRows: [], steps: [] });
    expect(deck.slides).toHaveLength(1);
  });
});
