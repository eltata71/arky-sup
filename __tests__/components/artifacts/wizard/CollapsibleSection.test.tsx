import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CollapsibleSection } from '../../../../components/artifacts/wizard/CollapsibleSection';

describe('CollapsibleSection', () => {
  it('starts collapsed and reveals content on click', () => {
    render(
      <CollapsibleSection label="Ver detalle técnico">
        <p>contenido técnico</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByRole('button', { name: /Ver detalle técnico/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/contenido técnico/i)).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/contenido técnico/i)).toBeInTheDocument();
  });

  it('respects defaultOpen=true and toggles to a custom open label', () => {
    render(
      <CollapsibleSection label="Ver detalle" openLabel="Ocultar detalle" defaultOpen>
        <span>panel</span>
      </CollapsibleSection>,
    );
    expect(screen.getByText(/panel/i)).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /Ocultar detalle/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('wires aria-controls to the panel id', () => {
    render(
      <CollapsibleSection label="Trazabilidad" defaultOpen>
        <p>panel</p>
      </CollapsibleSection>,
    );
    const trigger = screen.getByRole('button');
    const controlsId = trigger.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId!)).toBeInTheDocument();
  });
});
