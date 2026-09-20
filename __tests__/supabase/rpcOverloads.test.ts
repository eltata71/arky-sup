/**
 * Ninguna RPC concedida queda con dos firmas, y ninguna guarda se puede evitar
 * llamando a la puerta de al lado.
 *
 * Esta prueba existe por un defecto concreto. `api.delete_engagement(text, text)`
 * se creó y se concedió a `authenticated`; una migración posterior añadió
 * `api.delete_engagement(text, text, bigint)` con la comparación de revisión que
 * faltaba y se documentó como si la reemplazara. `create or replace function`
 * con otra lista de argumentos **crea una sobrecarga**, así que durante ocho
 * días la guarda optimista fue opcional: quien llamara la firma corta borraba
 * un encargo sin comparar nada.
 *
 * Lo que lo hizo invisible es que ninguna capa lo veía. El repositorio pasa
 * siempre tres argumentos, así que la suite estaba verde; los contratos pgTAP
 * comprueban lo que la RPC hace, no cuántas RPC hay; y `grep -rn "drop function"`
 * sobre todo el repositorio no devolvía **nada**.
 *
 * Se lee el texto de las migraciones y no el catálogo de PostgreSQL a propósito:
 * el catálogo sólo está disponible con Docker y la CLI de Supabase, así que una
 * prueba que lo consultara no correría en el bucle interno — que es justo cuando
 * alguien añade la sobrecarga. `supabase/tests/database/` comprueba la otra
 * mitad, contra una base real, en CI.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

interface FunctionEvent {
  readonly file: string;
  readonly name: string;
  readonly arity: number;
  readonly kind: 'create' | 'drop';
}

/**
 * Cuenta los argumentos de una declaración.
 *
 * Contar comas de primer nivel es suficiente y es lo correcto: un argumento
 * puede llevar un tipo con paréntesis (`numeric(10,2)`) y un valor por defecto,
 * así que partir por comas a secas daría más argumentos de los que hay.
 */
const arityOf = (parameters: string): number => {
  const trimmed = parameters.trim();
  if (trimmed === '') return 0;
  let depth = 0;
  let count = 1;
  for (const character of trimmed) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) count += 1;
  }
  return count;
};

const readEvents = (): FunctionEvent[] => {
  const events: FunctionEvent[] = [];
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    const creates = sql.matchAll(
      /^create\s+(?:or\s+replace\s+)?function\s+(api|private)\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\n\s*returns/gim,
    );
    for (const match of creates) {
      events.push({
        file,
        name: `${match[1]}.${match[2]}`,
        arity: arityOf(match[3]),
        kind: 'create',
      });
    }

    const drops = sql.matchAll(
      /drop\s+function\s+(?:if\s+exists\s+)?(api|private)\.([a-z0-9_]+)\s*\(([^)]*)\)/gim,
    );
    for (const match of drops) {
      events.push({
        file,
        name: `${match[1]}.${match[2]}`,
        arity: arityOf(match[3]),
        kind: 'drop',
      });
    }
  }
  return events;
};

/** Las aridades que siguen existiendo por función, tras aplicar las migraciones en orden. */
const liveSignatures = (): Map<string, Map<number, string>> => {
  const live = new Map<string, Map<number, string>>();
  for (const event of readEvents()) {
    if (!live.has(event.name)) live.set(event.name, new Map());
    const arities = live.get(event.name)!;
    if (event.kind === 'create') arities.set(event.arity, event.file);
    else arities.delete(event.arity);
  }
  return live;
};

describe('la lectura de migraciones ve algo', () => {
  it('encuentra las migraciones y sus funciones', () => {
    const events = readEvents();
    expect(events.filter((event) => event.kind === 'create').length).toBeGreaterThan(40);
  });

  it('cuenta argumentos sin partirse con un tipo entre paréntesis', () => {
    expect(arityOf('')).toBe(0);
    expect(arityOf('p_id text')).toBe(1);
    expect(arityOf('p_id text, p_revision bigint')).toBe(2);
    expect(arityOf('p_amount numeric(10,2), p_id text')).toBe(2);
  });
});

describe('una función tiene una sola firma', () => {
  it('no deja ninguna RPC con dos aridades vivas', () => {
    const offenders: string[] = [];
    for (const [name, arities] of liveSignatures()) {
      if (arities.size > 1) {
        const detail = [...arities.entries()]
          .map(([arity, file]) => `${arity} args (${file})`)
          .join(' y ');
        offenders.push(`${name}: ${detail}`);
      }
    }
    expect(
      offenders,
      'Una sobrecarga viva es una guarda opcional: quien llame la firma antigua '
      + 'se salta lo que la nueva añadió. Retira la anterior con `drop function` '
      + 'en la misma migración que crea la sustituta.',
    ).toEqual([]);
  });

  it('retira la sobrecarga de delete_engagement que borraba sin comparar revisión', () => {
    // Nombrada, no contada. Si vuelve, el mensaje dice cuál es.
    const arities = liveSignatures().get('api.delete_engagement');
    expect(arities && [...arities.keys()]).toEqual([3]);
  });

  it('retira la firma reemplazada en la misma migración que crea la sustituta', () => {
    // Un `drop` en una migración posterior deja una ventana entre despliegues
    // durante la cual la guarda antigua sigue concedida. La ventana de este
    // repositorio duró ocho días y es la entrada de abajo: la migración de
    // guardas creó la firma de tres argumentos y dejó viva la de dos, y la
    // sustitución sólo se completó en 20260920120000.
    //
    // Se registra en vez de borrarse porque una migración aplicada no se
    // reescribe. Es un presupuesto monótono como los del gate de fronteras: la
    // lista puede encoger y no puede crecer.
    const HISTORICAL = [
      '20260912181347_office_engagements_guards.sql: '
      + 'crea api.delete_engagement/3 y deja viva api.delete_engagement/2',
    ];
    const byFile = new Map<string, FunctionEvent[]>();
    for (const event of readEvents()) {
      if (!byFile.has(event.file)) byFile.set(event.file, []);
      byFile.get(event.file)!.push(event);
    }
    const seen = new Map<string, Set<number>>();
    const late: string[] = [];
    for (const [file, events] of byFile) {
      const dropsHere = new Set(
        events.filter((event) => event.kind === 'drop').map((event) => `${event.name}/${event.arity}`),
      );
      for (const event of events.filter((item) => item.kind === 'create')) {
        const previous = seen.get(event.name) ?? new Set<number>();
        for (const arity of previous) {
          if (arity !== event.arity && !dropsHere.has(`${event.name}/${arity}`)) {
            late.push(`${file}: crea ${event.name}/${event.arity} y deja viva ${event.name}/${arity}`);
          }
        }
        previous.add(event.arity);
        seen.set(event.name, previous);
      }
      for (const event of events.filter((item) => item.kind === 'drop')) {
        seen.get(event.name)?.delete(event.arity);
      }
    }
    expect(late).toEqual(HISTORICAL);
  });
});
