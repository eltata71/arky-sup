/**
 * El inventario de agentes y la ficha de cada uno.
 *
 * Dos afirmaciones. La primera es de descubribilidad: la tarjeta se puede
 * abrir, porque un reparto que sólo se puede *configurar* obliga a entrar en un
 * formulario para leer quién es alguien. La segunda es de confianza: la ficha
 * distingue lo que trae el producto de lo que ha añadido esta organización, y
 * enseña lo que **no** se puede configurar como lo que es —gobierno— en vez de
 * ocultarlo.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentProfileCard, AgentProfileSheet, AgentTeamMap } from '../../components/architectureOffice/agentProfile';
import { resolveAgentProfile, resolveAgentProfiles } from '../../services/architectureOffice/domain/officeAgentProfile';
import { DEFAULT_MAX_SPECIALISTS } from '../../services/architectureOffice/application/officeOrchestration';

const sofia = () => resolveAgentProfile('sofia', {
  agentId: 'sofia',
  userId: 'u1',
  schemaVersion: 1,
  knowledge: ['El canal de corredores corre sobre AS/400.'],
  memory: ['Nunca proponer sustituir el core de pólizas en este alcance.'],
  skills: ['reaseguro-facultativo'],
  updatedAt: '2026-09-05T00:00:00.000Z',
});

describe('AgentProfileCard', () => {
  it('la tarjeta abre la ficha, y configurar es una acción aparte', () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    render(<AgentProfileCard profile={sofia()} onOpen={onOpen} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: /Ver la ficha de Sofía/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});

describe('AgentProfileSheet', () => {
  const renderSheet = () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(<AgentProfileSheet profile={sofia()} onClose={onClose} onEdit={onEdit} />);
    return { onEdit, onClose };
  };

  it('muestra el expediente completo: quién es, qué sabe y qué recuerda', () => {
    renderSheet();
    expect(screen.getByRole('heading', { name: 'Sofía' })).toBeInTheDocument();
    expect(screen.getByText('El canal de corredores corre sobre AS/400.')).toBeInTheDocument();
    expect(screen.getByText('Nunca proponer sustituir el core de pólizas en este alcance.')).toBeInTheDocument();
    expect(screen.getByText('reaseguro-facultativo')).toBeInTheDocument();
  });

  it('distingue lo añadido por la organización de lo que trae el producto', () => {
    renderSheet();
    // Las tres entradas añadidas se marcan; los dominios heredados, no.
    expect(screen.getAllByText('De tu organización')).toHaveLength(3);
    // «insurance» sale dos veces —como dominio en la cabecera y como habilidad
    // heredada— y ninguna de las dos lleva la marca.
    expect(screen.getAllByText('insurance').length).toBeGreaterThan(0);
  });

  it('enseña el gobierno como gobierno: se ve, no se toca', () => {
    renderSheet();
    expect(screen.getByText('Puede producir')).toBeInTheDocument();
    expect(screen.getByText('Puede revisar')).toBeInTheDocument();
    expect(screen.getByText(/no se configuran: son gobierno/)).toBeInTheDocument();
  });

  it('lleva al formulario desde la ficha, sin haber podido editar nada en ella', () => {
    const { onEdit } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar ficha' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('ofrece un cierre visible y accesible además del fondo del panel', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ficha' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('AgentTeamMap', () => {
  it('explica el flujo real y abre el perfil seleccionado', () => {
    const onSelect = vi.fn();
    const profiles = resolveAgentProfiles([]);
    render(<AgentTeamMap profiles={profiles} onSelect={onSelect} />);

    expect(screen.getByRole('heading', { name: 'El camino de una solicitud' })).toBeInTheDocument();
    expect(screen.getByText('Coordinación')).toBeInTheDocument();
    expect(screen.getByText('Especialistas')).toBeInTheDocument();
    expect(screen.getByText('Consolidación')).toBeInTheDocument();

    // Cada etapa lleva su verbo, no sólo el nombre del puesto: es lo que hay
    // que entender la primera vez que se mira el reparto.
    expect(screen.getByText('01 · Entiende')).toBeInTheDocument();
    expect(screen.getByText('02 · Resuelven')).toBeInTheDocument();
    expect(screen.getByText('03 · Verifica')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Abrir la ficha de/ })[0]);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('publica la capacidad declarada del reparto, leída de las fichas', () => {
    const profiles = resolveAgentProfiles([]);
    render(<AgentTeamMap profiles={profiles} onSelect={vi.fn()} />);

    // No es una medición de la carga actual —eso vive en el tablero de la
    // Oficina, junto a los encargos que la producen— sino lo que el reparto
    // declara poder atender.
    const capacity = profiles.reduce((total, profile) => total + profile.maxConcurrentTasks, 0);
    expect(screen.getByText('Tareas simultáneas admitidas')).toBeInTheDocument();
    expect(screen.getByText(String(capacity))).toBeInTheDocument();
    expect(screen.getByText('Dominios cubiertos')).toBeInTheDocument();
  });

  it('el límite de especialistas que se anuncia es el que aplica la orquestación', () => {
    // Una cifra decorativa aquí sería peor que ninguna: diría que el equipo se
    // comporta de una forma y el motor haría otra.
    render(<AgentTeamMap profiles={resolveAgentProfiles([])} onSelect={vi.fn()} />);

    expect(
      screen.getByText(`Trabajan en paralelo. Como mucho ${DEFAULT_MAX_SPECIALISTS} por solicitud.`),
    ).toBeInTheDocument();
  });
});
