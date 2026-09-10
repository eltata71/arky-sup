/**
 * Lo que se lee de la base de datos no se cree: se normaliza.
 *
 * El seguimiento es opcional, editable a mano y anterior a la mitad de los
 * campos que hoy tiene, así que un documento guardado puede traer cualquier
 * cosa. Estas pruebas fijan las tres decisiones del normalizador: una fila
 * incompleta se descarta en vez de romper la pantalla, una fila sin id **no**
 * se pierde —se le da uno— y las listas vacías no se guardan.
 */

import { describe, it, expect } from 'vitest';
import { normalizeAttentionTracking } from '../../services/architectureProjects/projectRuntimeValidation';

describe('normalizeAttentionTracking', () => {
  it('un valor que no es objeto no produce seguimiento', () => {
    expect(normalizeAttentionTracking(undefined)).toBeUndefined();
    expect(normalizeAttentionTracking('en curso')).toBeUndefined();
  });

  it('un estado desconocido cae en el inicial en vez de llegar a la pantalla', () => {
    const tracking = normalizeAttentionTracking({ status: 'inventado', priority: 'urgentísima' });
    expect(tracking).toMatchObject({ status: 'discovery', priority: 'medium' });
  });

  it('acota el avance y descarta lo que no es un número', () => {
    expect(normalizeAttentionTracking({ progress: 140 })?.progress).toBe(100);
    expect(normalizeAttentionTracking({ progress: -5 })?.progress).toBe(0);
    expect(normalizeAttentionTracking({ progress: '40' })?.progress).toBeUndefined();
  });

  it('las listas vacías no se guardan: ausente y vacío dicen lo mismo', () => {
    const tracking = normalizeAttentionTracking({ milestones: [], risks: [], contributions: [] });
    expect(tracking?.milestones).toBeUndefined();
    expect(tracking?.risks).toBeUndefined();
    expect(tracking?.contributions).toBeUndefined();
  });

  it('un hito sin fecha se descarta; uno sin id conserva su contenido', () => {
    const tracking = normalizeAttentionTracking({
      milestones: [
        { name: 'Sin fecha' },
        { name: 'Contexto aprobado', dueAt: '2026-03-01T00:00:00.000Z', status: 'met' },
      ],
    });
    expect(tracking?.milestones).toHaveLength(1);
    expect(tracking?.milestones?.[0]).toMatchObject({ id: 'hito-2', name: 'Contexto aprobado', status: 'met' });
  });

  it('un riesgo de nivel desconocido se guarda como medio, no se pierde', () => {
    const tracking = normalizeAttentionTracking({
      risks: [{ description: 'El proveedor no confirma', level: 'apocalíptico' }],
    });
    expect(tracking?.risks?.[0]).toMatchObject({ description: 'El proveedor no confirma', level: 'medium' });
  });

  it('una contribución sin iniciativa se descarta: no se puede consolidar contra nada', () => {
    const tracking = normalizeAttentionTracking({
      contributions: [
        { statement: 'Huérfana' },
        { initiativeId: 'ini-1', statement: 'Alta por API', weight: 250, state: 'blocked' },
      ],
    });
    expect(tracking?.contributions).toHaveLength(1);
    expect(tracking?.contributions?.[0]).toMatchObject({
      initiativeId: 'ini-1',
      statement: 'Alta por API',
      weight: 100,
      state: 'blocked',
    });
  });
});
