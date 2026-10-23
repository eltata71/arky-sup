/**
 * El registro de herramientas de lectura (plan de agentes 19.0, corte 1).
 *
 * Una herramienta es una interfaz de consulta para un modelo, y su calidad es
 * la de su descripción: el modelo decide si la llama y con qué leyendo sólo
 * ese texto. Por eso aquí una herramienta no se declara con un literal suelto
 * sino con `defineReadTool`, que **rechaza** lo que hace mala a una
 * herramienta: un nombre que no es `snake_case`, una descripción que no dice
 * cuándo usarla y cuándo no, un esquema que no describe cada parámetro, una
 * respuesta sin tope.
 *
 * Tres reglas del registro:
 *
 * - **Todas leen, ninguna escribe.** El efecto es `read-only` y no hay otro: la
 *   escritura sigue siendo `MODIFY_ARTIFACT_TOOL`, con confirmación.
 * - **Las respuestas tienen tope y son citables.** Una respuesta que no cabe se
 *   recorta diciendo cuánto y cómo pedir menos; nunca se cuela entera en el
 *   contexto de quien preguntó.
 * - **Un error se puede actuar.** «No existe; usa `search_artifacts` primero»,
 *   no «error». El modelo que recibe un fallo opaco reintenta lo mismo.
 *
 * No hay herramientas aquí todavía (corte 2) ni política por agente (corte 3):
 * este módulo es el molde.
 */

import type { AIJsonSchema } from '../schema';
import type { AIToolDefinition } from '../core/AITool';

export const READ_TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
/** Lo mínimo para que una descripción explique algo. */
export const MIN_SUMMARY_CHARS = 40;
export const MIN_GUIDANCE_CHARS = 20;
/** Ninguna respuesta de herramienta pasa de esto, diga lo que diga quien la declare. */
export const MAX_RESPONSE_CHARS_CEILING = 8_000;

export type ReadToolEffect = 'read-only';

export type ReadToolOutput =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface ReadToolSpec {
  /** `snake_case`, el nombre que el modelo repite al llamarla. */
  name: string;
  /** Qué devuelve, en una o dos frases. */
  summary: string;
  /** Cuándo conviene llamarla. */
  whenToUse: string;
  /** Cuándo no: lo que evita llamadas inútiles. */
  whenNotToUse: string;
  parameters: AIJsonSchema;
  effect: ReadToolEffect;
  /** Tope de la respuesta en caracteres; el registro lo aplica. */
  maxResponseChars: number;
  run: (input: Record<string, unknown>) => ReadToolOutput | Promise<ReadToolOutput>;
}

export interface ReadTool extends ReadToolSpec {
  /** Lo que se ofrece al modelo: la descripción compuesta a partir de las tres partes. */
  definition: AIToolDefinition;
}

const describeMissingParameterDocs = (schema: AIJsonSchema, path: string, problems: string[]): void => {
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!child.description || child.description.trim().length < 10) {
      problems.push(`el parámetro «${path}${key}» no tiene descripción`);
    }
    describeMissingParameterDocs(child, `${path}${key}.`, problems);
  }
  if (schema.items) describeMissingParameterDocs(schema.items, `${path}[].`, problems);
};

/** Los problemas de una declaración; vacío si es válida. */
export const validateReadToolSpec = (spec: ReadToolSpec): string[] => {
  const problems: string[] = [];
  if (!READ_TOOL_NAME_PATTERN.test(spec.name)) {
    problems.push(`el nombre «${spec.name}» no es snake_case`);
  }
  if (spec.effect !== 'read-only') {
    problems.push('el efecto debe ser read-only: ninguna herramienta del registro escribe');
  }
  if (spec.summary.trim().length < MIN_SUMMARY_CHARS) {
    problems.push(`el resumen es demasiado corto (mínimo ${MIN_SUMMARY_CHARS} caracteres)`);
  }
  if (spec.whenToUse.trim().length < MIN_GUIDANCE_CHARS) {
    problems.push('falta decir cuándo usarla');
  }
  if (spec.whenNotToUse.trim().length < MIN_GUIDANCE_CHARS) {
    problems.push('falta decir cuándo no usarla');
  }
  if (spec.parameters.type !== 'object' || !spec.parameters.properties) {
    problems.push('los parámetros deben ser un objeto con propiedades');
  } else {
    describeMissingParameterDocs(spec.parameters, '', problems);
  }
  if (!Number.isInteger(spec.maxResponseChars) || spec.maxResponseChars < 1 || spec.maxResponseChars > MAX_RESPONSE_CHARS_CEILING) {
    problems.push(`el tope de respuesta debe estar entre 1 y ${MAX_RESPONSE_CHARS_CEILING} caracteres`);
  }
  return problems;
};

