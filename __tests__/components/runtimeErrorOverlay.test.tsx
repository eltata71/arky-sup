/**
 * Qué merece tapar la aplicación entera.
 *
 * El overlay existe para la vista que no puede continuar: un render que lanzó,
 * un chunk que no llegó. Su oferta —«Recargar aplicación»— es el remedio real
 * de ese fallo y de ninguno más.
 *
 * Lo que se fija aquí es el caso que lo hizo aparecer donde no tocaba: un
 * despliegue sin proxy de IA hacía que preguntar en la ayuda tapara el producto
 * con un diálogo modal, encima de un panel que ya había degradado al catálogo y
 * estaba enseñando la respuesta. Recargar no arregla una variable de entorno.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RuntimeErrorOverlay } from '../../components/RuntimeErrorOverlay';
import { observabilityService } from '../../services/observability';

const report = (input: Parameters<typeof observabilityService.reportError>[1]) => {
  act(() => {
    observabilityService.reportError(new Error('fallo'), input);
  });
};

beforeEach(() => observabilityService.clear());
afterEach(() => observabilityService.clear());

describe('RuntimeErrorOverlay', () => {
  it('no tapa la aplicación por un fallo de red que quien llamó ya gestionó', () => {
    render(<RuntimeErrorOverlay />);
    report({
      source: 'network',
      title: 'Llamada directa al proveedor de IA bloqueada',
      severity: 'error',
      recoverable: false,
      userVisible: true,
    });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('sigue tapando cuando la vista sí puede quedarse en blanco', () => {
    render(<RuntimeErrorOverlay />);
    report({
      source: 'react-boundary',
      title: 'La vista falló al renderizar',
      severity: 'error',
      recoverable: true,
      userVisible: true,
    });

    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('y ante un fallo crítico, venga de donde venga', () => {
    render(<RuntimeErrorOverlay />);
    report({
      source: 'app',
      title: 'El arranque no pudo completarse',
      severity: 'critical',
      recoverable: false,
      userVisible: true,
    });

    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
