/**
 * Qué no puede perder un artefacto cuando la IA lo reescribe (plan de calidad
 * de artefactos, ola 7.1a).
 *
 * Había tres políticas y ninguna coincidía. El refinamiento rechazaba perder
 * una sección, una tabla, una fila o más del 45 % del texto útil; el ejecutor
 * del agente sólo rechazaba encoger por debajo del 35 %, y a partir de 800
 * caracteres; y el chat —el camino más usado— no rechazaba nada salvo una
 * respuesta vacía o idéntica. La misma reescritura se guardaba o se descartaba
 * según el botón que la pidió.
 *
 * Ahora hay una regla y la aplican los tres. Vive en una hoja porque es un
 * análisis de texto sin dependencias que necesitan `services/agent`,
 * `services/artifacts` y la capa de IA por igual.
 *
 * Una petición que pide quitar algo («elimina la sección de riesgos»,
 * «resume el documento») es trabajo legítimo, no una pérdida: con
 * `permitsRemoval` dejan de contar las secciones, tablas y filas perdidas, y el
 * encogimiento tolerado baja al 35 %. Lo que nunca se tolera es vaciar el
 * artefacto ni introducir texto de relleno.
 */

export type ContentPreservationMode = 'document' | 'hybrid' | 'diagram';

export interface ContentPreservationOptions {
  mode: ContentPreservationMode;
  /** La persona pidió quitar o condensar contenido de forma explícita. */
  permitsRemoval?: boolean;
}

export type ContentPreservationViolation =
  | 'empty'
  | 'drastic-shrink'
  | 'lost-sections'
  | 'lost-tables'
  | 'lost-table-rows'
  | 'new-placeholders';

export type ContentPreservationVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly violation: ContentPreservationViolation; readonly reason: string };

export const CONTENT_PRESERVATION_THRESHOLDS = Object.freeze({
  /** Por debajo de este texto útil el encogimiento no se mide: no hay nada que perder. */
  minBaselineUsefulChars: 200,
  /** Fracción mínima del texto útil que debe sobrevivir. */
  minRetainedRatio: 0.55,
  /** La misma fracción cuando la persona pidió quitar o condensar. */
  minRetainedRatioWhenRemovalPermitted: 0.35,
});

const REMOVAL_INSTRUCTION =
  /\b(elimin\w*|quit\w*|borr\w*|suprim\w*|remuev\w*|remov\w*|recort\w*|resum\w*|acort\w*|condens\w*|simplific\w*|sintetiz\w*|reduc\w*|delete\w*|drop\w*|shorten\w*|summari[sz]\w*|trim\w*|condense\w*)\b/i;

/** Si una instrucción pide quitar o condensar contenido. */
export const instructionPermitsRemoval = (instruction: string | undefined | null): boolean =>
  REMOVAL_INSTRUCTION.test(instruction ?? '');

const MERMAID_FENCE = /```mermaid\s*[\s\S]*?```/gi;

/** Longitud del texto útil: sin bloques de diagrama, comentarios ni marcas. */
export const usefulTextLength = (content: string): number =>
  content
    .replace(MERMAID_FENCE, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/%%\s*arky:skeleton-fallback/gi, '')
    .trim().length;

/** Encabezados Markdown, normalizados para compararlos. */
export const extractMarkdownHeadings = (content: string): string[] =>
  (content.match(/^#{1,6}\s+.+$/gm) ?? []).map((heading) => heading.replace(/^#+\s+/, '').trim().toLowerCase());

/** Tablas Markdown, contadas por su fila delimitadora (`| --- | --- |`). */
export const countMarkdownTables = (content: string): number =>
  (content.match(/^\s*\|?[ :|]*-{3,}[ :|-]*\|?\s*$/gm) ?? []).length;

/** Filas de tabla Markdown (cabecera y delimitador incluidos: la comparación es relativa). */
export const countMarkdownTableRows = (content: string): number =>
  (content.match(/^\s*\|.*\|\s*$/gm) ?? []).length;

/** Relleno genérico que una reescritura nunca puede introducir. */
export const countGenericPlaceholders = (content: string): number =>
  (content.match(/empresa x|sistema legacy|lorem ipsum|\[placeholder\]|insertar aquí|completar aquí|xxxxx/gi) ?? []).length;

const reject = (violation: ContentPreservationViolation, reason: string): ContentPreservationVerdict =>
  ({ ok: false, violation, reason });

/**
 * Compara una reescritura con el contenido que sustituye. Los diagramas sólo se
 * miden por vaciado y encogimiento: su estructura la vigila el IR, no el texto.
 */
export function checkContentPreservation(
  baseline: string,
  candidate: string,
  options: ContentPreservationOptions,
): ContentPreservationVerdict {
  if (!candidate.trim()) return reject('empty', 'La reescritura propuesta está vacía.');

  const permitsRemoval = options.permitsRemoval === true;
  const baselineUseful = usefulTextLength(baseline);
  const candidateUseful = usefulTextLength(candidate);
  const minRatio = permitsRemoval
    ? CONTENT_PRESERVATION_THRESHOLDS.minRetainedRatioWhenRemovalPermitted
    : CONTENT_PRESERVATION_THRESHOLDS.minRetainedRatio;
  if (baselineUseful >= CONTENT_PRESERVATION_THRESHOLDS.minBaselineUsefulChars && candidateUseful < baselineUseful * minRatio) {
    return reject(
      'drastic-shrink',
      `La reescritura reduce drásticamente el contenido útil (${candidateUseful} < ${Math.round(minRatio * 100)}% de ${baselineUseful} caracteres); se descarta para evitar pérdida de contenido.`,
    );
  }

  if (options.mode !== 'diagram' && !permitsRemoval) {
    const candidateHeadings = new Set(extractMarkdownHeadings(candidate));
    const lostHeadings = [...new Set(extractMarkdownHeadings(baseline))].filter((heading) => !candidateHeadings.has(heading));
    if (lostHeadings.length > 0) {
      return reject('lost-sections', `La reescritura elimina secciones existentes (${lostHeadings.slice(0, 3).join(', ')}).`);
    }
    const baselineTables = countMarkdownTables(baseline);
    if (countMarkdownTables(candidate) < baselineTables) {
      return reject('lost-tables', 'La reescritura elimina tablas Markdown existentes.');
    }
    if (baselineTables > 0 && countMarkdownTableRows(candidate) < countMarkdownTableRows(baseline)) {
      return reject('lost-table-rows', 'La reescritura reduce filas de las tablas existentes.');
    }
  }

  if (countGenericPlaceholders(candidate) > countGenericPlaceholders(baseline)) {
    return reject('new-placeholders', 'La reescritura introduce placeholders genéricos.');
  }
  return { ok: true };
}
