/**
 * Los entregables en curso de un proyecto, como los lee un prompt de artefacto
 * (plan de calidad de artefactos, 7.3c).
 */
import { describe, expect, it } from 'vitest';
import type { OfficeEngagement } from '../../../../services/architectureOffice/domain';
import { describeEngagementForArtifact, openDeliverablesForArtifacts } from '../../../../services/architectureOffice/domain/engagementArtifactContext';

const engagement = (overrides: Partial<OfficeEngagement>): OfficeEngagement => ({
  id: 'e1',
  projectId: 'p1',
  title: 'Integración con prestadores',
  brief: 'Diseñar la integración EDI 278 con la red de prestadores.',
  status: 'in-progress',
  updatedAt: '2026-09-20T00:00:00.000Z',
  charter: {
    objectives: ['Autorizar en menos de 72 horas'],
    scope: ['Portal de prestadores'],
    outOfScope: ['Centro de llamadas'],
    constraints: ['Sin cambios en el core de pólizas', ' '],
    regulatoryDrivers: ['HIPAA'],
  },
  arbDecisions: [],
  ...overrides,
} as unknown as OfficeEngagement);

describe('describeEngagementForArtifact', () => {
  it('carries the brief verbatim and what the charter binds', () => {
    const context = describeEngagementForArtifact(engagement({}));
    expect(context).toEqual({
      title: 'Integración con prestadores',
      brief: 'Diseñar la integración EDI 278 con la red de prestadores.',
      status: 'in-progress',
      objectives: ['Autorizar en menos de 72 horas'],
      scope: ['Portal de prestadores'],
      outOfScope: ['Centro de llamadas'],
      constraints: ['Sin cambios en el core de pólizas'],
      regulatoryDrivers: ['HIPAA'],
    });
  });

  it('carries the ARB’s last observation when it asked for changes, never an approval', () => {
    const asked = describeEngagementForArtifact(engagement({
      arbDecisions: [
        { verdict: 'changes-requested', rationale: 'Falta el plan de contingencia', decidedAt: '2026-09-21T00:00:00.000Z' },
      ] as OfficeEngagement['arbDecisions'],
    }));
    expect(asked.arbObservation).toBe('Falta el plan de contingencia');
    const approved = describeEngagementForArtifact(engagement({
      arbDecisions: [{ verdict: 'approved', rationale: 'Conforme', decidedAt: '2026-09-22T00:00:00.000Z' }] as OfficeEngagement['arbDecisions'],
    }));
    expect(approved.arbObservation).toBeUndefined();
  });
});

describe('openDeliverablesForArtifacts', () => {
  it('reads only the project’s open engagements, most recently touched first', () => {
    const deliverables = openDeliverablesForArtifacts('p1', [
      engagement({ id: 'a', title: 'Antiguo', updatedAt: '2026-09-01T00:00:00.000Z' }),
      engagement({ id: 'b', title: 'Reciente', updatedAt: '2026-09-25T00:00:00.000Z' }),
      engagement({ id: 'c', title: 'Entregado', status: 'delivered' }),
      engagement({ id: 'd', title: 'Otro proyecto', projectId: 'p2' }),
    ]);
    expect(deliverables.map((d) => d.title)).toEqual(['Reciente', 'Antiguo']);
  });
});
