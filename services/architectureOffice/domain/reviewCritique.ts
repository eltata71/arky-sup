/**
 * La crítica del revisor como contrato con forma (plan de agentes, 18.1).
 *
 * Hasta ahora la crítica del revisor se leía con un *cast* silencioso: lo que
 * el modelo devolvía entraba a `OfficeRunnerAdapters` como `unknown` y el
 * adaptador decidía campo a campo con guardas sueltas. Aquí la forma es un
 * contrato del dominio, leído con la misma tolerancia que los de la
 * orquestación (18.0) —se queda con lo válido y nombra lo descartado— porque
 * un esquema pedido no es un esquema cumplido.
 *
 * La diferencia con los contratos de la orquestación es que el veredicto del
 * revisor decide una tarea: sin veredicto legible no hay revisión (17.1), y
 * una severidad fuera del vocabulario no puede quedarse con la del modelo.
 * Todo es puro: sin E/S, sin modelo. El esquema que se le pide al modelo vive
 * en `application/orchestrationSchemas.ts`.
 */

import type { OfficeFindingSeverity } from './OfficeTypes';

/** La forma que se le pide al revisor. `criterion` es el criterio numerado incumplido. */
export interface ReviewCritique {
  verdict: 'approved' | 'changes-requested' | 'rejected';
  summary: string;
  findings: ReviewCritiqueFinding[];
}

export interface ReviewCritiqueFinding {
  severity: OfficeFindingSeverity;
  message: string;
  /** El criterio de aceptación numerado que el hallazgo declara incumplido, si lo hay. */
  criterion?: number;
  evidence?: string;
}

/** Lo que se leyó y lo que no: `value` es `null` cuando no quedó nada utilizable. */
export interface ContractReading<T> {
  value: T | null;
  /** Una frase por cada cosa descartada o ausente. Vacío = lectura limpia. */
  discarded: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const VERDICTS: readonly ReviewCritique['verdict'][] = ['approved', 'changes-requested', 'rejected'];
const SEVERITIES: readonly OfficeFindingSeverity[] = ['critical', 'high', 'medium', 'low'];

/**
 * Lee la respuesta del modelo como salida no confiable y nombra lo que
 * descarta. Un objeto sin veredicto legible vale `null`: la revisión entonces
 * es `evidence-only` (17.1), nunca una aprobación silenciosa.
 */
export const readReviewCritique = (raw: unknown): ContractReading<ReviewCritique> => {
  const discarded: string[] = [];
  if (!isRecord(raw)) return { value: null, discarded: ['La respuesta no era un objeto.'] };

  const verdict = VERDICTS.find((candidate) => candidate === text(raw.verdict).toLowerCase());
  if (!verdict) return { value: null, discarded: ['Falta un «verdict» approved, changes-requested o rejected.'] };

  const findings: ReviewCritiqueFinding[] = [];
  if (raw.findings !== undefined && raw.findings !== null && !Array.isArray(raw.findings)) {
    discarded.push('«findings» no era una lista.');
  }
  for (const item of Array.isArray(raw.findings) ? raw.findings : []) {
    if (!isRecord(item)) { discarded.push('«findings»: una entrada sin forma de objeto.'); continue; }
    const message = text(item.message);
    if (!message) { discarded.push('«findings»: un hallazgo sin texto.'); continue; }
    const severity = SEVERITIES.find((candidate) => candidate === item.severity);
    if (!severity) {
      discarded.push(`«findings»: severidad fuera del vocabulario en «${message.slice(0, 40)}»; el hallazgo se descarta.`);
      continue;
    }
    // El criterio numerado es opcional, pero lo que llega tiene que ser un
    // número entero positivo: «criterio 2» como texto no viaja al campo.
    const criterion = typeof item.criterion === 'number' && Number.isInteger(item.criterion) && item.criterion >= 1
      ? item.criterion
      : undefined;
    if (item.criterion !== undefined && item.criterion !== null && criterion === undefined) {
      discarded.push(`«findings»: el criterio de «${message.slice(0, 40)}» no era un número; se pierde la referencia.`);
    }
    findings.push({
      severity,
      message,
      ...(criterion !== undefined ? { criterion } : {}),
      ...(text(item.evidence) ? { evidence: text(item.evidence) } : {}),
    });
  }

  const summary = text(raw.summary);
  if (!summary) discarded.push('Falta «summary».');

  return {
    value: { verdict, summary, findings },
    discarded,
  };
};

/**
 * El texto que ve la persona, compuesto desde el objeto —nunca al revés (18.0).
 * Con criterio numerado, lo lleva: es la única forma en que el productor
 * sepa qué corregir exactamente.
 */
export const renderReviewCritique = (critique: ReviewCritique): string => {
  const VERDICT_LABEL: Record<ReviewCritique['verdict'], string> = {
    approved: 'Aprobado',
    'changes-requested': 'Cambios solicitados',
    rejected: 'Rechazado',
  };
  return [
    `Veredicto: ${VERDICT_LABEL[critique.verdict]}`,
    '',
    critique.summary,
    ...critique.findings.map((finding) =>
      `- [${finding.severity}] ${finding.message}${finding.criterion ? ` (criterio ${finding.criterion})` : ''}${finding.evidence ? ` — evidencia: ${finding.evidence}` : ''}`),
  ].join('\n').trim();
};
