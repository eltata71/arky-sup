/**
 * Los contratos de la orquestación (plan de agentes, 18.0).
 *
 * Lucía, los especialistas y Alejandro se pasaban prosa. El evaluador de la
 * consolidación buscaba palabras sueltas en ella y el panel no podía mostrar un
 * veredicto porque no había veredicto: había un párrafo. Aquí cada traspaso es
 * un objeto con forma, leído de forma tolerante —se queda con lo válido y
 * nombra lo que descartó— y el texto que ve la persona se **compone** desde el
 * objeto, nunca al revés.
 *
 * Todo es puro: sin E/S, sin modelo. El esquema que se le pide al modelo vive
 * en `application/orchestrationSchemas.ts`.
 */

import { OFFICE_AGENT_PERSONAS } from './officeAgentPersonas';
import type { OfficeWorkstreamResult } from './officeConsolidationReview';

export type FindingSeverity = 'low' | 'medium' | 'high';
export type RecommendationVerdict = 'ready' | 'conditional' | 'blocked';
export type ContributionUse = 'used' | 'discarded';

export interface SpecialistFinding { text: string; severity: FindingSeverity }
export interface SpecialistOutOfScope { text: string; belongsTo: string }

export interface SpecialistAnalysis {
  summary: string;
  findings: SpecialistFinding[];
  assumptions: string[];
  risks: string[];
  decisions: string[];
  outOfScope: SpecialistOutOfScope[];
  evidence: string[];
  confidence: 'low' | 'medium' | 'high' | null;
}

export interface RecommendationContribution {
  agent: string;
  use: ContributionUse;
  note: string;
}

export interface RecommendationContradiction { text: string; owner: string }

export interface Recommendation {
  verdict: RecommendationVerdict;
  rationale: string;
  contributions: RecommendationContribution[];
  contradictions: RecommendationContradiction[];
  conditions: string[];
  openQuestions: string[];
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

const textList = (value: unknown, field: string, discarded: string[]): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) { discarded.push(`«${field}» no era una lista.`); return []; }
  const kept = value.map(text).filter((item) => item.length > 0);
  if (kept.length < value.length) discarded.push(`«${field}»: ${value.length - kept.length} entrada(s) vacía(s) o no textuales.`);
  return kept;
};

const objectList = (value: unknown, field: string, discarded: string[]): Record<string, unknown>[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) { discarded.push(`«${field}» no era una lista.`); return []; }
  const kept = value.filter(isRecord);
  if (kept.length < value.length) discarded.push(`«${field}»: ${value.length - kept.length} entrada(s) sin forma de objeto.`);
  return kept;
};

const SEVERITIES: readonly FindingSeverity[] = ['low', 'medium', 'high'];
const VERDICTS: readonly RecommendationVerdict[] = ['ready', 'conditional', 'blocked'];

export const readSpecialistAnalysis = (raw: unknown): ContractReading<SpecialistAnalysis> => {
  const discarded: string[] = [];
  if (!isRecord(raw)) return { value: null, discarded: ['La respuesta no era un objeto.'] };
  const summary = text(raw.summary);
  if (!summary) discarded.push('Falta «summary».');
  const findings: SpecialistFinding[] = [];
  for (const item of objectList(raw.findings, 'findings', discarded)) {
    const findingText = text(item.text);
    if (!findingText) { discarded.push('«findings»: un hallazgo sin texto.'); continue; }
    const severity = SEVERITIES.find((candidate) => candidate === item.severity);
    if (!severity) discarded.push(`«findings»: severidad fuera del vocabulario en «${findingText.slice(0, 40)}»; se toma «medium».`);
    findings.push({ text: findingText, severity: severity ?? 'medium' });
  }
  const outOfScope: SpecialistOutOfScope[] = [];
  for (const item of objectList(raw.outOfScope, 'outOfScope', discarded)) {
    const scopeText = text(item.text);
    if (!scopeText) { discarded.push('«outOfScope»: una entrada sin texto.'); continue; }
    const belongsTo = text(item.belongsTo);
    if (!belongsTo) discarded.push(`«outOfScope»: «${scopeText.slice(0, 40)}» no dice a quién pertenece.`);
    outOfScope.push({ text: scopeText, belongsTo });
  }
  const confidence = (['low', 'medium', 'high'] as const).find((candidate) => candidate === raw.confidence) ?? null;
  const value: SpecialistAnalysis = {
    summary,
    findings,
    assumptions: textList(raw.assumptions, 'assumptions', discarded),
    risks: textList(raw.risks, 'risks', discarded),
    decisions: textList(raw.decisions, 'decisions', discarded),
    outOfScope,
    evidence: textList(raw.evidence, 'evidence', discarded),
    confidence,
  };
  const hasContent = summary || findings.length > 0 || value.risks.length > 0 || value.decisions.length > 0;
  return { value: hasContent ? value : null, discarded };
};

