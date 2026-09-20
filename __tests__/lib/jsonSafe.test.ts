/**
 * `lib/jsonSafe` es lo que sobrevivió de dos módulos con nombre de proveedor.
 *
 * `sanitizeForFirestore` y `prepareArtifactForFirestore` se retiraron con
 * Firestore: la poda de campos existía por el límite de 1 MiB por documento, y
 * una fila `jsonb` no lo tiene. Lo que quedó es lo que no dependía del
 * proveedor, y estas pruebas son las de aquellos ficheros reducidas a eso.
 */
import { describe, expect, it } from 'vitest';
import { estimateBytes, stripUndefined } from '../../lib/jsonSafe';

describe('stripUndefined', () => {
  it('omits undefined object fields, at every depth', () => {
    expect(stripUndefined({
      keep: 'value',
      drop: undefined,
      nested: { keep: 1, drop: undefined },
    })).toEqual({ keep: 'value', nested: { keep: 1 } });
  });

  it('removes undefined array slots instead of turning them into null', () => {
    // La diferencia con `sanitizeForFirestore` es deliberada y es el motivo de
    // que exista esta prueba: aquel convertía el hueco en `null` porque
    // Firestore rechazaba `undefined` pero aceptaba `null`. Aquí el valor
    // ausente se va, que es lo que `JSON.stringify` haría con un objeto — y
    // tener dos comportamientos según el contenedor era el defecto.
    expect(stripUndefined({ list: [undefined, { keep: true, drop: undefined }, 'ok'] }))
      .toEqual({ list: [{ keep: true }, 'ok'] });
  });

  it('leaves a Date intact', () => {
    const date = new Date('2026-09-19T00:00:00.000Z');
    expect(stripUndefined({ at: date }).at).toBe(date);
  });

  it('passes primitives and null through', () => {
    expect(stripUndefined('x')).toBe('x');
    expect(stripUndefined(null)).toBeNull();
    expect(stripUndefined(7)).toBe(7);
  });
});

describe('estimateBytes', () => {
  it('measures the UTF-8 size of the JSON form', () => {
    expect(estimateBytes({ a: 1 })).toBe(7);
  });

  it('counts multi-byte characters as the bytes they are', () => {
    // «á» ocupa dos bytes en UTF-8: medir en `length` de cadena habría dado 4.
    expect(estimateBytes('á')).toBe(4);
  });

  it('returns 0 for a value that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(estimateBytes(cyclic)).toBe(0);
  });
});
