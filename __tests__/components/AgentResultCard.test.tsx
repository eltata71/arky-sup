/**
 * UI regression test for the bug where the agent reported "creé / regeneré
 * el artefacto" but the user had no way to navigate to the result. The
 * card now must surface the "Abrir artefacto" button whenever the
 * executor populated either `newArtifactId` (brand-new artifact) or
 * `newArtifactVersionId` (new version of an existing one).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentResultCard } from '../../components/assistant/AgentActionCard';
import type { AgentActionResult } from '../../services/agent';

const baseResult: Omit<AgentActionResult, 'status' | 'newArtifactId' | 'newArtifactVersionId'> = {
  previousArtifactVersionId: 'prev',
  appliedChanges: [],
  validationResult: null,
  messages: ['Hecho.'],
  errors: [],
  traceId: 't-1',
};

describe('AgentResultCard', () => {
  it('shows "Abrir artefacto creado" when newArtifactId is populated', () => {
    const result: AgentActionResult = {
      ...baseResult,
      status: 'success',
      newArtifactId: 'art-new',
      newArtifactVersionId: null,
    };
    const onOpen = vi.fn();
    render(<AgentResultCard result={result} onOpenNewVersion={onOpen} onDismiss={vi.fn()} />);
    const button = screen.getByRole('button', { name: /abrir artefacto creado/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows "Abrir nueva versión" when newArtifactVersionId is populated', () => {
    const result: AgentActionResult = {
      ...baseResult,
      status: 'success',
      newArtifactId: null,
      newArtifactVersionId: 'art-v2',
    };
    const onOpen = vi.fn();
    render(<AgentResultCard result={result} onOpenNewVersion={onOpen} onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: /abrir nueva versión/i })).toBeInTheDocument();
  });

  it('does NOT show the open button on failed actions', () => {
    const result: AgentActionResult = {
      ...baseResult,
      status: 'failed',
      newArtifactId: 'art-new',
      newArtifactVersionId: null,
      messages: ['No se pudo.'],
    };
    render(<AgentResultCard result={result} onOpenNewVersion={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /abrir artefacto creado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abrir nueva versión/i })).not.toBeInTheDocument();
  });

  it('does NOT show the open button when neither id is set', () => {
    const result: AgentActionResult = {
      ...baseResult,
      status: 'success',
      newArtifactId: null,
      newArtifactVersionId: null,
    };
    render(<AgentResultCard result={result} onOpenNewVersion={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /abrir/i })).not.toBeInTheDocument();
  });

  it('renders the failure / cancelled headline honestly', () => {
    const failed: AgentActionResult = {
      ...baseResult,
      status: 'failed',
      newArtifactId: null,
      newArtifactVersionId: null,
      messages: ['Falló la creación.'],
    };
    render(<AgentResultCard result={failed} onDismiss={vi.fn()} />);
    expect(screen.getByText(/acción no aplicada/i)).toBeInTheDocument();
    expect(screen.queryByText(/acción completada/i)).not.toBeInTheDocument();
  });
});