/**
 * La única forma de declarar una herramienta de lectura. Lanza si la
 * declaración es mala: es un error de programación que debe verse al cargar el
 * módulo, no a media conversación.
 */
export const defineReadTool = (spec: ReadToolSpec): ReadTool => {
  const problems = validateReadToolSpec(spec);
  if (problems.length > 0) {
    throw new Error(`Herramienta «${spec.name}» mal declarada: ${problems.join('; ')}.`);
  }
  return {
    ...spec,
    definition: {
      name: spec.name,
      description: [
        spec.summary.trim(),
        `Úsala cuando: ${spec.whenToUse.trim()}`,
        `No la uses cuando: ${spec.whenNotToUse.trim()}`,
        `Solo lee; la respuesta se recorta a ${spec.maxResponseChars} caracteres.`,
      ].join(' '),
      parameters: spec.parameters,
    },
  };
};

// ---------------------------------------------------------------------------
// Validación de la entrada
// ---------------------------------------------------------------------------

const matchesType = (schema: AIJsonSchema, value: unknown): boolean => {
  switch (schema.type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    default: return false;
  }
};

/** Los problemas de una entrada frente al esquema de la herramienta. */
export const validateToolInput = (schema: AIJsonSchema, input: unknown, path = ''): string[] => {
  if (input === null || input === undefined) {
    return schema.nullable ? [] : [`${path || 'la entrada'} falta`];
  }
  if (!matchesType(schema, input)) return [`${path || 'la entrada'} debe ser ${schema.type}`];
  if (schema.enum && !schema.enum.includes(input)) {
    return [`${path || 'la entrada'} debe ser uno de: ${schema.enum.map(String).join(', ')}`];
  }
  const problems: string[] = [];
  if (schema.type === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) problems.push(`falta el parámetro «${path}${key}»`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) problems.push(...validateToolInput(child, record[key], `${path}${key}.`.replace(/\.$/, '')));
    }
    for (const key of Object.keys(record)) {
      if (!(key in (schema.properties ?? {}))) problems.push(`el parámetro «${path}${key}» no existe`);
    }
  }
  if (schema.type === 'array' && schema.items) {
    (input as unknown[]).forEach((item, index) => {
      problems.push(...validateToolInput(schema.items as AIJsonSchema, item, `${path}[${index}]`));
    });
  }
  return problems;
};

// ---------------------------------------------------------------------------
// El registro
// ---------------------------------------------------------------------------

export interface ToolExecution {
  name: string;
  ok: boolean;
  /** Lo que se le devuelve al modelo: la respuesta, o un error que se puede actuar. */
  text: string;
  /** La respuesta se recortó al tope. */
  truncated: boolean;
}

export interface ToolRegistry {
  list(): ReadTool[];
  get(name: string): ReadTool | undefined;
  /** Lo que se ofrece al modelo, en el orden de registro. */
  definitions(): AIToolDefinition[];
  execute(name: string, input: unknown): Promise<ToolExecution>;
}

const cap = (text: string, limit: number): { text: string; truncated: boolean } => {
  if (text.length <= limit) return { text, truncated: false };
  const note = ` […respuesta recortada a ${limit} caracteres; pide una sección o un resultado más pequeño]`;
  return { text: text.slice(0, Math.max(0, limit - note.length)) + note, truncated: true };
};

export const createToolRegistry = (tools: readonly ReadTool[]): ToolRegistry => {
  const byName = new Map<string, ReadTool>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Herramienta «${tool.name}» registrada dos veces.`);
    byName.set(tool.name, tool);
  }

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
    definitions: () => [...byName.values()].map((tool) => tool.definition),

    async execute(name, input) {
      const tool = byName.get(name);
      if (!tool) {
        const available = [...byName.keys()];
        return {
          name,
          ok: false,
          truncated: false,
          text: `La herramienta «${name}» no existe. Herramientas disponibles: ${available.length > 0 ? available.join(', ') : 'ninguna'}.`,
        };
      }
      const problems = validateToolInput(tool.parameters, input ?? {});
      if (problems.length > 0) {
        return {
          name,
          ok: false,
          truncated: false,
          text: `Entrada no válida para «${name}»: ${problems.join('; ')}. Corrige los parámetros y vuelve a llamarla.`,
        };
      }
      let output: ReadToolOutput;
      try {
        output = await tool.run((input ?? {}) as Record<string, unknown>);
      } catch {
        // El detalle del fallo no se le cuenta al modelo: puede traer rutas o
        // texto que no escribió nadie. Se le dice qué hacer.
        output = { ok: false, error: `«${name}» falló al consultar. Reintenta una vez; si vuelve a fallar, continúa sin ella e indícalo.` };
      }
      const capped = cap(output.ok ? output.text : output.error, tool.maxResponseChars);
      return { name, ok: output.ok, text: capped.text, truncated: capped.truncated };
    },
  };
};
