/**
 * El evaluador de la consolidación — la mitad barata de un ciclo
 * evaluador-optimizador.
 *
 * Anthropic describe el patrón así: un agente produce, otro evalúa contra
 * criterios claros, y el productor corrige una vez con esa evaluación delante.
 * El patrón vale la pena cuando los criterios son explícitos y la corrección
 * mide algo. Aquí lo son, y por eso el evaluador **no llama a ningún modelo**:
 * las cuatro cosas que tiene que comprobar son mecánicas, y un segundo modelo
 * juzgando al primero costaría otra llamada para responder algo que una función
 * pura contesta con certeza.
 *
 * Lo que se exige de una recomendación de la Oficina:
 *
 *  1. **Un veredicto.** Ready, Conditional o Blocked. Un texto que describe el
 *     problema sin decidir nada obliga al lector a decidir por su cuenta, que
 *     es exactamente el trabajo que había delegado.
 *  2. **Que cite a quien trabajó.** Si Carmen analizó cumplimiento y la
 *     recomendación no la menciona, o no leyó su análisis o lo descartó en
 *     silencio; las dos cosas hay que verlas.
 *  3. **Que reconozca lo que falta.** Cuando un especialista no entregó, una
 *     recomendación que no lo dice se presenta como completa sin serlo.
 *  4. **Que diga algo.** Un párrafo de cortesía no es una consolidación.
 *
 * El límite de una sola corrección es deliberado: un bucle sin tope es la
 * forma más cara de no converger, y la segunda pasada ya tiene toda la
 * información que va a tener.
 */

import { OFFICE_AGENT_PERSONAS } from './officeAgentPersonas';
import type { OfficeAgentId } from './agentDefinition';

/**
 * Lo que devuelve un especialista de la orquestación. Vivía en
 * `application/officeOrchestration.ts` y esta revisión —dominio— lo importaba
 * de ahí: el dominio dependía de la aplicación (F6-03, corte 4, al añadir la
 * regla de dirección a `contextDomainPurity`).
 */
export interface OfficeWorkstreamResult {
  workstreamId: string;
  personaId: OfficeAgentId;
  status: 'completed' | 'failed';
  output: string;
  error?: string;
}

/** Longitud por debajo de la cual el texto no puede estar consolidando nada. */
export const MIN_CONSOLIDATION_LENGTH = 200;

const VERDICT_PATTERN = /\b(ready|conditional|blocked|listo|condicional|bloquead[oa])\b/i;
const ACKNOWLEDGES_GAP = /\b(no (pudo|entreg|complet)|parcial|sin resultado|falt[óo]|pendiente)\b/i;

export interface ConsolidationReview {
  ok: boolean;
  /** Lo que falta, en el imperativo con el que se le pide la corrección. */
  gaps: string[];
}

export const evaluateConsolidation = (
  consolidation: string,
  results: readonly OfficeWorkstreamResult[],
): ConsolidationReview => {
  const text = consolidation.trim();
  const gaps: string[] = [];

  if (text.length < MIN_CONSOLIDATION_LENGTH) {
    gaps.push('Desarrolla la recomendación: hoy es demasiado breve para consolidar varios dominios.');
  }
  if (!VERDICT_PATTERN.test(text)) {
    gaps.push('Cierra con un veredicto explícito: Ready, Conditional o Blocked.');
  }

  const completed = results.filter((result) => result.status === 'completed');
  const uncited = completed
    .map((result) => OFFICE_AGENT_PERSONAS[result.personaId].alias)
    .filter((alias) => !text.toLowerCase().includes(alias.toLowerCase()));
  if (uncited.length > 0) {
    gaps.push(`Cita el aporte de ${uncited.join(', ')}: analizaron su dominio y su análisis no aparece.`);
  }

  const failed = results.filter((result) => result.status === 'failed');
  if (failed.length > 0 && !ACKNOWLEDGES_GAP.test(text)) {
    gaps.push(`Di explícitamente que ${failed.length} especialista(s) no entregaron: la recomendación es parcial.`);
  }

  return { ok: gaps.length === 0, gaps };
};

/** Lo que se le pide al consolidador en la única pasada de corrección. */
export const buildConsolidationRefinementPrompt = (
  consolidation: string,
  review: ConsolidationReview,
): string => [
  'Tu consolidación no cumple todavía los criterios de la Oficina. Corrígela.',
  '',
  'QUÉ FALTA:',
  ...review.gaps.map((gap) => `- ${gap}`),
  '',
  'TU TEXTO ACTUAL:',
  consolidation,
  '',
  'Devuelve la recomendación corregida completa, no un comentario sobre ella.',
  'No inventes evidencia para rellenar un hueco: si algo no lo sabes, dilo como condición.',
].join('\n');