export const readRecommendation = (raw: unknown): ContractReading<Recommendation> => {
  const discarded: string[] = [];
  if (!isRecord(raw)) return { value: null, discarded: ['La respuesta no era un objeto.'] };
  const verdict = VERDICTS.find((candidate) => candidate === text(raw.verdict).toLowerCase());
  if (!verdict) return { value: null, discarded: ['Falta un «verdict» ready, conditional o blocked.'] };
  const rationale = text(raw.rationale);
  if (!rationale) discarded.push('Falta «rationale».');
  const contributions: RecommendationContribution[] = [];
  for (const item of objectList(raw.contributions, 'contributions', discarded)) {
    const agent = text(item.agent);
    if (!agent) { discarded.push('«contributions»: una entrada sin agente.'); continue; }
    const use = item.use === 'discarded' ? 'discarded' : 'used';
    contributions.push({ agent, use, note: text(item.note) });
  }
  const contradictions: RecommendationContradiction[] = [];
  for (const item of objectList(raw.contradictions, 'contradictions', discarded)) {
    const contradiction = text(item.text);
    if (!contradiction) { discarded.push('«contradictions»: una entrada sin texto.'); continue; }
    const owner = text(item.owner);
    if (!owner) discarded.push(`«contradictions»: «${contradiction.slice(0, 40)}» no tiene responsable.`);
    contradictions.push({ text: contradiction, owner });
  }
  return {
    value: {
      verdict,
      rationale,
      contributions,
      contradictions,
      conditions: textList(raw.conditions, 'conditions', discarded),
      openQuestions: textList(raw.openQuestions, 'openQuestions', discarded),
    },
    discarded,
  };
};

const VERDICT_LABEL: Record<RecommendationVerdict, string> = { ready: 'Ready', conditional: 'Conditional', blocked: 'Blocked' };
export const verdictLabel = (verdict: RecommendationVerdict): string => VERDICT_LABEL[verdict];

const bullets = (title: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : ['', `**${title}**`, ...items.map((item) => `- ${item}`)];

export const renderSpecialistAnalysis = (analysis: SpecialistAnalysis): string => [
  analysis.summary,
  ...bullets('Hallazgos', analysis.findings.map((f) => `[${f.severity}] ${f.text}`)),
  ...bullets('Supuestos', analysis.assumptions),
  ...bullets('Riesgos', analysis.risks),
  ...bullets('Decisiones', analysis.decisions),
  ...bullets('Fuera de mi alcance', analysis.outOfScope.map((o) => (o.belongsTo ? `${o.text} → ${o.belongsTo}` : o.text))),
  ...bullets('Evidencia', analysis.evidence),
  ...(analysis.confidence ? ['', `Confianza: ${analysis.confidence}`] : []),
].join('\n').trim();

export const renderRecommendation = (recommendation: Recommendation): string => [
  `**Veredicto: ${verdictLabel(recommendation.verdict)}**`,
  '',
  recommendation.rationale,
  ...bullets('Aportes', recommendation.contributions.map((c) =>
    `${c.agent} (${c.use === 'used' ? 'usado' : 'descartado'})${c.note ? `: ${c.note}` : ''}`)),
  ...bullets('Contradicciones', recommendation.contradictions.map((c) =>
    c.owner ? `${c.text} — responsable: ${c.owner}` : c.text)),
  ...bullets('Condiciones', recommendation.conditions),
  ...bullets('Preguntas abiertas', recommendation.openQuestions),
].join('\n').trim();

/** Qué exige el evaluador sobre una recomendación leída como objeto. */
export const evaluateRecommendationFields = (
  recommendation: Recommendation,
  results: readonly OfficeWorkstreamResult[],
): string[] => {
  const gaps: string[] = [];
  if (!recommendation.rationale) gaps.push('Escribe la justificación del veredicto en «rationale».');
  const cited = recommendation.contributions.map((c) => c.agent.toLowerCase());
  const uncited = results
    .filter((r) => r.status === 'completed')
    .map((r) => OFFICE_AGENT_PERSONAS[r.personaId].alias)
    .filter((alias) => !cited.some((agent) => agent.includes(alias.toLowerCase())));
  if (uncited.length > 0) gaps.push(`Declara en «contributions» si usaste o descartaste a ${uncited.join(', ')}, y por qué.`);
  const ownerless = recommendation.contradictions.filter((c) => !c.owner);
  if (ownerless.length > 0) gaps.push('Cada contradicción necesita un responsable en «owner».');
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0 && recommendation.verdict === 'ready') {
    gaps.push(`${failed.length} especialista(s) no entregaron: la recomendación no puede ser Ready sin declarar la parcialidad en «conditions» o «openQuestions».`);
  } else if (failed.length > 0 && recommendation.conditions.length + recommendation.openQuestions.length === 0) {
    gaps.push(`Declara en «openQuestions» que ${failed.length} especialista(s) no entregaron: la recomendación es parcial.`);
  }
  return gaps;
};
