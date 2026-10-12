import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
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
import { OFFICE_GATE_LABELS } from '../../services/architectureOffice/domain/officeQualityGates';
import type {
  OfficeArbVerdict,
  OfficeEngagement,
} from '../../services/architectureOffice';
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
  const translateConfig = useUiTranslation();
  const t = useUiTranslation();
  const [rationale, setRationale] = useState('');
  const assessment = engagement.gateAssessment;
  const decidable = engagement.status === 'awaiting-arb' || engagement.status === 'blocked';
  const gateBlocked = assessment?.overallStatus === 'blocked';

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("ui.comite-de-arquitectura.36c4d6")}</CardTitle>
        <div className="flex items-center gap-2">
          {assessment && (
            <Badge tone={GATE_STATUS_TONES[assessment.overallStatus]}>
              {t("ui.gates.c632ff")} {translateConfig(GATE_STATUS_LABELS[assessment.overallStatus])}
            </Badge>
          )}
          <Button variant="ghost" size="xs" onClick={onReevaluateGates} disabled={busy}>
            {t("ui.reevaluar-gates.59ba41")}
          </Button>
        </div>
      </div>

      {!assessment && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("ui.todavia-no-se-han-evaluado-l.7569a4")}
        </p>
      )}

      {assessment && (
        <ul className="space-y-2" aria-label={t("ui.quality-gates.aaca96")}>
          {assessment.gates.map((gate) => (
            <li key={gate.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {translateConfig(OFFICE_GATE_LABELS[gate.id])}
                </span>
                <Badge tone={GATE_STATUS_TONES[gate.status]} size="xs">
                  {translateConfig(GATE_STATUS_LABELS[gate.status])}
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
                  {t("ui.evidencia.a81e75")} {gate.evidenceArtifactIds.length} {t("ui.artefacto-s.d919fa")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {engagement.arbDecisions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("ui.decisiones-registradas.f7a3b1")}
          </h4>
          <ul className="space-y-1.5">
            {engagement.arbDecisions.map((decision) => (
              <li key={decision.id} className="flex flex-wrap items-start gap-2 text-sm">
                <Badge tone={REVIEW_VERDICT_TONES[decision.verdict]} size="xs">
                  {translateConfig(REVIEW_VERDICT_LABELS[decision.verdict])}
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
          {t("ui.el-comite-decide-cuando-el-e.e07f07")} {engagement.status}.
        </Alert>
      )}

      {decidable && !eligibility.allowed && (
        <Alert tone="warning">
          {eligibility.reason === 'own-engagement'
            ? t("uiExpr.este-entregable-lo-creaste-t.662837")
            : t("uiExpr.solo-un-miembro-del-comite-p.97e936")}
        </Alert>
      )}

      {decidable && eligibility.allowed && (
        <div className="space-y-2">
          <label htmlFor="arb-rationale" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("ui.motivo-de-la-decision.f285d0")}
          </label>
          <textarea
            id="arb-rationale"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            placeholder={t("ui.obligatorio-para-pedir-cambi.a5b12a")}
          />
          {gateBlocked && (
            <Alert tone="danger">
              {t("ui.hay-quality-gates-bloqueados.862de4")}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="success"
              size="sm"
              disabled={busy || gateBlocked}
              onClick={() => onDecide('approved', rationale)}
            >
              {t("ui.aprobar-entrega.253023")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || rationale.trim().length === 0}
              onClick={() => onDecide('changes-requested', rationale)}
            >
              {t("ui.pedir-cambios.eaab76")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy || rationale.trim().length === 0}
              onClick={() => onDecide('rejected', rationale)}
            >
              {t("ui.rechazar.2b004c")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
