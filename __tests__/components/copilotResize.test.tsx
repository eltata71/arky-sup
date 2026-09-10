/**
 * El asa del copiloto, comprobada por lo que hace accesible.
 *
 * WCAG 2.2 · 2.5.7 (*Dragging Movements*) es lo que estas pruebas defienden:
 * una función que sólo se consigue arrastrando deja fuera a quien usa teclado,
 * conmutador o control por voz. El arrastre no se simula aquí —jsdom no tiene
 * puntero real— pero el camino que la norma exige sí, y es el que se rompería
 * sin que nadie lo notara.
 *
 * @vitest-environment jsdom
 */

import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { ResizeHandle } from '../../components/ui/ResizeHandle';

const Harness: React.FC = () => {
  const panel = useResizablePanel({
    defaultWidth: 384,
    minWidth: 320,
    maxWidth: 640,
    storageKey: 'test.panel.width',
    edge: 'start',
  });
  return (
    <div>
      <ResizeHandle {...panel.handleProps} label="Ancho del panel" active={panel.resizing} />
      <span data-testid="width">{panel.width}</span>
    </div>
  );
};

const handle = () => screen.getByRole('separator', { name: 'Ancho del panel' });
const width = () => Number(screen.getByTestId('width').textContent);

describe('useResizablePanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('announces itself as a separator with a value a screen reader can read', () => {
    render(<Harness />);

    expect(handle()).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle()).toHaveAttribute('aria-valuenow', '384');
    expect(handle()).toHaveAttribute('aria-valuemin', '320');
    expect(handle()).toHaveAttribute('aria-valuemax', '640');
    expect(handle()).toHaveAttribute('tabindex', '0');
  });

  it('resizes from the keyboard, so dragging is never the only way', () => {
    render(<Harness />);
    // En el panel derecho «izquierda» ensancha, que es lo que el usuario ve.
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(width()).toBe(400);

    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(width()).toBe(384);
  });

  it('takes a coarse step with Shift, which is what makes the keyboard usable', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });

    expect(width()).toBe(448);
  });

  it('never leaves the declared range', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(width()).toBe(640);

    fireEvent.keyDown(handle(), { key: 'End' });
    expect(width()).toBe(320);

    // Ya en el mínimo, seguir estrechando no hace nada. Un panel que se puede
    // reducir hasta desaparecer se pierde y no se recupera.
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(width()).toBe(320);
  });

  it('remembers the width across mounts, per device', () => {
    const first = render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    first.unmount();

    render(<Harness />);
    expect(width()).toBe(448);
  });

  it('clamps a width stored by a build with different limits instead of discarding it', () => {
    // La preferencia sigue siendo válida aunque el rango haya cambiado: quien
    // lo quería ancho lo sigue queriendo lo más ancho que hoy se permita.
    window.localStorage.setItem('test.panel.width', '2000');
    render(<Harness />);

    expect(width()).toBe(640);
  });

  it('restores the default on a double click, the standard undo for a drag', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(width()).toBe(640);

    fireEvent.doubleClick(handle());
    expect(width()).toBe(384);
  });
});
