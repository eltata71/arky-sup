/**
 * The creation path from one level to the next.
 *
 * Each level can open the level below it, and the point of these tests is the
 * *context*: arriving from an initiative, the gate that normally demands one
 * must not ask again, and the initiative must reach the assistant. A flow that
 * forgets where the user came from is the defect worth guarding.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AssistantLauncher } from '../../components/architectureOffice/AssistantLauncher';

/** Mirrors how `InitiativeRoom` hands off to the projects screen. */
const LINK = (initiativeId: string) => `/projects?iniciativa=${initiativeId}&crear=guiado`;

const ParamProbe: React.FC = () => {
  const [params] = useSearchParams();
  return (
    <ul>
      <li>iniciativa: {params.get('iniciativa') ?? '—'}</li>
      <li>crear: {params.get('crear') ?? '—'}</li>
    </ul>
  );
};

describe('creation deep link', () => {
  it('carries the initiative and the mode, which is what lets the gate stand down', () => {
    render(
      <MemoryRouter initialEntries={[LINK('init-7')]}>
        <Routes><Route path="/projects" element={<ParamProbe />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('iniciativa: init-7')).toBeInTheDocument();
    expect(screen.getByText('crear: guiado')).toBeInTheDocument();
  });
});

describe('AssistantLauncher', () => {
  it('names the record the team would be asked about', () => {
    render(<AssistantLauncher onOpen={() => {}} label="Abrir el equipo de arquitectura para Siniestros digitales" />);
    expect(
      screen.getByRole('button', { name: 'Abrir el equipo de arquitectura para Siniestros digitales' }),
    ).toBeInTheDocument();
  });

  it('is announced once, not as icon plus repeated caption', () => {
    // The visible caption is `aria-hidden`; the accessible name carries the
    // record. Announcing both would repeat "equipo de arquitectura".
    render(<AssistantLauncher onOpen={() => {}} label="Abrir el equipo de arquitectura para X" />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Equipo de arquitectura');
    expect(button.getAttribute('aria-label')).toBe('Abrir el equipo de arquitectura para X');
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('opens the dock', () => {
    const onOpen = vi.fn();
    render(<AssistantLauncher onOpen={onOpen} label="Abrir el equipo" />);
    screen.getByRole('button').click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
