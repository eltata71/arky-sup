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

export const EngagementCharterReview: React.FC<EngagementCharterReviewProps> = ({ engagement }) => (
  <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ai">{ENGAGEMENT_KIND_LABELS[engagement.charter.kind]}</Badge>
        <Badge tone="gray" outline>
          {engagement.charter.provenance === 'ai-refined' ? 'Plan refinado con IA' : 'Plan determinista'}
        </Badge>
        <Badge tone="primary" outline>{engagement.charter.deliverables.length} entregables</Badge>
      </div>

      {engagement.charter.objectives.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Objetivos</h3>
          <ul className="list-disc pl-5 space-y-0.5">
            {engagement.charter.objectives.map((objective) => (
              <li key={objective} className="text-sm text-gray-600 dark:text-gray-300">{objective}</li>
            ))}
          </ul>
        </section>
      )}

      {engagement.charter.outOfScope.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fuera de alcance</h3>
          <ul className="list-disc pl-5 space-y-0.5">
            {engagement.charter.outOfScope.map((item) => (
              <li key={item} className="text-sm text-gray-600 dark:text-gray-300">{item}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Artefactos y responsables</h3>
        <ul className="space-y-2">
          {engagement.charter.deliverables.map((deliverable) => (
            <li key={deliverable.templateName}>
              <Card compact className="space-y-1.5">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{deliverable.templateName}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="primary" size="xs" outline>
                    Produce {OFFICE_AGENT_PERSONAS[deliverable.assigneeId].alias}
                  </Badge>
                  <Badge tone="info" size="xs" outline>
                    Revisa {OFFICE_AGENT_PERSONAS[deliverable.reviewerId].alias}
                  </Badge>
                  {deliverable.dependsOnTemplateNames.length > 0 && (
                    <Badge tone="gray" size="xs" outline>
                      Tras {deliverable.dependsOnTemplateNames.join(', ')}
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
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Marcos regulatorios aplicables</h3>
          <div className="flex flex-wrap gap-1.5">
            {engagement.charter.regulatoryDrivers.map((driver) => (
              <Badge key={driver} tone="warning" size="xs" outline>{driver}</Badge>
            ))}
          </div>
        </section>
      )}

      <Alert tone="info">
        Al aprobar, la Oficina ejecuta el plan: cada especialista produce su entregable y otro
        lo revisa antes de continuar. Tú decides al final, en el comité.
      </Alert>
  </>
);

export default EngagementCharterReview;
