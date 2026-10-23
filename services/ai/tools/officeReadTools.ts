/**
 * Herramientas de lectura del Despacho (plan de agentes 19.0, corte 2).
 *
 * Cada herramienta lee a través de un **puerto** que esta capa declara y el
 * contexto dueño del dato implementa: aquí no se importa ningún contexto, y
 * ninguna herramienta llega a la red por su cuenta. Las respuestas son
 * compactas y llevan la referencia citable `[ctx:…]` para que quien las use
 * pueda decir de dónde salió cada cosa.
 */

import { defineSchema } from '../schema';
import { defineReadTool, type ReadTool } from './registry';

export interface ReadableArtifact {
  id: string;
  name: string;
  type: string;
  version: number;
  objective: string;
  content: string;
}

export interface ArtifactReadPort {
  list(): readonly ReadableArtifact[];
}

export interface ReadableStandard {
  id: string;
  title: string;
  summary: string;
}

export interface StandardsReadPort {
  list(): readonly ReadableStandard[];
}

const SECTION_SUMMARY_CHARS = 600;

const cite = (kind: string, id: string): string => `[ctx:${kind}/${id}]`;

/** El texto de una sección Markdown (hasta el siguiente encabezado del mismo o mayor nivel). */
export const extractMarkdownSection = (content: string, heading: string): string | null => {
  const lines = content.split('\n');
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === wanted);
  if (start < 0) return null;
  const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s/);
    if (match && match[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
};

export const createReadArtifactTool = (port: ArtifactReadPort): ReadTool => defineReadTool({
  name: 'read_artifact',
  summary: 'Devuelve el contenido de un artefacto del proyecto por su id: un resumen con sus encabezados, o una sección concreta.',
  whenToUse: 'ya conoces el id del artefacto (por el inventario o por search_artifacts) y necesitas su detalle para responder.',
  whenNotToUse: 'solo quieres saber qué artefactos existen o no sabes el id: usa search_artifacts primero.',
  parameters: defineSchema({
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Identificador del artefacto, tal como lo devuelve search_artifacts.' },
      section: { type: 'string', description: 'Encabezado exacto de la sección que se quiere leer; omítelo para obtener el resumen.' },
    },
    required: ['artifactId'],
  }),
  effect: 'read-only',
  maxResponseChars: 3_000,
  run: (input) => {
    const id = String(input.artifactId);
    const artifact = port.list().find((candidate) => candidate.id === id);
    if (!artifact) {
      return { ok: false, error: `No existe un artefacto con id «${id}». Usa search_artifacts para obtener un id válido.` };
    }
    const head = `${cite('artifact', artifact.id)} ${artifact.name} (${artifact.type}, v${artifact.version})`;
    if (typeof input.section === 'string' && input.section.trim()) {
      const section = extractMarkdownSection(artifact.content, input.section);
      if (section === null) {
        const headings = artifact.content.split('\n').filter((line) => /^#{1,6}\s/.test(line)).map((line) => line.replace(/^#{1,6}\s+/, '').trim());
        return { ok: false, error: `El artefacto no tiene la sección «${input.section}». Secciones: ${headings.join(' | ') || 'ninguna'}.` };
      }
      return { ok: true, text: `${head}\n${section}` };
    }
    const headings = artifact.content.split('\n').filter((line) => /^#{1,6}\s/.test(line)).map((line) => line.replace(/^#{1,6}\s+/, '').trim());
    const lead = (artifact.objective || artifact.content).slice(0, SECTION_SUMMARY_CHARS);
    return { ok: true, text: `${head}\nObjetivo: ${lead}\nSecciones: ${headings.join(' | ') || 'sin encabezados'}` };
  },
});

export const createSearchArtifactsTool = (port: ArtifactReadPort): ReadTool => defineReadTool({
  name: 'search_artifacts',
  summary: 'Busca artefactos del proyecto por texto y, opcionalmente, por tipo; devuelve id, nombre y tipo de los que coinciden.',
  whenToUse: 'necesitas localizar qué artefacto trata un tema, o conseguir el id que pide read_artifact.',
  whenNotToUse: 'ya tienes el id del artefacto: léelo directamente con read_artifact.',
  parameters: defineSchema({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Palabras a buscar en el nombre, el objetivo y el contenido del artefacto.' },
      type: { type: 'string', description: 'Tipo de artefacto al que restringir la búsqueda; omítelo para buscar en todos.' },
    },
    required: ['query'],
  }),
  effect: 'read-only',
  maxResponseChars: 2_000,
  run: (input) => {
    const terms = String(input.query).toLowerCase().split(/\s+/).filter((term) => term.length > 1);
    if (terms.length === 0) return { ok: false, error: 'La búsqueda está vacía. Indica al menos una palabra con más de un carácter.' };
    const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim() : null;
    const hits = port.list()
      .filter((artifact) => !type || artifact.type === type)
      .map((artifact) => {
        const haystack = `${artifact.name} ${artifact.objective} ${artifact.content}`.toLowerCase();
        return { artifact, score: terms.filter((term) => haystack.includes(term)).length };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (hits.length === 0) return { ok: true, text: 'Ningún artefacto coincide. Prueba con otras palabras o sin el filtro de tipo.' };
    return { ok: true, text: hits.map(({ artifact }) => `${cite('artifact', artifact.id)} ${artifact.name} (${artifact.type}, v${artifact.version})`).join('\n') };
  },
});

export const createListOfficeStandardsTool = (port: StandardsReadPort): ReadTool => defineReadTool({
  name: 'list_office_standards',
  summary: 'Lista los estándares escritos de la Oficina de Arquitectura, con su título y una frase, filtrables por texto.',
  whenToUse: 'tu respuesta debe alinearse con un estándar de la Oficina o quieres citar cuál aplica.',
  whenNotToUse: 'la pregunta es sobre un artefacto concreto del proyecto: eso lo cubren search_artifacts y read_artifact.',
  parameters: defineSchema({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto con el que filtrar los estándares; omítelo para listarlos todos.' },
    },
  }),
  effect: 'read-only',
  maxResponseChars: 3_000,
  run: (input) => {
    const needle = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
    const matches = port.list().filter((standard) => !needle || `${standard.title} ${standard.summary}`.toLowerCase().includes(needle));
    if (matches.length === 0) return { ok: true, text: 'Ningún estándar coincide con ese texto.' };
    return { ok: true, text: matches.map((standard) => `${cite('standard', standard.id)} ${standard.title}: ${standard.summary}`).join('\n') };
  },
});
