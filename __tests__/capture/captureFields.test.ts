/**
 * El catálogo de campos es el contrato entre seis formularios y un agente.
 *
 * Que exista un catálogo no sirve de nada si un campo entra sin reglas: la
 * regla de la disciplina —«un objetivo dice qué, nunca cómo»— es lo que
 * distingue esta ayuda de un generador de texto, y viaja al prompt desde aquí.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPTURE_FIELDS,
  captureField,
  captureFieldsForLevel,
  describeInsufficientContext,
  MIN_CAPTURE_CONTEXT,
  type CaptureFieldId,
} from '../../lib/capture';

const ALL = Object.values(CAPTURE_FIELDS);

describe('el catálogo', () => {
  it('cubre los tres niveles de la jerarquía', () => {
    for (const level of ['initiative', 'attention', 'deliverable'] as const) {
      expect(captureFieldsForLevel(level).length).toBeGreaterThan(0);
    }
  });

  it('da a cada campo una guía y al menos una regla', () => {
    for (const spec of ALL) {
      expect(spec.guidance.trim().length, spec.id).toBeGreaterThan(20);
      expect(spec.constraints.length, spec.id).toBeGreaterThan(0);
    }
  });

  it('indexa cada campo por su propio id y por su nivel', () => {
    for (const [id, spec] of Object.entries(CAPTURE_FIELDS)) {
      expect(spec.id).toBe(id as CaptureFieldId);
      expect(id.startsWith(spec.level === 'attention' ? 'attention.' : `${spec.level}.`)).toBe(true);
      expect(captureField(spec.id)).toBe(spec);
    }
  });

  it('pide un solo valor a los campos de prosa', () => {
    for (const spec of ALL.filter((entry) => entry.shape === 'text')) {
      expect(spec.maxSuggestions, spec.id).toBe(1);
    }
  });

  it('mantiene la regla que separa el nivel de negocio del de arquitectura', () => {
    expect(CAPTURE_FIELDS['initiative.objectives'].constraints.join(' '))
      .toContain('nunca CÓMO construirlo');
    // Un indicador sin unidad no se puede medir, así que no se propone.
    expect(CAPTURE_FIELDS['initiative.kpis'].constraints.join(' ')).toContain('unidad');
  });
});

describe('describeInsufficientContext', () => {
  it('refuses an empty record and says what to write first, per level', () => {
    for (const [level, hint] of [
      ['initiative', /necesidad del negocio/i],
      ['attention', /nombre y el objetivo/i],
      ['deliverable', /brief/i],
    ] as const) {
      const reason = describeInsufficientContext({
        level,
        context: { level, subject: '', known: [], ancestry: [] },
      });
      expect(reason, level).toMatch(hint);
    }
  });

  it('lets a record with real content through', () => {
    const reason = describeInsufficientContext({
      level: 'initiative',
      context: {
        level: 'initiative',
        subject: 'Alta digital',
        known: [{ label: 'Necesidad', value: 'x'.repeat(MIN_CAPTURE_CONTEXT) }],
        ancestry: [],
      },
    });
    expect(reason).toBeNull();
  });

  it('counts a parent as context: an attention with an initiative above has something to reason from', () => {
    const reason = describeInsufficientContext({
      level: 'attention',
      context: {
        level: 'attention',
        subject: '',
        known: [],
        ancestry: [{ label: 'Iniciativa', value: 'El alta tarda cinco días y se cae una de cada tres.' }],
      },
    });
    expect(reason).toBeNull();
  });
});
