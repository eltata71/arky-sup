/**
 * Las invariantes de la Iniciativa de Negocio, sin React.
 *
 * `buildInitiative` ya ensamblaba los campos; lo que faltaba era la puerta.
 * Las reglas —tiene título, describe una necesidad, tiene dueño— vivían encima
 * del constructor, dentro de `InitiativeContext`, y por tanto fuera de su
 * alcance: un segundo llamador las habría saltado sin enterarse.
 */

import { describe, expect, it } from 'vitest';
import { createBusinessInitiative } from '../../../services/businessInitiatives/businessInitiativeFactory';

const valid = {
  input: { title: 'Alta digital de clientes', need: 'El alta tarda 12 días' },
  userId: 'u1',
  existingCodes: [] as string[],
  now: '2026-09-02T00:00:00.000Z',
};

describe('createBusinessInitiative — lo que se niega a construir', () => {
  it('rechaza una iniciativa sin título', () => {
    const result = createBusinessInitiative({ ...valid, input: { ...valid.input, title: '  ' } });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.rejection.reason).toBe('title-required');
  });

  it('rechaza una iniciativa que no dice qué necesidad cubre', () => {
    // Es la regla que da sentido a los tres niveles: si la iniciativa no dice
    // para qué es, las atenciones que la sirven tampoco pueden.
    const result = createBusinessInitiative({ ...valid, input: { ...valid.input, need: '' } });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.rejection.reason).toBe('need-required');
  });

  it('rechaza una iniciativa sin dueño', () => {
    // `firestore.rules` autoriza contra `userId`. Sin él la iniciativa
    // existiría en memoria y en ningún otro sitio.
    const result = createBusinessInitiative({ ...valid, userId: '' });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.rejection.reason).toBe('owner-required');
  });
});

describe('createBusinessInitiative — lo que sí construye', () => {
  it('recorta el título y la necesidad', () => {
    const result = createBusinessInitiative({
      ...valid,
      input: { title: '  Alta digital  ', need: '  Tarda mucho  ' },
    });
    if (result.outcome !== 'created') throw new Error('debería crearse');
    expect(result.initiative.title).toBe('Alta digital');
    expect(result.initiative.need).toBe('Tarda mucho');
  });

  it('asigna el siguiente código libre y nace en borrador', () => {
    const result = createBusinessInitiative({ ...valid, existingCodes: ['NEG-2026-001'] });
    if (result.outcome !== 'created') throw new Error('debería crearse');
    expect(result.initiative.code).toBe('NEG-2026-002');
    expect(result.initiative.status).toBe('draft');
  });

  it('nace con las colecciones vacías y no ausentes', () => {
    // Para que todo consumidor pueda recorrerlas sin una guarda.
    const result = createBusinessInitiative(valid);
    if (result.outcome !== 'created') throw new Error('debería crearse');
    expect(result.initiative.kpis).toEqual([]);
    expect(result.initiative.milestones).toEqual([]);
    expect(result.initiative.risks).toEqual([]);
    expect(result.initiative.stakeholders).toEqual([]);
  });
});
