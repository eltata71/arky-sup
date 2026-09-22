import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArbDecisionPanel } from '../../components/architectureOffice/ArbDecisionPanel';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeEngagementStatus,
} from '../../services/architectureOffice/OfficeTypes';
import type { OfficeQualityAssessment } from '../../services/architectureOffice/officeQualityGates';

const assessment = (overallStatus: OfficeQualityAssessment['overallStatus']): OfficeQualityAssessment => ({
  overallStatus,
  evaluatedAt: '2026-08-26T00:00:00.000Z',
  gates: [{
    id: 'security-review',
    status: overallStatus,
    evidenceArtifactIds: overallStatus === 'pass' ? ['art-1'] : [],
    blockers: overallStatus === 'blocked' ? ['Falta el Threat Model STRIDE.'] : [],
    conditions: overallStatus === 'conditional' ? ['Completar evidencia de retención.'] : [],
  }],
});

/**
 * Las tres respuestas de `describeArbDecisionEligibility`, escritas como datos.
 *
 * El panel no vuelve a decidir quién puede firmar: recibe el veredicto y elige
 * la frase. Por eso aquí son literales y no una llamada a la regla — si la
 * prueba la invocara, dejaría de comprobar que el componente sabe pintar los
 * dos motivos y pasaría a comprobar la regla por segunda vez.
 */
const ALLOWED = { allowed: true } as const;

const engagement = (
  status: OfficeEngagementStatus,
  gateAssessment?: OfficeQualityAssessment,
): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Encargo',
  brief: 'brief',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  status,
  charter: {
    kind: 'new-solution',
    objectives: [], scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [],
    deliverables: [], participantIds: [],
    coordinatorId: 'lucia', consolidatorId: 'alejandro',
    provenance: 'deterministic', proposedAt: '2026-08-26T00:00:00.000Z',
  },
  tasks: [],
  gateAssessment,
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
});

describe('ArbDecisionPanel', () => {
  it('shows the blockers behind a gate, not just its colour', () => {
    render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('blocked'))}
        eligibility={ALLOWED}
        onDecide={vi.fn()}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByText('Falta el Threat Model STRIDE.')).toBeInTheDocument();
  });

  it('shows the conditions and the evidence count', () => {
    const { rerender } = render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('conditional'))}
        eligibility={ALLOWED}
        onDecide={vi.fn()}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByText('Completar evidencia de retención.')).toBeInTheDocument();

    rerender(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('pass'))}
        eligibility={ALLOWED}
        onDecide={vi.fn()}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByText('Evidencia: 1 artefacto(s)')).toBeInTheDocument();
  });

  it('blocks approval while a gate is blocked', () => {
    const onDecide = vi.fn();
    render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('blocked'))}
        eligibility={ALLOWED}
        onDecide={onDecide}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Aprobar entrega' })).toBeDisabled();
  });

  it('dice al autor que su entregable lo firma otro, en vez de ofrecerle el botón', () => {
    // El defecto que esto cierra: el panel leía sólo el permiso, así que a un
    // `reviewer`, `admin` o `superadmin` mirando un encargo **suyo** le ofrecía
    // «Aprobar entrega» habilitado para una llamada que el servidor rechaza
    // siempre con `42501` (ADR-101, opción C). Lo único que lo notó fue un
    // recorrido E2E, cuatro fases después.
    render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('pass'))}
        eligibility={{ allowed: false, reason: 'own-engagement' }}
        onDecide={vi.fn()}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByText(/lo creaste tú/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar entrega' })).not.toBeInTheDocument();
  });

  it('explains separation of duties to a non-admin instead of offering the buttons', () => {
    render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('pass'))}
        eligibility={{ allowed: false, reason: 'missing-permission' }}
        onDecide={vi.fn()}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByText(/Solo un miembro del comité/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar entrega' })).not.toBeInTheDocument();
  });

  it('requires a rationale before enabling changes-requested and rejection', () => {
    const onDecide = vi.fn();
    render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('pass'))}
        eligibility={ALLOWED}
        onDecide={onDecide}
        onReevaluateGates={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Pedir cambios' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Motivo de la decisión'), {
      target: { value: 'Falta la vista de despliegue.' },
    });

    const request = screen.getByRole('button', { name: 'Pedir cambios' });
    expect(request).toBeEnabled();
    fireEvent.click(request);
    expect(onDecide).toHaveBeenCalledWith('changes-requested', 'Falta la vista de despliegue.');
  });

  it('hides the decision controls until the engagement reaches the board', () => {
    render(
      <ArbDecisionPanel
        engagement={engagement('in-progress', assessment('pass'))}
        eligibility={ALLOWED}
        onDecide={vi.fn()}
        onReevaluateGates={vi.fn()}
      />,
    );
    expect(screen.getByText(/El comité decide cuando el entregable termina/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar entrega' })).not.toBeInTheDocument();
  });

  it('lets the reviewer recompute the gates', () => {
    const onReevaluateGates = vi.fn();
    render(
      <ArbDecisionPanel
        engagement={engagement('awaiting-arb', assessment('pass'))}
        eligibility={ALLOWED}
        onDecide={vi.fn()}
        onReevaluateGates={onReevaluateGates}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reevaluar gates' }));
    expect(onReevaluateGates).toHaveBeenCalled();
  });
});
