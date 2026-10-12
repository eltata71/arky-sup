import { describe, expect, it } from 'vitest';
import { es } from '../../../lib/i18n/locales/es';
import { esCore, SPANISH_SECTION_LOADERS } from '../../../lib/i18n/locales/spanish';

describe('diccionario español partido (14.6)', () => {
  it('núcleo + secciones reconstruyen es exactamente, sin pérdidas ni cambios de texto', async () => {
    const merged: Record<string, string> = { ...esCore };
    for (const loader of Object.values(SPANISH_SECTION_LOADERS)) Object.assign(merged, await loader());
    expect(merged).toEqual(es);
  });

  it('cada clave vive en un solo trozo', async () => {
    const seen = new Map<string, string>();
    const place = (name: string, d: Record<string, string>) => {
      for (const key of Object.keys(d)) {
        expect(seen.has(key), `${key} en ${name} y ${seen.get(key)}`).toBe(false);
        seen.set(key, name);
      }
    };
    place('core', esCore);
    for (const [name, loader] of Object.entries(SPANISH_SECTION_LOADERS)) place(name, await loader());
  });

  it('el núcleo es una fracción del diccionario', () => {
    expect(Object.keys(esCore).length).toBeLessThan(Object.keys(es).length / 4);
  });
});
