import { describe, expect, it } from 'vitest';
import {
  parsePresentationDeck,
  validatePresentationDeck,
  PRESENTATION_SCHEMA_VERSION,
  PRESENTATION_TEMPLATE_LIMITS,
  SUPPORTED_LAYOUTS,
} from '../../services/presentation/presentationSchema';

describe('presentationSchema', () => {
  describe('parsePresentationDeck', () => {
    it('parses a well-formed deck from raw JSON', () => {
      const raw = JSON.stringify({
        kind: 'presentation',
        version: '1.0.0',
        title: 'Demo deck',
        audience: 'executive',
        slides: [
          {
            id: 'slide-1',
            slideNumber: 1,
            title: 'Portada',
            layout: 'titleSlide',
            contentBlocks: [],
          },
          {
            id: 'slide-2',
            slideNumber: 2,
            title: 'Resumen',
            layout: 'executiveSummary',
            contentBlocks: [
              { type: 'bullets', content: ['Punto uno', 'Punto dos'] },
            ],
          },
        ],
      });
      const result = parsePresentationDeck(raw, { artifactName: 'Demo', artifactType: 'presentation-executive' });
      expect(result.ok).toBe(true);
      expect(result.usedFallback).toBe(false);
      expect(result.deck.title).toBe('Demo deck');
      expect(result.deck.slides).toHaveLength(2);
      expect(result.deck.slides[0].layout).toBe('titleSlide');
      expect(result.deck.slides[1].contentBlocks[0].type).toBe('bullets');
      expect(result.deck.slides[1].contentBlocks[0].content).toEqual(['Punto uno', 'Punto dos']);
    });

    it('coerces unknown layout to a safe fallback', () => {
      const raw = JSON.stringify({
        kind: 'presentation',
        title: 'Test',
        audience: 'mixed',
        slides: [
          { id: 's1', slideNumber: 1, title: 'A', layout: 'somethingBogus', contentBlocks: [{ type: 'text', content: 'hi' }] },
        ],
      });
      const result = parsePresentationDeck(raw);
      expect(result.ok).toBe(true);
      // First slide should fall back to titleSlide; subsequent unknowns -> executiveSummary
      expect(SUPPORTED_LAYOUTS).toContain(result.deck.slides[0].layout);
    });

    it('maps common layout aliases to canonical layouts', () => {
      const raw = JSON.stringify({
        kind: 'presentation',
        title: 'Test',
        audience: 'mixed',
        slides: [
          { id: 's1', slideNumber: 1, title: 'A', layout: 'title', contentBlocks: [] },
          { id: 's2', slideNumber: 2, title: 'B', layout: 'closing', contentBlocks: [] },
          { id: 's3', slideNumber: 3, title: 'C', layout: 'kpis', contentBlocks: [{ type: 'text', content: 'x' }] },
        ],
      });
      const result = parsePresentationDeck(raw);
      expect(result.deck.slides[0].layout).toBe('titleSlide');
      expect(result.deck.slides[1].layout).toBe('closingSlide');
      expect(result.deck.slides[2].layout).toBe('metricsKpi');
    });

    it('falls back to a minimal deck when content is not JSON', () => {
      const raw = '# Markdown title\n\nSome prose that is not a deck.';
      const result = parsePresentationDeck(raw, { artifactName: 'Legacy', artifactType: 'presentation-executive' });
      expect(result.ok).toBe(false);
      expect(result.usedFallback).toBe(true);
      expect(result.deck.slides.length).toBeGreaterThan(0);
      expect(result.deck.title).toBe('Legacy');
    });

    it('falls back when content is empty', () => {
      const result = parsePresentationDeck('', { artifactName: 'Empty' });
      expect(result.ok).toBe(false);
      expect(result.usedFallback).toBe(true);
      expect(result.deck.slides).toHaveLength(1);
    });

    it('parses JSON wrapped in a ```json fence', () => {
      const raw = '```json\n' + JSON.stringify({
        kind: 'presentation',
        title: 'Fenced',
        audience: 'mixed',
        slides: [{ id: 's1', slideNumber: 1, title: 'X', layout: 'titleSlide', contentBlocks: [] }],
      }) + '\n```';
      const result = parsePresentationDeck(raw);
      expect(result.ok).toBe(true);
      expect(result.deck.title).toBe('Fenced');
    });

    it('coerces table / kpi / callout blocks defensively', () => {
      const raw = JSON.stringify({
        kind: 'presentation',
        title: 'Mixed',
        audience: 'technical',
        slides: [
          {
            id: 's1', slideNumber: 1, title: 'Cover', layout: 'titleSlide', contentBlocks: [],
          },
          {
            id: 's2', slideNumber: 2, title: 'KPIs', layout: 'metricsKpi',
            contentBlocks: [
              { type: 'kpi', content: [{ label: 'Latency', value: '120ms', trend: 'down' }] },
              { type: 'table', content: { headers: ['A', 'B'], rows: [['1', '2']] } },
              { type: 'callout', content: { tone: 'warning', body: 'cuidado' } },
              { type: 'list', content: ['legacy alias bullets'] }, // alias for bullets
            ],
          },
        ],
      });
      const result = parsePresentationDeck(raw);
      expect(result.ok).toBe(true);
      const slide = result.deck.slides[1];
      expect(slide.contentBlocks.map(b => b.type)).toContain('kpi');
      expect(slide.contentBlocks.map(b => b.type)).toContain('table');
      expect(slide.contentBlocks.map(b => b.type)).toContain('callout');
      // 'list' should have been coerced to 'bullets'
      expect(slide.contentBlocks.find(b => b.type === 'bullets')).toBeDefined();
    });
  });

  describe('validatePresentationDeck', () => {
    it('flags decks shorter than the recommended minimum', () => {
      const result = parsePresentationDeck(JSON.stringify({
        kind: 'presentation', title: 'T', audience: 'executive',
        slides: [{ id: 's1', slideNumber: 1, title: 'Only one', layout: 'titleSlide', contentBlocks: [] }],
      }));
      const limits = PRESENTATION_TEMPLATE_LIMITS['presentation-executive'];
      const issues = validatePresentationDeck(result.deck, { minSlides: limits.min, maxSlides: limits.max });
      expect(issues.some(i => i.message.includes('al menos'))).toBe(true);
    });

    it('flags a missing titleSlide as first slide', () => {
      const result = parsePresentationDeck(JSON.stringify({
        kind: 'presentation', title: 'T', audience: 'executive',
        slides: [
          { id: 's1', slideNumber: 1, title: 'Resumen', layout: 'executiveSummary', contentBlocks: [{ type: 'text', content: 'x' }] },
          { id: 's2', slideNumber: 2, title: 'Cierre', layout: 'closingSlide', contentBlocks: [] },
        ],
      }));
      const issues = validatePresentationDeck(result.deck);
      expect(issues.some(i => i.message.includes('titleSlide'))).toBe(true);
    });

    it('passes structurally valid decks', () => {
      const slides = Array.from({ length: 8 }, (_, idx) => ({
        id: `s${idx + 1}`,
        slideNumber: idx + 1,
        title: `Slide ${idx + 1}`,
        layout: idx === 0 ? 'titleSlide' : (idx === 7 ? 'closingSlide' : 'executiveSummary'),
        contentBlocks: idx === 0 || idx === 7 ? [] : [{ type: 'text', content: 'demo' }],
      }));
      const result = parsePresentationDeck(JSON.stringify({
        kind: 'presentation', title: 'OK', audience: 'mixed', slides,
      }));
      const issues = validatePresentationDeck(result.deck);
      expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
    });
  });

  it('exposes a schema version constant', () => {
    expect(PRESENTATION_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
