import { wrapUntrustedContent } from '../../lib/untrustedContent';

/**
 * Una capa de memoria o contexto como datos vallados (plan de agentes, 17.0).
 *
 * Lo que traen estas capas lo escribió una persona o lo extrajo un modelo de
 * una conversación —que puede citar un documento subido—: aplicarlo es su
 * propósito, obedecerlo como orden no. El encabezado es de la aplicación y va
 * fuera de la valla. La memoria base del agente no pasa por aquí: es la
 * configuración de su comportamiento, igual que la instrucción de su ficha.
 */
export const fencedSection = (header: string, bullets: readonly string[]): string =>
  [header, wrapUntrustedContent(header.replace(/[:(].*$/, '').trim().toLowerCase(), bullets.map((bullet) => `- ${bullet}`).join('\n'))].join('\n');
