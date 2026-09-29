/**
 * Lo que una reescritura no puede perder (plan de calidad de artefactos, 7.1a):
 * una sola regla para el chat, el ejecutor del agente y el refinamiento.
 */
import { describe, expect, it } from 'vitest';
import {
  checkContentPreservation,
  CONTENT_PRESERVATION_THRESHOLDS,
  instructionPermitsRemoval,
} from '../../../lib/artifacts';

const body = (label: string) => `${label} con detalle suficiente para contar como contenido útil. `.repeat(6);

const baseline = [
  '# Registro de decisiones',
  '## Contexto',
  body('Contexto'),
  '## Decisión',
  body('Decisión'),
  '| ID | Opción | Estado |',
  '| --- | --- | --- |',
  '| D1 | Mensajería | Aceptada |',
  '| D2 | Base documental | Rechazada |',
  '## Consecuencias',
  body('Consecuencias'),
].join('\n');

describe('checkContentPreservation', () => {
  it('accepts a rewrite that keeps every section, table and row', () => {
    const improved = baseline.replace('Mensajería', 'Mensajería asíncrona con reintentos');
    expect(checkContentPreservation(baseline, improved, { mode: 'document' })).toEqual({ ok: true });
  });

  it('refuses an empty rewrite in every mode', () => {
    for (const mode of ['document', 'hybrid', 'diagram'] as const) {
      const verdict = checkContentPreservation(baseline, '   ', { mode, permitsRemoval: true });
      expect(verdict.ok === false && verdict.violation).toBe('empty');
    }
  });

  it('refuses a rewrite that keeps only the beginning', () => {
    const verdict = checkContentPreservation(baseline, baseline.slice(0, 300), { mode: 'document' });
    expect(verdict.ok === false && verdict.violation).toBe('drastic-shrink');
    expect(verdict.ok === false && verdict.reason).toContain('drásticamente');
  });

  it('names the sections a rewrite dropped', () => {
    const candidate = baseline.replace(/## Consecuencias[\s\S]*$/, body('Cierre'));
    const verdict = checkContentPreservation(baseline, candidate, { mode: 'document' });
    expect(verdict.ok === false && verdict.violation).toBe('lost-sections');
    expect(verdict.ok === false && verdict.reason).toContain('consecuencias');
  });

  it('refuses losing a table or a row of it', () => {
    const withoutRow = baseline.replace('| D2 | Base documental | Rechazada |\n', '');
    expect(checkContentPreservation(baseline, withoutRow, { mode: 'document' })).toMatchObject({ ok: false, violation: 'lost-table-rows' });
    const withoutTable = baseline.replace(/\| ID[\s\S]*?Rechazada \|\n/, '');
    expect(checkContentPreservation(baseline, withoutTable, { mode: 'hybrid' })).toMatchObject({ ok: false, violation: 'lost-tables' });
  });

  it('refuses introducing filler text', () => {
    const candidate = `${baseline}\n\nLa Empresa X migrará el sistema legacy.`;
    expect(checkContentPreservation(baseline, candidate, { mode: 'document' })).toMatchObject({ ok: false, violation: 'new-placeholders' });
  });

  it('lets an explicit removal drop structure, but never gut the artifact', () => {
    const withoutDecision = baseline.replace(/## Decisión[\s\S]*?(?=## Consecuencias)/, '');
    expect(checkContentPreservation(baseline, withoutDecision, { mode: 'document', permitsRemoval: true })).toEqual({ ok: true });
    const gutted = baseline.slice(0, 120);
    expect(checkContentPreservation(baseline, gutted, { mode: 'document', permitsRemoval: true }))
      .toMatchObject({ ok: false, violation: 'drastic-shrink' });
  });

  it('measures a diagram only by emptiness and shrinkage: its structure is the IR’s', () => {
    const diagram = 'flowchart LR\n  A[Portal]-->B[API]\n  B-->C[(Pólizas)]';
    expect(checkContentPreservation(diagram, 'flowchart LR\n  A[Portal]-->B[API]', { mode: 'diagram' })).toEqual({ ok: true });
  });

  it('does not measure shrinkage below the minimum useful baseline', () => {
    const tiny = 'Texto breve.';
    expect(tiny.length).toBeLessThan(CONTENT_PRESERVATION_THRESHOLDS.minBaselineUsefulChars);
    expect(checkContentPreservation(tiny, 'Otro.', { mode: 'document' })).toEqual({ ok: true });
  });
});

describe('instructionPermitsRemoval', () => {
  it.each([
    'Elimina la sección de riesgos',
    'quita la tabla de costes',
    'Resume el documento en una página',
    'acorta la introducción',
    'please remove the appendix',
    'Summarize it',
  ])('reads «%s» as a request to remove', (instruction) => {
    expect(instructionPermitsRemoval(instruction)).toBe(true);
  });

  it.each(['Añade un riesgo', 'mejora la redacción', 'traduce al inglés', '', undefined])(
    'reads «%s» as a change that must keep everything', (instruction) => {
      expect(instructionPermitsRemoval(instruction)).toBe(false);
    },
  );
});
