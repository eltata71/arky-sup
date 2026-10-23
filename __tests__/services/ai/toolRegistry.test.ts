/**
 * El molde de las herramientas de lectura (plan de agentes 19.0, corte 1).
 */
import { describe, expect, it, vi } from 'vitest';
import { defineSchema } from '../../../services/ai/schema';
import {
  MAX_RESPONSE_CHARS_CEILING,
  createToolRegistry,
  defineReadTool,
  validateReadToolSpec,
  validateToolInput,
  type ReadToolSpec,
} from '../../../services/ai/tools/registry';
import { MODIFY_ARTIFACT_TOOL_NAME } from '../../../services/ai/tools';

const spec = (patch: Partial<ReadToolSpec> = {}): ReadToolSpec => ({
  name: 'read_artifact',
  summary: 'Devuelve el contenido de un artefacto del proyecto, completo o una sección.',
  whenToUse: 'necesitas el detalle de un artefacto cuyo id ya conoces por el inventario.',
  whenNotToUse: 'solo quieres saber qué artefactos existen: para eso hay un inventario.',
  parameters: defineSchema({
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Identificador del artefacto, tal como aparece en el inventario.' },
      section: { type: 'string', description: 'Encabezado de la sección que se quiere leer; omítelo para el resumen.' },
    },
    required: ['artifactId'],
  }),
  effect: 'read-only',
  maxResponseChars: 500,
  run: ({ artifactId }) => ({ ok: true, text: `contenido de ${String(artifactId)}` }),
  ...patch,
});

describe('declarar una herramienta', () => {
  it('una declaración completa compone la descripción con cuándo usarla y cuándo no', () => {
    const tool = defineReadTool(spec());
    expect(tool.definition.name).toBe('read_artifact');
    expect(tool.definition.description).toMatch(/Úsala cuando:/);
    expect(tool.definition.description).toMatch(/No la uses cuando:/);
    expect(tool.definition.description).toMatch(/Solo lee/);
    expect(tool.definition.description).toContain('500 caracteres');
  });

  it.each([
    ['un nombre que no es snake_case', { name: 'readArtifact' }, /snake_case/],
    ['un efecto que no es read-only', { effect: 'write' as never }, /read-only/],
    ['un resumen demasiado corto', { summary: 'Lee algo.' }, /resumen/],
    ['sin decir cuándo usarla', { whenToUse: '' }, /cuándo usarla/],
    ['sin decir cuándo no usarla', { whenNotToUse: 'no' }, /cuándo no usarla/],
    ['un tope por encima del techo', { maxResponseChars: MAX_RESPONSE_CHARS_CEILING + 1 }, /tope/],
    ['un tope de cero', { maxResponseChars: 0 }, /tope/],
  ])('rechaza %s', (_label, patch, message) => {
    expect(validateReadToolSpec(spec(patch)).join(' ')).toMatch(message);
    expect(() => defineReadTool(spec(patch))).toThrow(message);
  });

  it('rechaza un parámetro sin descripción, anidado o no', () => {
    const bad = spec({
      parameters: defineSchema({
        type: 'object',
        properties: { artifactId: { type: 'string' } },
        required: ['artifactId'],
      }),
    });
    expect(validateReadToolSpec(bad).join(' ')).toMatch(/«artifactId» no tiene descripción/);
  });

  it('los parámetros deben ser un objeto', () => {
    expect(validateReadToolSpec(spec({ parameters: defineSchema({ type: 'string' }) })).join(' ')).toMatch(/objeto/);
  });

  it('ninguna herramienta del registro comparte nombre con la que escribe', () => {
    expect(defineReadTool(spec()).name).not.toBe(MODIFY_ARTIFACT_TOOL_NAME);
  });
});

describe('validateToolInput', () => {
  const { parameters } = spec();

  it('acepta una entrada correcta', () => {
    expect(validateToolInput(parameters, { artifactId: 'a1' })).toEqual([]);
  });

  it('dice qué falta, qué sobra y qué tipo no es', () => {
    expect(validateToolInput(parameters, {})).toEqual(['falta el parámetro «artifactId»']);
    expect(validateToolInput(parameters, { artifactId: 5 })).toEqual(['artifactId debe ser string']);
    expect(validateToolInput(parameters, { artifactId: 'a', extra: true })).toEqual(['el parámetro «extra» no existe']);
  });

  it('respeta los enum', () => {
    const schema = defineSchema({
      type: 'object',
      properties: { kind: { type: 'string', description: 'El tipo de artefacto buscado.', enum: ['diagram', 'document'] } },
    });
    expect(validateToolInput(schema, { kind: 'otro' })[0]).toMatch(/diagram, document/);
  });
});

describe('createToolRegistry', () => {
  it('rechaza dos herramientas con el mismo nombre', () => {
    expect(() => createToolRegistry([defineReadTool(spec()), defineReadTool(spec())])).toThrow(/dos veces/);
  });

  it('ofrece las definiciones en el orden de registro', () => {
    const registry = createToolRegistry([
      defineReadTool(spec()),
      defineReadTool(spec({ name: 'search_artifacts' })),
    ]);
    expect(registry.definitions().map((definition) => definition.name)).toEqual(['read_artifact', 'search_artifacts']);
  });

  it('una llamada correcta devuelve la respuesta', async () => {
    const registry = createToolRegistry([defineReadTool(spec())]);
    expect(await registry.execute('read_artifact', { artifactId: 'a1' })).toEqual({
      name: 'read_artifact', ok: true, text: 'contenido de a1', truncated: false,
    });
  });

  it('una herramienta que no existe dice cuáles hay', async () => {
    const registry = createToolRegistry([defineReadTool(spec())]);
    const result = await registry.execute('leer_todo', {});
    expect(result.ok).toBe(false);
    expect(result.text).toContain('read_artifact');
    expect(await createToolRegistry([]).execute('x', {})).toMatchObject({ text: expect.stringContaining('ninguna') });
  });

  it('una entrada inválida no llega a ejecutarse y dice cómo corregirla', async () => {
    const run = vi.fn(() => ({ ok: true as const, text: 'x' }));
    const registry = createToolRegistry([defineReadTool(spec({ run }))]);
    const result = await registry.execute('read_artifact', { artifactId: 3 });
    expect(run).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/Corrige los parámetros/);
  });

  it('una respuesta que no cabe se recorta al tope y lo dice', async () => {
    const registry = createToolRegistry([defineReadTool(spec({
      maxResponseChars: 200,
      run: () => ({ ok: true, text: 'x'.repeat(5_000) }),
    }))]);
    const result = await registry.execute('read_artifact', { artifactId: 'a1' });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.text).toMatch(/respuesta recortada a 200 caracteres/);
  });

  it('el error accionable que devuelve la herramienta llega tal cual, con tope', async () => {
    const registry = createToolRegistry([defineReadTool(spec({
      run: () => ({ ok: false, error: 'El artefacto «a9» no existe; usa search_artifacts primero.' }),
    }))]);
    const result = await registry.execute('read_artifact', { artifactId: 'a9' });
    expect(result).toMatchObject({ ok: false, text: 'El artefacto «a9» no existe; usa search_artifacts primero.' });
  });

  it('una excepción no se filtra al modelo: se le dice qué hacer', async () => {
    const registry = createToolRegistry([defineReadTool(spec({
      run: () => { throw new Error('ECONNRESET en /srv/secreto/ruta'); },
    }))]);
    const result = await registry.execute('read_artifact', { artifactId: 'a1' });
    expect(result.ok).toBe(false);
    expect(result.text).not.toContain('secreto');
    expect(result.text).toMatch(/Reintenta una vez/);
  });
});
