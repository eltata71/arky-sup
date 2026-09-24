/**
 * F4-07 · Ningún repositorio recuerda revisiones por su cuenta.
 *
 * Tres contextos tuvieron el mismo `Map` global de revisiones —encargos,
 * iniciativas y proyectos— y los tres se quitaron por separado (F2-10, F4-07).
 * Un mapa así recuerda la última revisión que **esta pestaña** leyó, no la del
 * registro que la persona está viendo, y la siguiente escritura compara contra
 * la equivocada. La revisión viaja con el registro. Esto impide que vuelva: el
 * compilador no lo ve, porque un `Map` a nivel de módulo es código válido.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Vacía desde F6-03: `settings` y `learning` tenían cada uno un mapa por
 * instancia, registrado aquí al ampliar la búsqueda en F5-05. La revisión viaja
 * ahora en `Settings.revision` y `Course.revision`.
 */
const KNOWN_PER_INSTANCE_MAPS: string[] = [];

const serviceFiles = readdirSync('services', { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.ts') && !name.includes('__tests__'))
  .map((name) => join('services', name));

describe('revision caches', () => {
  it('no module keeps a map of revisions, at any level', () => {
    // Hasta F5-05 esto sólo miraba el nivel del módulo (`^const …`), y el
    // repositorio del grafo guardaba el suyo **dentro** de su fábrica: un mapa
    // por instancia, con lecturas y escrituras en instancias distintas. Tras
    // recargar, toda reconstrucción de un grafo existente se rechazaba en
    // silencio. Un mapa por instancia es el mismo defecto con otra sangría.
    const offending = serviceFiles.filter((file) =>
      /^\s*(?:export\s+)?const\s+\w*[Rr]evisions?\w*\s*=\s*new Map\b/m.test(readFileSync(file, 'utf8')));
    expect(offending.sort()).toEqual([...KNOWN_PER_INSTANCE_MAPS].sort());
  });

  it('and nothing publishes a «known revision» lookup', () => {
    const offending = serviceFiles.filter((file) =>
      /export\s+const\s+(known\w*Revision|forget\w*Revisions)\b/.test(readFileSync(file, 'utf8')));
    expect(offending).toEqual([]);
  });

  it('the scan sees the repositories it is meant to guard', () => {
    expect(serviceFiles).toContain(join('services', 'architectureProjects', 'SupabaseProjectRepository.ts'));
    expect(serviceFiles).toContain(join('services', 'architectureKnowledgeGraph', 'SupabaseKnowledgeGraphRepository.ts'));
  });
});
