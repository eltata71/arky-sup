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

const serviceFiles = readdirSync('services', { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.ts') && !name.includes('__tests__'))
  .map((name) => join('services', name));

describe('revision caches', () => {
  it('no module keeps a top-level map of revisions', () => {
    const offending = serviceFiles.filter((file) =>
      /^(?:export\s+)?const\s+\w*[Rr]evisions?\w*\s*=\s*new Map\b/m.test(readFileSync(file, 'utf8')));
    expect(offending).toEqual([]);
  });

  it('and nothing publishes a «known revision» lookup', () => {
    const offending = serviceFiles.filter((file) =>
      /export\s+const\s+(known\w*Revision|forget\w*Revisions)\b/.test(readFileSync(file, 'utf8')));
    expect(offending).toEqual([]);
  });

  it('the scan sees the repositories it is meant to guard', () => {
    expect(serviceFiles).toContain(join('services', 'architectureProjects', 'SupabaseProjectRepository.ts'));
  });
});
