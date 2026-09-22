/**
 * Architecture Review Board panel — the human checkpoint.
 *
 * Shows the evidence the board decides on (quality gates with their blockers,
 * conditions and evidence artifacts) and records the verdict. The gate
 * blockers surfaced here were previously computed by
 * `evaluateOfficeQualityGates` and then discarded by both UI consumers, which
 * left the reviewer with a colour and no reason.
 */

import React, { useState } from 'react';
import { Alert, Badge, Button, Card, CardTitle } from '../ui';
import { OFFICE_GATE_LABELS } from '../../services/architectureOffice/officeQualityGates';
import type {
  OfficeArbVerdict,
  OfficeEngagement,
} from '../../services/architectureOffice/OfficeTypes';
// Por el barril y no por el fichero: es un `import type`, así que TypeScript lo
// borra entero y no cuesta un byte de bundle — que es lo único que justifica
// entrar por una ruta profunda en este repositorio.
import type { ArbDecisionEligibility } from '../../services/architectureOffice';
import { GATE_STATUS_LABELS, GATE_STATUS_TONES, REVIEW_VERDICT_LABELS, REVIEW_VERDICT_TONES } from './officeUiLabels';

interface ArbDecisionPanelProps {
  engagement: OfficeEngagement;
  /**
   * Si esta persona puede firmar **este** encargo, con el motivo cuando no.
   *
   * Era un `boolean` que sólo miraba el permiso, y por eso a quien había
   * escrito el encargo se le ofrecía «Aprobar entrega» habilitado para una
   * llamada que el servidor rechaza siempre (ADR-101, opción C). El motivo
   * viaja porque las dos negativas se explican distinto; la regla la decide
   * `describeArbDecisionEligibility` y aquí sólo se elige la frase.
   */
  eligibility: ArbDecisionEligibility;
  busy?: boolean;
  onDecide: (verdict: OfficeArbVerdict, rationale: string) => void;
  onReevaluateGates: () => void;
}

export const ArbDecisionPanel: React.FC<ArbDecisionPanelProps> = ({
  engagement,
  eligibility,
  busy = false,
  onDecide,
  onReevaluateGates,
}) => {
  const [rationale, setRationale] = useState('');
  const assessment = engagement.gateAssessment;
  const decidable = engagement.status === 'awaiting-arb' || engagement.status === 'blocked';
  const gateBlocked = assessment?.overallStatus === 'blocked';

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Comité de Arquitectura</CardTitle>
        <div className="flex items-center gap-2">
          {assessment && (
            <Badge tone={GATE_STATUS_TONES[assessment.overallStatus]}>
              Gates: {GATE_STATUS_LABELS[assessment.overallStatus]}
            </Badge>
          )}
          <Button variant="ghost" size="xs" onClick={onReevaluateGates} disabled={busy}>
            Reevaluar gates
          </Button>
        </div>
      </div>

      {!assessment && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Todavía no se han evaluado los quality gates de este entregable.
        </p>
      )}

      {assessment && (
        <ul className="space-y-2" aria-label="Quality gates">
          {assessment.gates.map((gate) => (
            <li key={gate.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {OFFICE_GATE_LABELS[gate.id]}
                </span>
                <Badge tone={GATE_STATUS_TONES[gate.status]} size="xs">
                  {GATE_STATUS_LABELS[gate.status]}
                </Badge>
              </div>
              {gate.blockers.map((blocker) => (
                <p key={blocker} className="text-xs text-red-600 dark:text-red-400 leading-snug">{blocker}</p>
              ))}
              {gate.conditions.map((condition) => (
                <p key={condition} className="text-xs text-amber-600 dark:text-amber-400 leading-snug">{condition}</p>
              ))}
              {gate.evidenceArtifactIds.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Evidencia: {gate.evidenceArtifactIds.length} artefacto(s)
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {engagement.arbDecisions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Decisiones registradas
          </h4>
          <ul className="space-y-1.5">
            {engagement.arbDecisions.map((decision) => (
              <li key={decision.id} className="flex flex-wrap items-start gap-2 text-sm">
                <Badge tone={REVIEW_VERDICT_TONES[decision.verdict]} size="xs">
                  {REVIEW_VERDICT_LABELS[decision.verdict]}
                </Badge>
                <span className="text-gray-700 dark:text-gray-300">{decision.actor.name}</span>
                {decision.rationale && (
                  <span className="text-gray-500 dark:text-gray-400 basis-full">{decision.rationale}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!decidable && (
        <Alert tone="info">
          El comité decide cuando el entregable termina su ejecución. Estado actual: {engagement.status}.
        </Alert>
      )}

      {decidable && !eligibility.allowed && (
        <Alert tone="warning">
          {eligibility.reason === 'own-engagement'
            ? 'Este entregable lo creaste tú, así que su decisión la firma otro miembro del comité. Es la separación de funciones: quien produce el trabajo no lo aprueba.'
            : 'Solo un miembro del comité puede emitir esta decisión. Es la separación de funciones: quien produce el trabajo no lo aprueba.'}
        </Alert>
      )}

      {decidable && eligibility.allowed && (
        <div className="space-y-2">
          <label htmlFor="arb-rationale" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Motivo de la decisión
          </label>
          <textarea
            id="arb-rationale"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            placeholder="Obligatorio para pedir cambios o rechazar."
          />
          {gateBlocked && (
            <Alert tone="danger">
              Hay quality gates bloqueados. No se puede aprobar el entregable hasta resolverlos.
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="success"
              size="sm"
              disabled={busy || gateBlocked}
              onClick={() => onDecide('approved', rationale)}
            >
              Aprobar entrega
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || rationale.trim().length === 0}
              onClick={() => onDecide('changes-requested', rationale)}
            >
              Pedir cambios
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy || rationale.trim().length === 0}
              onClick={() => onDecide('rejected', rationale)}
            >
              Rechazar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
