/**
 * Herramientas de lectura del grafo de conocimiento y de la motivación de
 * negocio (plan de agentes 19.0, corte 2). Mismo contrato que
 * `officeReadTools`: puertos declarados aquí, implementados por el contexto
 * dueño, respuestas compactas y citables.
 */

import { defineSchema } from '../schema';
import { defineReadTool, type ReadTool } from './registry';

export interface GraphEntityView {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export interface GraphRelationView {
  sourceId: string;
  targetId: string;
  type: string;
  label?: string;
}

export interface KnowledgeGraphReadPort {
  entities(): readonly GraphEntityView[];
  relations(): readonly GraphRelationView[];
}

export interface MotivationView {
  initiativeId: string;
  title: string;
  need: string;
  objectives: readonly string[];
  expectedOutcomes: readonly string[];
  kpis: readonly string[];
}

export interface MotivationReadPort {
  list(): readonly MotivationView[];
}

const cite = (kind: string, id: string): string => `[ctx:${kind}/${id}]`;

export const createQueryKnowledgeGraphTool = (port: KnowledgeGraphReadPort): ReadTool => defineReadTool({
  name: 'query_knowledge_graph',
  summary: 'Busca entidades del grafo de conocimiento del proyecto por nombre y devuelve sus relaciones directas (entrantes y salientes).',
  whenToUse: 'necesitas saber qué componentes, sistemas o datos existen y cómo se conectan, o qué se vería afectado por un cambio.',
  whenNotToUse: 'necesitas el texto de un documento: usa search_artifacts y read_artifact; el grafo solo guarda entidades y relaciones.',
  parameters: defineSchema({
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre, o parte del nombre, de la entidad a consultar.' },
      type: { type: 'string', description: 'Tipo de entidad al que restringir; omítelo para buscar en todos.' },
    },
    required: ['name'],
  }),
  effect: 'read-only',
  maxResponseChars: 3_000,
  run: (input) => {
    const needle = String(input.name).trim().toLowerCase();
    if (!needle) return { ok: false, error: 'El nombre está vacío. Indica el nombre, o parte del nombre, de una entidad.' };
    const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim() : null;
    const entities = port.entities();
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const matches = entities.filter((entity) => entity.name.toLowerCase().includes(needle) && (!type || entity.type === type)).slice(0, 5);
    if (matches.length === 0) return { ok: true, text: 'Ninguna entidad coincide. Prueba con otro nombre o sin el filtro de tipo.' };
    const relations = port.relations();
    const label = (id: string): string => byId.get(id)?.name ?? id;
    const blocks = matches.map((entity) => {
      const out = relations.filter((relation) => relation.sourceId === entity.id).slice(0, 8).map((relation) => `  → ${relation.type}${relation.label ? ` (${relation.label})` : ''} ${label(relation.targetId)}`);
      const incoming = relations.filter((relation) => relation.targetId === entity.id).slice(0, 8).map((relation) => `  ← ${relation.type}${relation.label ? ` (${relation.label})` : ''} ${label(relation.sourceId)}`);
      return [`${cite('graph', entity.id)} ${entity.name} (${entity.type})${entity.description ? `: ${entity.description}` : ''}`, ...out, ...incoming].join('\n');
    });
    return { ok: true, text: blocks.join('\n') };
  },
});

export const createGetInitiativeMotivationTool = (port: MotivationReadPort): ReadTool => defineReadTool({
  name: 'get_initiative_motivation',
  summary: 'Devuelve la necesidad, los objetivos, los resultados esperados y los indicadores de las iniciativas de negocio a las que sirve el proyecto.',
  whenToUse: 'tu respuesta debe justificarse por el valor de negocio, o debes comprobar que una propuesta sirve a un objetivo o indicador declarado.',
  whenNotToUse: 'la pregunta es técnica y no depende del motivo de negocio: no la consultes por rutina.',
  parameters: defineSchema({
    type: 'object',
    properties: {
      initiativeId: { type: 'string', description: 'Id de una iniciativa concreta; omítelo para recibir todas las del proyecto.' },
    },
  }),
  effect: 'read-only',
  maxResponseChars: 3_000,
  run: (input) => {
    const wanted = typeof input.initiativeId === 'string' && input.initiativeId.trim() ? input.initiativeId.trim() : null;
    const all = port.list();
    const picked = wanted ? all.filter((item) => item.initiativeId === wanted) : all;
    if (picked.length === 0) {
      return wanted
        ? { ok: false, error: `El proyecto no sirve a la iniciativa «${wanted}». Llama sin initiativeId para ver las que sí.` }
        : { ok: true, text: 'El proyecto no declara iniciativas con motivación registrada.' };
    }
    const lines = (title: string, items: readonly string[]): string => (items.length ? `${title}: ${items.join('; ')}` : '');
    return {
      ok: true,
      text: picked.map((item) => [
        `${cite('initiative', item.initiativeId)} ${item.title}`,
        `Necesidad: ${item.need}`,
        lines('Objetivos', item.objectives),
        lines('Resultados esperados', item.expectedOutcomes),
        lines('Indicadores', item.kpis),
      ].filter(Boolean).join('\n')).join('\n\n'),
    };
  },
});
