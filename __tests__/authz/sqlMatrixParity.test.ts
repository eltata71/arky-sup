/**
 * Paridad de la matriz de permisos: SQL ↔ TypeScript.
 *
 * F4.3 exige que la autorización tenga una sola definición. `firestore.rules`
 * y `lib/authz/permissions.ts` ya se comparan celda por celda
 * (`rulesMatrix.test.ts`); al migrar la matriz a PostgreSQL aparece un tercer
 * sitio donde la política vive escrita, y sin esta prueba la deriva entre
 * ambos sería silenciosa: la interfaz mostraría un permiso que el servidor no
 * concede, o al contrario, que es el caso peligroso.
 *
 * Lee la migración como texto y la compara con `ROLE_PERMISSIONS`. No necesita
 * base de datos: es una comprobación de contenido, complementaria —no
 * sustituta— de las pruebas pgTAP, que son las que ejercitan RLS y las RPC.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTH_ROLES, ROLE_PERMISSIONS, type AuthRole } from '../../lib/authz/permissions';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function readMatrixFromMigrations(): Map<string, Set<string>> {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('_identity_authorization.sql'));
  if (files.length !== 1) {
    throw new Error(`Se esperaba una migración de autorización; encontradas: ${files.join(', ') || 'ninguna'}`);
  }
  const sql = readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');

  const start = sql.indexOf('insert into private.role_permissions');
  if (start < 0) throw new Error('La migración no siembra private.role_permissions');
  const end = sql.indexOf(';', start);
  const block = sql.slice(start, end < 0 ? undefined : end);

  const matrix = new Map<string, Set<string>>();
  const row = /\(\s*'([a-z]+)'\s*,\s*'([a-z:_-]+)'\s*\)/g;
  for (let match = row.exec(block); match; match = row.exec(block)) {
    const [, role, permission] = match;
    if (!matrix.has(role)) matrix.set(role, new Set());
    matrix.get(role)!.add(permission);
  }
  return matrix;
}

describe('matriz de permisos en SQL', () => {
  const sqlMatrix = readMatrixFromMigrations();

  it('declara exactamente los mismos roles que el dominio', () => {
    expect([...sqlMatrix.keys()].sort()).toEqual([...AUTH_ROLES].sort());
  });

  it('coincide celda por celda con ROLE_PERMISSIONS', () => {
    const differences: string[] = [];
    for (const role of AUTH_ROLES) {
      const fromSql = sqlMatrix.get(role) ?? new Set<string>();
      const fromDomain = new Set<string>(ROLE_PERMISSIONS[role as AuthRole]);
      for (const permission of fromDomain) {
        if (!fromSql.has(permission)) differences.push(`falta en SQL: ${role} → ${permission}`);
      }
      for (const permission of fromSql) {
        if (!fromDomain.has(permission)) differences.push(`sobra en SQL: ${role} → ${permission}`);
      }
    }
    expect(differences).toEqual([]);
  });

  it('no introduce permisos que el dominio no conozca', () => {
    const known = new Set<string>();
    for (const role of AUTH_ROLES) for (const permission of ROLE_PERMISSIONS[role as AuthRole]) known.add(permission);
    const unknown = [...sqlMatrix.values()].flatMap((set) => [...set]).filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });

  it('solo superadmin concede roles administrativos (invariante del servidor)', () => {
    const privileged = AUTH_ROLES.filter((role) => ROLE_PERMISSIONS[role as AuthRole].has('users:grant-privileged'));
    expect(privileged).toEqual(['superadmin']);
    expect(sqlMatrix.get('admin')?.has('users:grant-privileged')).toBe(false);
  });

  it('el total de celdas coincide con el número que afirma la prueba SQL', () => {
    const total = [...sqlMatrix.values()].reduce((sum, set) => sum + set.size, 0);
    expect(total).toBe(63);
  });
});
