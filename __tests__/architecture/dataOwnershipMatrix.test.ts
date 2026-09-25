/**
 * Toda tabla y toda RPC del esquema `api` tiene dueño declarado (F6-06).
 *
 * Es un criterio de cierre de la fase 6, y la matriz que lo declara
 * (`docs/ddd-transformacion/06-propiedad-datos.md`) se quedó en la foto de la
 * línea base durante cuatro fases: no conocía diez RPC ni la tabla de la
 * bitácora de proyecciones, y seguía citando una RPC retirada. Una matriz que
 * nadie compara con el esquema describe el esquema de otro día.
 *
 * La regla: una migración que crea una RPC o una tabla en `api` actualiza la
 * matriz en el mismo cambio, con su contexto dueño.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const MATRIX = readFileSync(join(ROOT, 'docs', 'ddd-transformacion', '06-propiedad-datos.md'), 'utf8');

/** El esquema vigente: cada creación menos su retirada, en orden de migración. */
const currentSchema = () => {
  const functions = new Set<string>();
  const tables = new Set<string>();
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+api\.(\w+)\s*\(/gi)) functions.add(match[1]);
    for (const match of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?api\.(\w+)/gi)) functions.delete(match[1]);
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?api\.(\w+)/gi)) tables.add(match[1]);
    for (const match of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?api\.(\w+)/gi)) tables.delete(match[1]);
  }
  return { functions, tables };
};

const named = (identifier: string): boolean => MATRIX.includes(`\`${identifier}\``) || MATRIX.includes(identifier);

describe('matriz de propiedad de datos (F6-06)', () => {
  const { functions, tables } = currentSchema();

  it('ve el esquema: si esto baja a cero, la lectura de migraciones se rompió', () => {
    expect(functions.size).toBeGreaterThan(40);
    expect(tables.size).toBeGreaterThan(15);
  });

  it('nombra cada RPC del esquema `api`', () => {
    expect([...functions].filter((name) => !named(name)).sort()).toEqual([]);
  });

  it('nombra cada tabla del esquema `api`', () => {
    expect([...tables].filter((name) => !named(name)).sort()).toEqual([]);
  });

  it('no cita como vigente la RPC compuesta retirada en F4-06', () => {
    const cited = MATRIX.split('\n').filter((line) => line.startsWith('|') && line.includes('save_project_aggregate'));
    expect(cited).toEqual([]);
  });
});
