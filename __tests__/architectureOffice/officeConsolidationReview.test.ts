/**
 * El ciclo evaluador-optimizador de la Oficina, y su tope.
 *
 * El patrón sólo vale la pena cuando los criterios son explícitos y la
 * corrección mide algo; si además el evaluador es determinista, cuesta cero.
 * Lo que estas pruebas fijan es justo eso: qué se considera una consolidación
 * aceptable, que la corrección ocurre **una** vez, y que un fallo en la
 * corrección conserva la respuesta original en vez de sustituirla por un error.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  evaluateConsolidation,
  MIN_CONSOLIDATION_LENGTH,
} from '../../services/architectureOffice/domain/officeConsolidationReview';
import {
  DEFAULT_MAX_SPECIALISTS,
  executeOfficeOrchestration,
  planOfficeWorkstreams,
} from '../../services/architectureOffice/application/officeOrchestration';

const results = [
  { workstreamId: 'ws-1', personaId: 'mauricio' as const, status: 'completed' as const, output: 'ok' },
  { workstreamId: 'ws-2', personaId: 'carmen' as const, status: 'completed' as const, output: 'ok' },
];

const longEnough = (text: string): string => text.padEnd(MIN_CONSOLIDATION_LENGTH + 1, ' .');

describe('evaluateConsolidation', () => {
  it('accepts a recommendation that decides and cites who worked', () => {
    const review = evaluateConsolidation(
      longEnough('Recomendación: Conditional. Mauricio confirma el patrón API-led y Carmen exige el control de PHI antes de producción.'),
      results,
    );
    expect(review.ok).toBe(true);
  });

  it('asks for a verdict when the text only describes the problem', () => {
    const review = evaluateConsolidation(
      longEnough('Mauricio y Carmen coinciden en que la integración es compleja y hay dudas regulatorias.'),
      results,
    );
    expect(review.gaps.join(' ')).toMatch(/veredicto/i);
  });

  it('names the specialist whose analysis never made it into the answer', () => {
    const review = evaluateConsolidation(
      longEnough('Recomendación: Ready. Mauricio confirma el patrón API-led y no hay más que añadir.'),
      results,
    );
    // Si Carmen analizó cumplimiento y la recomendación no la menciona, o no la
    // leyó o la descartó en silencio: las dos cosas hay que verlas.
    expect(review.gaps.join(' ')).toContain('Carmen');
  });

  it('demands that a partial answer say it is partial', () => {
    const review = evaluateConsolidation(
      longEnough('Recomendación: Ready. Mauricio y Carmen coinciden en el enfoque propuesto.'),
      [...results, { workstreamId: 'ws-3', personaId: 'felipe' as const, status: 'failed' as const, output: '', error: 'timeout' }],
    );
    expect(review.gaps.join(' ')).toMatch(/no entregaron/i);
  });

  it('refuses a courtesy paragraph as a consolidation', () => {
    const review = evaluateConsolidation('Ready.', results);
    expect(review.ok).toBe(false);
  });
});

describe('executeOfficeOrchestration · evaluator-optimizer', () => {
  const plan = () => planOfficeWorkstreams('@Lucía coordina MuleSoft y cumplimiento regulatorio');

  it('gives the consolidator exactly one chance to correct itself', async () => {
    const consolidatorCalls: string[] = [];
    const invoke = vi.fn(async (personaId: string, instruction: string) => {
      if (personaId === 'alejandro') {
        consolidatorCalls.push(instruction);
        return 'Insuficiente.';
      }
      return `resultado-${personaId}`;
    });

    const result = await executeOfficeOrchestration(plan(), invoke);

    // Uno, no un bucle: la segunda pasada ya tiene toda la información que va a
    // tener, y sin tope la operación no converge, sólo se encarece.
    expect(consolidatorCalls).toHaveLength(2);
    expect(consolidatorCalls[1]).toContain('QUÉ FALTA');
    expect(result.refined).toBe(true);
    expect(result.consolidationReview?.ok).toBe(false);
  });

  it('does not spend a second call when the first answer already holds', async () => {
    const good = 'Recomendación: Conditional. Mauricio confirma el patrón API-led y Carmen exige el control de PHI antes de producción, con evidencia de cifrado en tránsito y reposo.'.padEnd(MIN_CONSOLIDATION_LENGTH + 1, ' .');
    const invoke = vi.fn(async (personaId: string) => (personaId === 'alejandro' ? good : `resultado-${personaId}`));

    const result = await executeOfficeOrchestration(plan(), invoke);

    expect(invoke.mock.calls.filter(([id]) => id === 'alejandro')).toHaveLength(1);
    expect(result.refined).toBe(false);
    expect(result.consolidationReview?.ok).toBe(true);
  });

  it('keeps the original recommendation when the correction itself fails', async () => {
    let consolidatorCalls = 0;
    const invoke = vi.fn(async (personaId: string) => {
      if (personaId === 'alejandro') {
        consolidatorCalls += 1;
        if (consolidatorCalls === 1) return 'Primera respuesta, corta.';
        throw new Error('proveedor caído');
      }
      return `resultado-${personaId}`;
    });

    const result = await executeOfficeOrchestration(plan(), invoke);

    // Una recomendación imperfecta vale más que un error donde debería estar la
    // respuesta.
    expect(result.consolidation).toBe('Primera respuesta, corta.');
    expect(result.refined).toBe(false);
    expect(result.status).toBe('completed');
  });

  it('can be told not to refine at all', async () => {
    const invoke = vi.fn(async (personaId: string) => (personaId === 'alejandro' ? 'Corta.' : 'ok'));
    await executeOfficeOrchestration(plan(), invoke, { maxConsolidationRefinements: 0 });
    expect(invoke.mock.calls.filter(([id]) => id === 'alejandro')).toHaveLength(1);
  });
});

describe('planOfficeWorkstreams · stopping conditions', () => {
  it('caps how many specialists one request may convene', () => {
    const plan = planOfficeWorkstreams(
      'AWS, Salesforce, MuleSoft, AS400, software, seguridad, proyecto, pólizas, datos y cumplimiento',
    );
    expect(plan.workstreams.length).toBeLessThanOrEqual(DEFAULT_MAX_SPECIALISTS);
  });

  it('honours a lower cap when the caller sets one', () => {
    const plan = planOfficeWorkstreams('AWS y MuleSoft', { maxSpecialists: 1 });
    expect(plan.workstreams).toHaveLength(1);
  });

  it('does not convene an agent the user switched off', () => {
    const plan = planOfficeWorkstreams('Evalúa la integración MuleSoft', { unavailable: ['mauricio'] });
    expect(plan.workstreams.map((entry) => entry.personaId)).not.toContain('mauricio');
  });

  it('never leaves the team empty, whatever is switched off', () => {
    const plan = planOfficeWorkstreams('Evalúa la integración MuleSoft', {
      unavailable: ['mauricio', 'gabriel', 'elena', 'tomas'],
    });
    // Un equipo sin nadie no es un equipo pequeño: es una operación que no
    // puede responder y una recomendación que no firma nadie.
    expect(plan.workstreams.length).toBeGreaterThan(0);
  });
});
