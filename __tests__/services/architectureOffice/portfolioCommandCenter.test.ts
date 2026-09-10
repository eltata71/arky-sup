/**
 * La regla de salud del portafolio, comprobada sin renderizar nada.
 *
 * Ése es el motivo de que viva en un servicio y no en el tablero: cada una de
 * estas afirmaciones —«sin medir no es cero», «la franja se calcula», «la cifra
 * viene con su composición»— habría necesitado montar tres proveedores de React
 * para poder comprobarse si la derivación siguiera dentro del JSX.
 */

import { describe, expect, it } from 'vitest';
import {
  PORTFOLIO_BAND_LABELS,
  bandOf,
  buildPortfolioCommandCenter,
  windowedDelta,
  type AttentionSignalPort,
  type DeliverableSignalPort,
  type InitiativeSignalPort,
} from '../../../services/architectureOffice/application/portfolioCommandCenter';

const initiatives = (over: Partial<InitiativeSignalPort> = {}): InitiativeSignalPort => ({
  total: 0, atRisk: 0, awaitingDecision: 0, overdue: 0, milestonesMissed: 0, ...over,
});
const attentions = (over: Partial<AttentionSignalPort> = {}): AttentionSignalPort => ({
  total: 0, withoutInitiative: 0, brokenLinks: 0, ...over,
});
const deliverables = (over: Partial<DeliverableSignalPort> = {}): DeliverableSignalPort => ({
  total: 0, blocked: 0, awaitingDecision: 0, overdueTasks: 0, criticalFindings: 0, ...over,
});

describe('buildPortfolioCommandCenter', () => {
  it('reports an unmeasured portfolio as unmeasured, never as zero', () => {
    const model = buildPortfolioCommandCenter(initiatives(), attentions(), deliverables());

    // El 0 % es la mentira que esta rama existe para evitar: informaría de una
    // organización que ha fracasado, no de una que aún no ha empezado.
    expect(model.health).toBeNull();
    expect(model.band).toBeNull();
    expect(model.governed).toBe(0);
    expect(model.drags).toEqual([]);
  });

  it('counts only the three governed levels, never the artifacts', () => {
    const model = buildPortfolioCommandCenter(
      initiatives({ total: 2 }),
      attentions({ total: 3 }),
      deliverables({ total: 5 }),
    );

    expect(model.governed).toBe(10);
    expect(model.health).toBe(1);
    expect(model.band).toBe('strong');
  });

  it('derives the band from the impairments rather than from any stored field', () => {
    const model = buildPortfolioCommandCenter(
      initiatives({ total: 4 }),
      attentions({ total: 3 }),
      deliverables({ total: 3, blocked: 2 }),
    );

    expect(model.impaired).toBe(2);
    expect(model.health).toBeCloseTo(0.8, 5);
    expect(model.band).toBe('steady');
  });

  it('publishes the composition of the figure, worst first', () => {
    const model = buildPortfolioCommandCenter(
      initiatives({ total: 6, atRisk: 1 }),
      attentions({ total: 6, withoutInitiative: 3 }),
      deliverables({ total: 8, blocked: 2 }),
    );

    expect(model.drags.map((drag) => drag.id)).toEqual([
      'attentions-orphan',
      'deliverables-blocked',
      'initiatives-at-risk',
    ]);
    expect(model.drags.reduce((total, drag) => total + drag.count, 0)).toBe(model.impaired);
  });

  it('floors health at zero when one item is counted by two impairments', () => {
    // El mismo entregable puede estar bloqueado y esperando decisión. Sumar
    // ambos puede superar la población; la salud llega a cero y nunca por
    // debajo, porque un porcentaje negativo no significa nada para el lector.
    const model = buildPortfolioCommandCenter(
      initiatives(),
      attentions(),
      deliverables({ total: 1, blocked: 1, awaitingDecision: 1 }),
    );

    expect(model.health).toBe(0);
    expect(model.band).toBe('critical');
  });

  it('orders the attention centre by severity first and size second', () => {
    const model = buildPortfolioCommandCenter(
      initiatives({ total: 5, atRisk: 4 }),
      attentions({ total: 5, brokenLinks: 9 }),
      deliverables({ total: 5, blocked: 1, criticalFindings: 2 }),
    );

    // Nueve vínculos rotos son más numerosos que un entregable bloqueado y aun
    // así van después: la gravedad manda sobre la cantidad, o el triaje deja de
    // serlo y pasa a ser un ranking de frecuencia.
    expect(model.signals.map((signal) => signal.id)).toEqual([
      'critical-findings',
      'deliverables-blocked',
      'initiatives-at-risk',
      'broken-links',
    ]);
    expect(model.urgentSignals).toBe(3);
  });

  it('omits a signal with nothing in it rather than listing a zero', () => {
    const model = buildPortfolioCommandCenter(
      initiatives({ total: 2 }),
      attentions({ total: 2 }),
      deliverables({ total: 2 }),
    );

    expect(model.signals).toEqual([]);
    expect(model.urgentSignals).toBe(0);
  });
});

describe('bandOf', () => {
  it('places each cut where the rule says, and nowhere else', () => {
    expect(bandOf(1)).toBe('strong');
    expect(bandOf(0.9)).toBe('strong');
    expect(bandOf(0.89)).toBe('steady');
    expect(bandOf(0.75)).toBe('steady');
    expect(bandOf(0.74)).toBe('strained');
    expect(bandOf(0.5)).toBe('strained');
    expect(bandOf(0.49)).toBe('critical');
    expect(bandOf(0)).toBe('critical');
  });

  it('names every band, so the colour never carries it alone', () => {
    for (const band of ['strong', 'steady', 'strained', 'critical'] as const) {
      expect(PORTFOLIO_BAND_LABELS[band]).toBeTruthy();
    }
  });
});

describe('windowedDelta', () => {
  it('refuses to compare when there is no complete previous window', () => {
    // Seis días no dan dos ventanas de siete. Un `previous: 0` diría que la
    // semana pasada no se hizo nada, que es un hecho distinto de no saberlo.
    const result = windowedDelta([1, 1, 1, 1, 1, 1], 7);

    expect(result.current).toBe(6);
    expect(result.previous).toBeNull();
    expect(result.delta).toBeNull();
  });

  it('compares two windows of exactly the same width', () => {
    const result = windowedDelta([1, 1, 1, 2, 2, 2], 3);

    expect(result.previous).toBe(3);
    expect(result.current).toBe(6);
    expect(result.delta).toBe(3);
  });

  it('reports a fall as a fall, without deciding whether that is bad news', () => {
    const result = windowedDelta([9, 9, 1, 1], 2);

    expect(result.delta).toBe(-16);
  });
});
