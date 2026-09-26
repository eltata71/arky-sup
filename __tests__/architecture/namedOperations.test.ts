/**
 * Un agregado con operaciones con nombre no vuelve a aceptar parches libres
 * (F3-05 para Iniciativas, F6-03 corte 2b para Proyectos).
 *
 * `updateInitiative(partial)` y `updateProject(partial)` desaparecieron porque
 * con un parche no hay dónde poner una regla: no se sabe qué se quiso hacer.
 * Volver a añadir uno es fácil y compila —un `Partial<T>` encaja en casi
 * todo—, así que esto mira el código de la aplicación.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const APP_LAYERS = ['components', 'pages', 'hooks', 'context'];

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return filesUnder(path);
  return /\.tsx?$/.test(name) ? [path] : [];
});

/** El código sin comentarios: un comentario que explica por qué algo ya no existe no es un uso. */
const code = (file: string): string => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const offenders = (pattern: RegExp): string[] => APP_LAYERS
  .flatMap((layer) => filesUnder(join(ROOT, layer)))
  .filter((file) => pattern.test(code(file)))
  .map((file) => relative(ROOT, file));

describe('operaciones con nombre, no parches', () => {
  it('ninguna capa de la aplicación llama ni publica `updateProject`', () => {
    expect(offenders(/\bupdateProject\s*[(:]/)).toEqual([]);
  });

  it('ni `updateInitiative`', () => {
    expect(offenders(/\bupdateInitiative\s*[(:]/)).toEqual([]);
  });

  it('el grafo de conocimiento no se guarda a través de la raíz del proyecto', () => {
    // `architectureKnowledgeGraph` en un comando o en los cambios de la raíz
    // volvería a reescribir el proyecto por un dato derivado.
    const commands = readFileSync(join(ROOT, 'services/architectureProjects/domain/projectCommands.ts'), 'utf8');
    expect(commands).not.toMatch(/kind:\s*'[^']*graph/i);
  });
});
