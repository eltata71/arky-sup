/**
 * La regla de gobierno de la Oficina: nadie ejecuta un charter sin aprobar.
 *
 * Vivía dentro de un `useCallback` de `OfficeContext`, junto al
 * `AbortController` y el `setState`, así que comprobarla exigía renderizar un
 * proveedor de React y simular un clic. Ejecutar antes de aprobar convierte la
 * aprobación en un trámite posterior a los hechos, que es exactamente lo que
 * una Oficina de Arquitectura existe para impedir.
 */

import { describe, expect, it } from 'vitest';
import {
  canRunEngagement,
  isCharterApproved,
} from '../../../services/architectureOffice/officeEngagementTransitions';
import type { OfficeEngagement } from '../../../services/architectureOffice/OfficeTypes';

const withCharter = (approvedAt?: string): OfficeEngagement =>
  ({ id: 'eng-1', charter: { approvedAt } } as unknown as OfficeEngagement);

describe('canRunEngagement', () => {
  it('se niega mientras el charter no esté aprobado', () => {
    const verdict = canRunEngagement(withCharter(undefined), false);
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome === 'refused') expect(verdict.refusal.reason).toBe('charter-not-approved');
  });

  it('se niega si ya se está ejecutando', () => {
    const verdict = canRunEngagement(withCharter('2026-09-02T00:00:00.000Z'), true);
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome === 'refused') expect(verdict.refusal.reason).toBe('already-running');
  });

  it('la falta de aprobación pesa más que estar ocupado', () => {
    // Si las dos fallan, la que se le dice al usuario es la que puede resolver.
    const verdict = canRunEngagement(withCharter(undefined), true);
    if (verdict.outcome === 'refused') expect(verdict.refusal.reason).toBe('charter-not-approved');
  });

  it('permite ejecutar un charter aprobado que no está corriendo', () => {
    expect(canRunEngagement(withCharter('2026-09-02T00:00:00.000Z'), false).outcome).toBe('allowed');
  });
});

describe('isCharterApproved', () => {
  it('distingue aprobado de sin aprobar', () => {
    expect(isCharterApproved(withCharter(undefined))).toBe(false);
    expect(isCharterApproved(withCharter('2026-09-02T00:00:00.000Z'))).toBe(true);
  });
});
