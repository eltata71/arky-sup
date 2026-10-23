/** Nombres de las herramientas de lectura: el vocabulario que el contrato del agente y el registro comparten. */
export const READ_TOOL_NAMES = [
  'read_artifact',
  'search_artifacts',
  'list_office_standards',
  'query_knowledge_graph',
  'get_initiative_motivation',
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
