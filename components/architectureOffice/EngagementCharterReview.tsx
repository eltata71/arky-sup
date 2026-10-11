import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
/**
 * El charter que la Oficina propone, puesto delante de quien lo aprueba.
 *
 * Salió del diálogo de intake por la razón habitual: eran dos trabajos en un
 * fichero —capturar la solicitud y presentar un plan— y sólo el segundo crece
 * cada vez que el charter aprende a decir algo más.
 *
 * Lo que se ve aquí es lo que el planificador decidió: qué artefactos, quién
 * produce cada uno y **quién lo revisa**, que nunca es el mismo. Esa separación
 * de funciones es la razón de ser de una oficina de arquitectura, así que se
 * muestra antes de aprobar y no se esconde tras un resumen.
 */

import React from 'react';
import { Alert, Badge, Card } from '../ui';
// Por el barril: este fichero es nuevo y el presupuesto de imports profundos
// sólo puede bajar. Lo monta un diálogo que ya se carga de forma perezosa.
import {
  OFFICE_AGENT_PERSONAS,
  type OfficeEngagement,
} from '../../services/architectureOffice';
import { ENGAGEMENT_KIND_LABELS } from './officeUiLabels';

export interface EngagementCharterReviewProps {
  engagement: OfficeEngagement;
}

export const EngagementCharterReview: React.FC<EngagementCharterReviewProps> = ({ engagement }) =>{
  const translateConfig = useUiTranslation(); const t = useUiTranslation(); return  (
  <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ai">{translateConfig(ENGAGEMENT_KIND_LABELS[engagement.charter.kind])}</Badge>
        <Badge tone="gray" outline>
          {engagement.charter.provenance === 'ai-refined' ? t("uiExpr.plan-refinado-con-ia.687e8f") : t("uiExpr.plan-determinista.d03138")}
        </Badge>
        <Badge tone="primary" outline>{engagement.charter.deliverables.length} {t("ui.entregables.20344c")}</Badge>
      </div>

      {engagement.charter.objectives.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("iniPanel.objectives")}</h3>
          <ul className="list-disc pl-5 space-y-0.5">
            {engagement.charter.objectives.map((objective) => (
              <li key={objective} className="text-sm text-gray-600 dark:text-gray-300">{objective}</li>
            ))}
          </ul>
        </section>
      )}

      {engagement.charter.outOfScope.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("ui.fuera-de-alcance.6fae8a")}</h3>
          <ul className="list-disc pl-5 space-y-0.5">
            {engagement.charter.outOfScope.map((item) => (
              <li key={item} className="text-sm text-gray-600 dark:text-gray-300">{item}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("ui.artefactos-y-responsables.8195d6")}</h3>
        <ul className="space-y-2">
          {engagement.charter.deliverables.map((deliverable) => (
            <li key={deliverable.templateName}>
              <Card compact className="space-y-1.5">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{deliverable.templateName}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="primary" size="xs" outline>
                    {t("ui.produce.a05840")} {OFFICE_AGENT_PERSONAS[deliverable.assigneeId].alias}
                  </Badge>
                  <Badge tone="info" size="xs" outline>
                    {t("ui.revisa.37e765")} {OFFICE_AGENT_PERSONAS[deliverable.reviewerId].alias}
                  </Badge>
                  {deliverable.dependsOnTemplateNames.length > 0 && (
                    <Badge tone="gray" size="xs" outline>
                      {t("ui.tras.1d0e50")} {deliverable.dependsOnTemplateNames.join(', ')}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{deliverable.rationale}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {engagement.charter.regulatoryDrivers.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("ui.marcos-regulatorios-aplicabl.e04676")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {engagement.charter.regulatoryDrivers.map((driver) => (
              <Badge key={driver} tone="warning" size="xs" outline>{driver}</Badge>
            ))}
          </div>
        </section>
      )}

      <Alert tone="info">
        {t("ui.al-aprobar-la-oficina-ejecut.b957ca")}
      </Alert>
  </>
); };

export default EngagementCharterReview;
