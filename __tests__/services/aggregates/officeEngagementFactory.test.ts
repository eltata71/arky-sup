/**
 * Las invariantes de la Solicitud de Entregable, comprobadas sin montar React.
 *
 * Ése es el punto de la Ola 3, y no una cuestión de estilo: hasta ahora este
 * agregado se construía con un literal dentro de un `useCallback` de
 * `OfficeContext`, así que la única forma de comprobar «un entregable pertenece
 * a una atención y hereda su iniciativa» era renderizar un proveedor y simular
 * un clic. Una invariante que sólo se puede probar así es una convención de una
 * pantalla, no una invariante.
 */

import { describe, expect, it } from 'vitest';
import { createOfficeEngagement } from '../../../services/architectureOffice/officeEngagementFactory';
import { planCharterDeterministic } from '../../../services/architectureOffice/OfficeEngagementPlanner';
import type { OfficeActor } from '../../../services/architectureOffice/OfficeTypes';

const actor: OfficeActor = { id: 'u1', name: 'Ana', role: 'admin' } as OfficeActor;

// El charter real del planificador determinista, no uno inventado: si su forma
// cambia, estas pruebas lo notan en vez de seguir pasando contra una maqueta.
const charter = planCharterDeterministic({
  title: 'Modelo de datos',
  brief: 'Necesitamos el modelo canónico de cliente',
});

const valid = {
  projectId: 'proj-1',
  title: 'Modelo de datos',
  brief: 'Necesitamos el modelo canónico',
  initiativeIds: ['ini-1'],
  charter,
  createdBy: actor,
  id: 'eng-1',
  now: () => '2026-09-02T00:00:00.000Z',
};

describe('createOfficeEngagement — lo que se niega a construir', () => {
  it('rechaza un entregable sin título', () => {
    const result = createOfficeEngagement({ ...valid, title: '   ' });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.rejection.reason).toBe('title-required');
  });

  it('rechaza un entregable que no pertenece a ninguna atención', () => {
    const result = createOfficeEngagement({ ...valid, projectId: '' });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.rejection.reason).toBe('attention-required');
  });

  it('rechaza un entregable sin vínculo con ninguna iniciativa', () => {
    const result = createOfficeEngagement({ ...valid, initiativeIds: [], businessProjectIds: [] });
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') {
      expect(result.rejection.reason).toBe('initiative-required');
      // El mensaje va a una pantalla, así que dice qué hacer.
      expect(result.rejection.message).toContain('iniciativa');
    }
  });

  it('devuelve un rechazo tipado en vez de lanzar', () => {
    // Que falte la iniciativa es un desenlace que la interfaz pinta, no una
    // excepción: un `throw` empujaría a cada llamador a un `try` que la mayoría
    // escribiría vacío.
    expect(() => createOfficeEngagement({ ...valid, initiativeIds: [] })).not.toThrow();
  });
});

describe('createOfficeEngagement — lo que sí construye', () => {
  it('acepta el espejo de códigos cuando el proyecto es heredado y no tiene ids', () => {
    // `portfolioResolver` migra estos registros de forma perezosa en cada
    // lectura. Exigir el id aquí rechazaría datos que el producto sí resuelve.
    const result = createOfficeEngagement({
      ...valid,
      initiativeIds: [],
      businessProjectIds: ['NEG-2026-001'],
    });
    expect(result.outcome).toBe('created');
    if (result.outcome === 'created') {
      expect(result.engagement.businessProjectIds).toEqual(['NEG-2026-001']);
    }
  });

  it('nace esperando charter, con presupuesto y sin decisiones del ARB', () => {
    const result = createOfficeEngagement(valid);
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.engagement.status).toBe('awaiting-charter');
    expect(result.engagement.arbDecisions).toEqual([]);
    expect(result.engagement.budget).toBeDefined();
  });

  it('nace con su rastro de auditoría ya escrito', () => {
    // Dos hechos del dominio que ocurrieron aquí: se abrió y se propuso un
    // plan. Un rastro que hay que acordarse de añadir después es un rastro que
    // algún día no se añadirá.
    const result = createOfficeEngagement(valid);
    if (result.outcome !== 'created') throw new Error('debería crearse');
    const actions = result.engagement.auditTrail.map((entry) => entry.action);
    expect(actions).toEqual(['engagement-created', 'charter-proposed']);
  });

  it('limpia y deduplica los ids de iniciativa', () => {
    const result = createOfficeEngagement({
      ...valid,
      initiativeIds: [' ini-1 ', 'ini-1', '', 'ini-2'],
    });
    if (result.outcome !== 'created') throw new Error('debería crearse');
    expect(result.engagement.initiativeIds).toEqual(['ini-1', 'ini-2']);
  });

  it('deriva las tareas del charter', () => {
    const result = createOfficeEngagement(valid);
    if (result.outcome !== 'created') throw new Error('debería crearse');
    expect(result.engagement.tasks.length).toBeGreaterThan(0);
  });
});
