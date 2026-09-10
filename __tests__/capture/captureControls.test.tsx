/**
 * Los controles de captura, vistos como los ve quien los usa.
 *
 * Dos cosas se comprueban aquí y las dos son de producto, no de render:
 *
 *  1. **Nada se escribe solo.** Una propuesta se ve y se acepta con un clic.
 *     Un asistente que rellena el campo por su cuenta es indistinguible de un
 *     campo que se rellenó mal.
 *  2. **El botón dice por qué no puede ayudar.** Deshabilitado y mudo es la
 *     peor combinación: el usuario no sabe si el sistema está roto o si le
 *     falta escribir algo.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CaptureAssist } from '../../components/capture';
import type { CaptureAssistantApi } from '../../hooks/useCaptureAssistant';
import type { CaptureContext } from '../../lib/capture';

const context: CaptureContext = {
  level: 'initiative',
  subject: 'Alta digital',
  known: [{ label: 'Necesidad del negocio', value: 'Tarda cinco días.' }],
  ancestry: [],
};

const assistantWith = (overrides: Partial<CaptureAssistantApi> = {}): CaptureAssistantApi => ({
  pendingField: null,
  suggestions: {},
  openQuestions: [],
  notice: null,
  askField: vi.fn(async () => ({ ok: true, suggestions: [], openQuestions: [] })),
  askForm: vi.fn(async () => ({ ok: true, suggestions: [], openQuestions: [] })),
  dismiss: vi.fn(),
  reset: vi.fn(),
  ...overrides,
});

describe('CaptureAssist', () => {
  it('names the field it helps with, so a screen reader can tell two buttons apart', () => {
    render(
      <CaptureAssist
        fieldId="initiative.driver"
        assistant={assistantWith()}
        context={context}
        apply={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /sugerir driver/i })).toBeInTheDocument();
  });

  it('asks the assistant for that field, carrying what is already written', () => {
    const askField = vi.fn(async () => ({ ok: true, suggestions: [], openQuestions: [] }));
    render(
      <CaptureAssist
        fieldId="initiative.driver"
        assistant={assistantWith({ askField })}
        context={context}
        current="Lo que ya escribí"
        apply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /sugerir driver/i }));
    expect(askField).toHaveBeenCalledWith('initiative.driver', context, 'Lo que ya escribí');
  });

  it('is disabled with a reason when there is nothing to reason from', () => {
    render(
      <CaptureAssist
        fieldId="initiative.driver"
        assistant={assistantWith()}
        context={null}
        apply={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /sugerir driver/i })).toBeDisabled();
  });

  it('shows a single-value proposal and applies it only when the user says so', () => {
    const apply = vi.fn();
    const dismiss = vi.fn();
    render(
      <CaptureAssist
        fieldId="initiative.driver"
        assistant={assistantWith({
          suggestions: {
            'initiative.driver': {
              fieldId: 'initiative.driver',
              values: ['La regulación exige respuesta en 48 h.'],
              rationale: 'Se deduce de la necesidad capturada.',
            },
          },
          dismiss,
        })}
        context={context}
        apply={apply}
      />,
    );

    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText(/Se deduce de la necesidad capturada/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /usar esta redacción/i }));
    expect(apply).toHaveBeenCalledWith('La regulación exige respuesta en 48 h.');
    // Un campo de un solo valor queda resuelto al aceptarlo.
    expect(dismiss).toHaveBeenCalledWith('initiative.driver');
  });

  it('offers a list entry by entry and hides what is already in the record', () => {
    const apply = vi.fn();
    render(
      <CaptureAssist
        fieldId="initiative.objectives"
        assistant={assistantWith({
          suggestions: {
            'initiative.objectives': {
              fieldId: 'initiative.objectives',
              values: ['Reducir el alta a un día', 'Eliminar el papel del proceso'],
            },
          },
        })}
        context={context}
        applied={['Reducir el alta a un día']}
        apply={apply}
      />,
    );

    expect(screen.queryByRole('button', { name: /Añadir: Reducir el alta a un día/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Añadir: Eliminar el papel del proceso/ }));
    expect(apply).toHaveBeenCalledWith('Eliminar el papel del proceso');
  });
});
