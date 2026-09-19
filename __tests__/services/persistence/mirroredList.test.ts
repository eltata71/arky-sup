/**
 * @vitest-environment jsdom
 *
 * El espejo local es una escritura en `localStorage`, así que hace falta un DOM.
 *
 * `MirroredList` existe porque este patrón —caché, Firestore, espejo local—
 * estaba escrito cinco veces dentro de `firestoreService`, una por contexto,
 * con diferencias que no eran decisiones sino el orden en que se escribieron.
 * Al repartir aquel fichero por contextos, las cinco copias habrían pasado a
 * ser seis, cada una en un módulo distinto y ya sin nadie que las viera juntas.
 *
 * Lo que estas pruebas fijan son las dos reglas que hacían que las copias se
 * diferenciaran, y que son justo las que es fácil equivocarse al copiar:
 *
 *   1. Un borrador local **no es** una escritura confirmada.
 *   2. La caché en memoria sólo guarda lo confirmado — si guardara también lo
 *      fallido, una escritura que no llegó se leería como buena durante los
 *      cinco minutos siguientes, que es exactamente el tiempo que tarda alguien
 *      en cerrar la pestaña convencido de que su trabajo está guardado.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MirroredList } from '../../../services/persistence/mirroredList';
import type { PersistenceResult } from '../../../services/persistence';

interface Row { id: string; name: string }

const confirmed: PersistenceResult<unknown> = {
  status: 'success', success: true, operationId: 'op-1', target: 'supabase',
};
const offline: PersistenceResult<unknown> = {
  status: 'offline', success: false, operationId: 'op-2', target: 'local-draft',
};
const denied: PersistenceResult<unknown> = {
  status: 'permission-denied', success: false, operationId: 'op-3', target: 'supabase',
};

const makeList = () => new MirroredList<Row>((scope) => `rows_${scope}`);

describe('MirroredList', () => {
  beforeEach(() => localStorage.clear());

  it('no sabe nada de un ámbito que nunca se ha leído', () => {
    const list = makeList();
    expect(list.cached('p1')).toBeNull();
    expect(list.fallback('p1')).toEqual([]);
    expect(list.known('p1')).toEqual([]);
  });

  it('recuerda una lectura remota y la devuelve sin volver a la red', () => {
    const list = makeList();
    const rows = [{ id: 'a', name: 'A' }];
    expect(list.remember('p1', rows)).toBe(rows);
    expect(list.cached('p1')).toEqual(rows);
  });

  it('una escritura confirmada deja de acuerdo la caché y el espejo', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }]);
    list.upsert('p1', { id: 'b', name: 'B' }, confirmed);

    expect(list.cached('p1')).toEqual([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]);
    // Y sobrevive a que la caché caduque o el navegador se recargue.
    expect(makeList().fallback('p1')).toEqual([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]);
  });

  it('reemplaza en vez de duplicar cuando el id ya existe, y lo pone delante', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'viejo' }, { id: 'z', name: 'Z' }]);
    list.upsert('p1', { id: 'a', name: 'nuevo' }, confirmed);

    expect(list.cached('p1')).toEqual([{ id: 'a', name: 'nuevo' }, { id: 'z', name: 'Z' }]);
  });

  it('una escritura offline guarda el trabajo en el espejo pero NO en la caché', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }]);
    list.upsert('p1', { id: 'b', name: 'B' }, offline);

    // La caché sigue reflejando lo que la base de datos tiene de verdad...
    expect(list.cached('p1')).toEqual([{ id: 'a', name: 'A' }]);
    // ...y el trabajo del usuario no se ha perdido.
    expect(makeList().fallback('p1')).toEqual([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]);
  });

  it('una escritura rechazada por las reglas no toca ninguno de los dos espejos', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }]);
    list.upsert('p1', { id: 'b', name: 'B' }, denied);

    // Guardar un borrador de algo que el usuario no tiene permiso para escribir
    // es prometerle una sincronización que nunca va a ocurrir.
    expect(list.cached('p1')).toEqual([{ id: 'a', name: 'A' }]);
    expect(makeList().fallback('p1')).toEqual([]);
  });

  it('respeta el tope de las listas que sólo crecen', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    list.upsert('p1', { id: 'c', name: 'C' }, confirmed, 2);

    expect(list.cached('p1')).toEqual([{ id: 'c', name: 'C' }, { id: 'a', name: 'A' }]);
  });

  it('borrar quita el elemento de los dos espejos', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    list.remove('p1', 'a');

    expect(list.cached('p1')).toEqual([{ id: 'b', name: 'B' }]);
    // Sin esto el elemento reaparece en cuanto se pierde la red.
    expect(makeList().fallback('p1')).toEqual([{ id: 'b', name: 'B' }]);
  });

  it('mantiene los ámbitos separados', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }]);
    list.remember('p2', [{ id: 'b', name: 'B' }]);

    list.remove('p1', 'a');
    expect(list.cached('p2')).toEqual([{ id: 'b', name: 'B' }]);
  });

  it('invalidate vuelve a la red sin perder el espejo local', () => {
    const list = makeList();
    list.upsert('p1', { id: 'a', name: 'A' }, confirmed);
    list.invalidate('p1');

    expect(list.cached('p1')).toBeNull();
    expect(list.known('p1')).toEqual([{ id: 'a', name: 'A' }]);
  });

  it('clear olvida todos los ámbitos de la caché', () => {
    const list = makeList();
    list.remember('p1', [{ id: 'a', name: 'A' }]);
    list.remember('p2', [{ id: 'b', name: 'B' }]);
    list.clear();

    expect(list.cached('p1')).toBeNull();
    expect(list.cached('p2')).toBeNull();
  });
});
