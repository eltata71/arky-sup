/**
 * El seguimiento del proyecto y su impacto en la iniciativa, en pantalla.
 *
 * Dos afirmaciones, las dos sobre honestidad: un proyecto que nadie mide no se
 * dibuja como un proyecto al 0 %, y un resultado esperado que ningún proyecto
 * declara servir aparece a la vista en vez de quedarse en un hueco que nadie
 * nota.
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InitiativeDeliveryPanel } from '../../components/businessInitiatives';
import { buildInitiative } from '../../services/businessInitiatives';
import { toInitiativeCode } from '../../lib/eaTerminology';
import type { BusinessInitiative } from '../../services/businessInitiatives';
import type { Project } from '../../types';

const ISO = '2026-08-27T12:00:00.000Z';

const initiative = (): BusinessInitiative => ({
  ...buildInitiative(
    { title: 'Alta digital de clientes', need: 'El alta tarda cinco días.' },
    'u1',
    [],
    ISO,
  ),
  id: 'ini-1',
  code: toInitiativeCode('NEG-2026-001') ?? '',
  expectedOutcomes: [
    { id: 'out-1', statement: 'Alta en menos de un día' },
    { id: 'out-2', statement: 'Menos abandono en el proceso' },
  ],
  kpis: [{ id: 'kpi-1', name: 'Días de alta', unit: 'días' }],
});

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Alta por API',
  description: '',
  projectContext: [],
  artifacts: [],
  createdAt: ISO,
  updatedAt: ISO,
  initiativeIds: ['ini-1'],
  ...overrides,
});

const renderPanel = (projects: Project[]) => {
  const record = initiative();
  return render(
    <MemoryRouter>
      <InitiativeDeliveryPanel initiative={record} initiatives={[record]} projects={projects} />
    </MemoryRouter>,
  );
};

describe('InitiativeDeliveryPanel', () => {
  it('sin proyectos, invita a abrir el primero en vez de dibujar un cero', () => {
    renderPanel([]);
    expect(screen.getByText(/Ningún proyecto de arquitectura responde todavía/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo proyecto de arquitectura/ })).toBeInTheDocument();
  });

  it('un proyecto sin seguimiento se declara sin medir, no al 0 %', () => {
    renderPanel([project()]);
    expect(screen.getByText('Sin seguimiento')).toBeInTheDocument();
    expect(screen.getByText('Ningún proyecto declara avance todavía')).toBeInTheDocument();
  });

  it('consolida el avance declarado y hereda los riesgos severos', () => {
    renderPanel([project({
      attention: {
        status: 'design',
        priority: 'high',
        progress: 60,
        risks: [{ id: 'r1', description: 'El proveedor no confirma', level: 'critical' }],
        contributions: [{
          id: 'c1',
          initiativeId: 'ini-1',
          statement: 'Deja el alta disponible por API',
          outcomeId: 'out-1',
          state: 'in-progress',
        }],
      },
    })]);

    expect(screen.getByText('60 %')).toBeInTheDocument();
    expect(screen.getByText('Deja el alta disponible por API')).toBeInTheDocument();
    // El riesgo del proyecto sube: es lo que la iniciativa hereda.
    expect(screen.getByText('Riesgos severos heredados').closest('div'))
      .toHaveTextContent('Riesgos severos heredados');
    expect(screen.getByText('Altos y críticos que sus proyectos han registrado')).toBeInTheDocument();
    // Aparece dos veces y las dos son ciertas: el contador de la iniciativa y
    // el semáforo del proyecto, que un riesgo crítico ha puesto en rojo.
    expect(screen.getAllByText('Fuera de rumbo')).toHaveLength(2);
  });

  it('saca a la vista los resultados y los indicadores que nadie declara servir', () => {
    renderPanel([project({
      attention: {
        status: 'design',
        priority: 'high',
        contributions: [{
          id: 'c1',
          initiativeId: 'ini-1',
          statement: 'Alta por API',
          outcomeId: 'out-1',
          state: 'planned',
        }],
      },
    })]);

    expect(screen.getByText(/1 resultado\(s\) esperado\(s\) sin proyecto/)).toBeInTheDocument();
    expect(screen.getByText(/Menos abandono en el proceso/)).toBeInTheDocument();
    expect(screen.getByText(/1 indicador\(es\) que ningún proyecto declara mover/)).toBeInTheDocument();
  });
});
