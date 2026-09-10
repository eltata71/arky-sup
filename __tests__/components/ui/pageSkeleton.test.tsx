/**
 * El esqueleto de página, comprobado por lo que anuncia y por lo que reserva.
 *
 * Su valor está en las dos cosas a la vez: enseñar la forma de la pantalla a
 * quien la ve, y decir una sola frase a quien no. Un esqueleto que anuncia
 * veinte bloques es más ruidoso que el spinner que vino a sustituir.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageSkeleton } from '../../../components/ui/PageSkeleton';

describe('PageSkeleton', () => {
  it('announces the load once, with what is loading', () => {
    render(<PageSkeleton label="Cargando el centro de mando" />);

    const status = screen.getByRole('status', { name: 'Cargando el centro de mando' });
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('hides every block from assistive technology', () => {
    const { container } = render(<PageSkeleton label="Cargando" tiles={4} panels={2} hero />);
    const status = screen.getByRole('status');

    // Todo lo que hay dentro es geometría. Si algún bloque se anunciara, el
    // lector oiría la maqueta de la página en vez de saber que está esperando.
    const visibleToAt = Array.from(container.querySelectorAll('div'))
      .filter((node) => node !== status && node.getAttribute('aria-hidden') !== 'true');
    expect(visibleToAt.every((node) => !node.textContent?.trim())).toBe(true);
  });

  it('reserves exactly the shape the caller declares', () => {
    const { container } = render(
      <PageSkeleton label="Cargando" header={false} hero={false} tiles={3} panels={0} />,
    );

    expect(container.querySelectorAll('.rounded-2xl')).toHaveLength(3);
    expect(container.querySelector('.rounded-3xl')).toBeNull();
  });

  it('draws nothing at all when every slot is off', () => {
    // Un esqueleto que no coincide con lo que llega después es peor que un
    // spinner: promete una disposición y entrega otra. Cero es una respuesta.
    const { container } = render(
      <PageSkeleton label="Cargando" header={false} tiles={0} panels={0} />,
    );

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(container.querySelectorAll('.rounded-2xl')).toHaveLength(0);
  });
});
