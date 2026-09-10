/**
 * La propuesta del asistente, mostrada para que alguien la revise.
 *
 * Vivía dentro de `InitiativeIntakeWizard`, y sacarla no es cosmética: el
 * diálogo tenía dos trabajos —capturar la necesidad y presentar un borrador— y
 * el segundo es el que crece cada vez que el asistente aprende a proponer algo
 * más. Aquí crece sin empujar al primero contra su techo de tamaño.
 *
 * La regla que renderiza este fichero es la del producto: **nada se acepta en
 * silencio**. Cada bloque se ve antes de crear nada, la propuesta entera se
 * puede descartar, y lo que el asistente no supo deducir aparece como preguntas
 * abiertas en vez de como un campo rellenado a la ligera.
 */

import React from 'react';
import { Alert, Badge } from '../ui';
import { Sparkles } from 'lucide-react';
import { RISK_LEVEL_LABELS } from './initiativeUiLabels';
import type { InitiativeDraft } from '../../services/ai';

export interface InitiativeDraftReviewProps {
  /** `null` cuando el asistente no propuso nada o el usuario lo descartó. */
  draft: InitiativeDraft | null;
}

export const InitiativeDraftReview: React.FC<InitiativeDraftReviewProps> = ({ draft }) => (
  <>
            {draft ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge tone="ai" size="xs">
                    <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                    Propuesta del asistente
                  </Badge>
                  <span className="text-2xs text-gray-500 dark:text-gray-400">
                    Podrás editar cada sección después de crearla.
                  </span>
                </div>

                {draft.driver && (
                  <DraftBlock title="Driver / motivación">
                    <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{draft.driver}</p>
                  </DraftBlock>
                )}

                {draft.objectives.length > 0 && (
                  <DraftBlock title="Objetivos">
                    <DraftList items={draft.objectives} />
                  </DraftBlock>
                )}

                {draft.outcomes.length > 0 && (
                  <DraftBlock title="Resultados esperados">
                    <ul className="space-y-1.5">
                      {draft.outcomes.map((outcome) => (
                        <li key={outcome.statement} className="text-sm text-gray-700 dark:text-gray-200">
                          {outcome.statement}
                          {outcome.measure && (
                            <span className="block text-2xs text-gray-500 dark:text-gray-400">
                              Se evidencia con: {outcome.measure}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </DraftBlock>
                )}

                {draft.kpis.length > 0 && (
                  <DraftBlock title="Indicadores propuestos">
                    <ul className="space-y-1">
                      {draft.kpis.map((kpi) => (
                        <li key={kpi.name} className="flex flex-wrap items-baseline gap-2 text-sm text-gray-700 dark:text-gray-200">
                          <span className="font-medium">{kpi.name}</span>
                          <span className="text-2xs text-gray-500 dark:text-gray-400">
                            {kpi.unit}
                            {kpi.baseline !== undefined && ` · base ${kpi.baseline}`}
                            {kpi.target !== undefined && ` · meta ${kpi.target}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </DraftBlock>
                )}

                {draft.affectedCapabilities.length > 0 && (
                  <DraftBlock title="Capacidades de negocio afectadas">
                    <div className="flex flex-wrap gap-1.5">
                      {draft.affectedCapabilities.map((capability) => (
                        <Badge key={capability} tone="info" size="xs" outline>{capability}</Badge>
                      ))}
                    </div>
                  </DraftBlock>
                )}

                {draft.risks.length > 0 && (
                  <DraftBlock title="Riesgos identificados">
                    <ul className="space-y-1.5">
                      {draft.risks.map((risk) => (
                        <li key={risk.description} className="flex items-start gap-2 text-sm">
                          <Badge tone={risk.level === 'low' ? 'gray' : risk.level === 'medium' ? 'warning' : 'danger'} size="xs">
                            {RISK_LEVEL_LABELS[risk.level]}
                          </Badge>
                          <span className="text-gray-700 dark:text-gray-200">{risk.description}</span>
                        </li>
                      ))}
                    </ul>
                  </DraftBlock>
                )}

                {draft.regulatoryDrivers.length > 0 && (
                  <DraftBlock title="Marco regulatorio">
                    <div className="flex flex-wrap gap-1.5">
                      {draft.regulatoryDrivers.map((driver) => (
                        <Badge key={driver} tone="warning" size="xs" outline>{driver}</Badge>
                      ))}
                    </div>
                  </DraftBlock>
                )}

                {draft.openQuestions.length > 0 && (
                  <Alert tone="info" title="Lo que hace falta preguntarle al negocio">
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {draft.openQuestions.map((question) => (
                        <li key={question} className="text-sm">{question}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </>
            ) : (
              <Alert tone="info">
                La iniciativa se creará con lo capturado. Podrás completar driver, objetivos,
                resultados, indicadores y documentos desde su ficha.
              </Alert>
            )}
  </>
);

const DraftBlock: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
    <p className="mb-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
      {title}
    </p>
    {children}
  </div>
);

const DraftList: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-1">
    {items.map((item) => (
      <li key={item} className="flex gap-2 text-sm text-gray-700 dark:text-gray-200">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden />
        <span className="leading-relaxed">{item}</span>
      </li>
    ))}
  </ul>
);

export default InitiativeDraftReview;
