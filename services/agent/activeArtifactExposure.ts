/**
 * Cuánto ve el modelo del artefacto abierto cuando puede reescribirlo (plan de
 * calidad de artefactos, 7.1b).
 *
 * El compositor recortaba el artefacto activo a 1 800 caracteres y, en el mismo
 * turno, `modifyArtifact` pedía «el contenido completo». En un documento más
 * largo el modelo devolvía un documento entero escrito sin haber visto el
 * final. La política de conservación (7.1a) evita que ese resultado se guarde;
 * esto evita que se produzca.
 *
 * La regla tiene dos ramas y ninguna es un recorte a ciegas:
 * - **Cabe**: va entero, cercado como contenido externo, y la herramienta se
 *   ofrece.
 * - **No cabe**: va su índice de secciones y el comienzo, se dice por qué, y la
 *   herramienta **no** se ofrece. Pedir una reescritura completa de lo que no se
 *   puede enseñar entero es pedirle al modelo que invente el resto.
 */
import type { Artifact } from '../../lib/artifacts';
import { extractMarkdownHeadings } from '../../lib/artifacts';
import { wrapUntrustedContent } from '../../lib/untrustedContent';

/** Hasta dónde se enseña un artefacto entero para poder reescribirlo (≈ 10 000 tokens). */
export const ARTIFACT_REWRITE_CONTENT_CAP = 40_000;

/** Si el artefacto abierto puede enseñarse entero y, por tanto, reescribirse entero. */
export const artifactFitsWholeRewrite = (
  artifact: Pick<Artifact, 'content'> | null | undefined,
  cap: number = ARTIFACT_REWRITE_CONTENT_CAP,
): boolean => artifact != null && (artifact.content ?? '').trim().length <= cap;

/** Por qué un artefacto no se reescribe entero desde el chat. */
export const describeRewriteRefusal = (length: number, cap: number = ARTIFACT_REWRITE_CONTENT_CAP): string =>
  `El artefacto tiene ${length} caracteres y el límite para reescribirlo entero es ${cap}: `
  + 'pide el cambio sobre una sección concreta.';

export interface ActiveArtifactContentOptions {
  /** Caracteres del comienzo que se enseñan cuando el artefacto no cabe entero. */
  excerptCap: number;
  rewriteCap?: number;
}

/** El bloque «contenido actual» del artefacto abierto, entero o como índice y comienzo. */
export function describeActiveArtifactContent(content: string, options: ActiveArtifactContentOptions): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  const rewriteCap = options.rewriteCap ?? ARTIFACT_REWRITE_CONTENT_CAP;
  if (trimmed.length <= rewriteCap) {
    return [
      'Contenido actual (completo). Si lo modificas con modifyArtifact, devuélvelo ENTERO: conserva cada sección, tabla y fila que no se te pidió cambiar.',
      wrapUntrustedContent('artefacto activo', trimmed),
    ].join('\n');
  }
  const headings = extractMarkdownHeadings(trimmed);
  return [
    `Contenido actual (parcial). ${describeRewriteRefusal(trimmed.length, rewriteCap)} No uses modifyArtifact en este turno.`,
    ...(headings.length > 0 ? ['Índice de secciones:', ...headings.map((heading) => `- ${heading}`)] : []),
    wrapUntrustedContent('comienzo del artefacto activo', `${trimmed.slice(0, options.excerptCap)}\n[…contenido truncado para el contexto…]`),
  ].join('\n');
}
