/**
 * Un encargo no cambia de estado sin dejar escrito por qué.
 *
 * El rastro de auditoría es lo que una Oficina de Arquitectura tiene que poder
 * enseñar: quién movió el encargo, cuándo y con qué motivo. Hasta la Ola 5 eso
 * dependía de que quien cambiara `status` se acordara de llamar a
 * `withAuditEntry` en la línea siguiente — y en el arranque del runner no se
 * acordaba: `{ ...initial, status: 'in-progress' }` cambiaba el estado y el
 * `run-started` llegaba después, por separado.
 *
 * Dos pasos adyacentes no son uno. `transitionEngagement` los une, y este
 * escáner impide que vuelvan a separarse: el compilador no puede ayudar aquí
 * porque una propagación con `status` satisface el tipo igual de bien.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { transitionEngagement } from '../../../services/architectureOffice/officeEngagementTransitions';
import type { OfficeEngagement } from '../../../services/architectureOffice/OfficeTypes';

const sourceFiles = (): string[] =>
  execSync('git ls-files --cached --others --exclude-standard "services/architectureOffice"')
    .toString()
    .split('\n')
    .filter((file) => /\.ts$/.test(file) && !file.includes('__tests__/'));

/** Dónde puede escribirse `status` sobre un encargo, y por qué. */
const ALLOWED = new Set([
  // La transición misma: es quien lo aplica.
  'services/architectureOffice/officeEngagementTransitions.ts',
  // La fábrica: un encargo nace en `awaiting-charter`, y eso no es una
  // transición sino su estado inicial.
  'services/architectureOffice/officeEngagementFactory.ts',
]);

describe('el estado de un encargo no se mueve sin su rastro', () => {
  it('nadie escribe `status` sobre un encargo fuera de la transición', () => {
    // `{ ...engagement, status: … }` es la forma en que se hacía antes.
    const bareTransition = /\.\.\.\s*(engagement|initial|decided|approved|signed)\s*,\s*\n?\s*status:/;

    const offenders = sourceFiles().filter((file) => {
      if (ALLOWED.has(file)) return false;
      return bareTransition.test(readFileSync(file, 'utf8'));
    });

    expect(
      offenders,
      'Usa `transitionEngagement`: cambia el estado y escribe la entrada de '
      + 'auditoría en una sola operación, para que no puedan separarse.',
    ).toEqual([]);
  });
});

describe('transitionEngagement', () => {
  const base = {
    id: 'eng-1',
    status: 'awaiting-charter',
    auditTrail: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as OfficeEngagement;

  it('cambia el estado y añade la entrada en la misma operación', () => {
    const next = transitionEngagement(base, 'in-progress', 'run-started', 'Arrancó.');
    expect(next.status).toBe('in-progress');
    expect(next.auditTrail).toHaveLength(1);
    expect(next.auditTrail[0].action).toBe('run-started');
  });

  it('registra de dónde venía y adónde va sin que el llamador lo diga', () => {
    // Un rastro que no dice el estado anterior obliga a reconstruirlo leyendo
    // todas las entradas anteriores en orden.
    const next = transitionEngagement(base, 'blocked', 'engagement-blocked', 'Una tarea falló.');
    expect(next.auditTrail[0].before).toBe('awaiting-charter');
    expect(next.auditTrail[0].after).toBe('blocked');
  });

  it('deja que el llamador corrija el estado anterior cuando ya lo cambió', () => {
    // El ARB construye el encargo con sus otros campos antes de transicionar,
    // así que aporta el `before` real.
    const next = transitionEngagement(
      base, 'in-progress', 'charter-approved', 'Aprobado.', { before: 'awaiting-charter' },
    );
    expect(next.auditTrail[0].before).toBe('awaiting-charter');
  });

  it('no pierde el rastro anterior', () => {
    const once = transitionEngagement(base, 'in-progress', 'run-started', 'Arrancó.');
    const twice = transitionEngagement(once, 'blocked', 'engagement-blocked', 'Se atascó.');
    expect(twice.auditTrail.map((entry) => entry.action)).toEqual(['run-started', 'engagement-blocked']);
  });
});
