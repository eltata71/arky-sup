import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState: { user: unknown; profile: { role: string } | null } = {
  user: { uid: 'u1' },
  profile: { role: 'student' },
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authState,
}));
vi.mock('../../context/CommandPaletteContext', () => ({
  useCommandPalette: () => ({ setOpen: vi.fn() }),
}));

/**
 * El tema tiene una sola fuente —`settings.theme`— así que el raíl lo lee del
 * contexto de la aplicación. Antes lo leía de `localStorage` por su cuenta, que
 * es exactamente la divergencia que dejaba el interruptor sin efecto.
 */
const appState = { settings: { theme: 'light' as 'light' | 'dark' }, updateSettings: vi.fn() };
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => appState,
}));

import { AppRail } from '../../components/AppRail';

const railLabels = (): string[] => Array.from(
  screen
    .getByRole('complementary', { name: 'Navegación principal' })
    .querySelectorAll('button[aria-label]'),
).map((button) => button.getAttribute('aria-label') ?? '');

const renderRail = (role: string) => {
  authState.profile = { role };
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppRail />
    </MemoryRouter>,
  );
};

describe('AppRail', () => {
  it('reads top to bottom in the order the hierarchy is taught', () => {
    renderRail('admin');
    expect(railLabels()).toEqual([
      'Ir al centro de mando',
      'Centro de mando',
      'Iniciativas de Negocio',
      'Proyectos de Arquitectura',
      'Solicitudes de Entregables',
      'Agentes de la Oficina',
      'Centro de Formación',
      'Configuración',
      'Seguridad',
      'Búsqueda global',
      'Cambiar a modo oscuro',
      'Fijar el menú abierto',
    ]);
  });

  it('hides Seguridad from a user who cannot administer it', () => {
    renderRail('student');
    expect(screen.queryByLabelText('Seguridad')).not.toBeInTheDocument();
    // The rest of the rail is unchanged — hiding one slot must not reshuffle it.
    expect(railLabels()).toContain('Configuración');
    expect(railLabels()).toContain('Centro de Formación');
  });

  it('shows the short name on the button and the long one to assistive tech', () => {
    // The rail is where room is scarce, so the visible label is the short
    // register; the accessible name stays the long one, which is what the
    // screen the item opens is actually called.
    renderRail('admin');
    const projects = screen.getByLabelText('Proyectos de Arquitectura');
    expect(projects).toHaveTextContent('Proyectos');
    expect(projects).not.toHaveTextContent('Proyectos de Arquitectura');
  });

  it('groups the app-level utilities at the foot, after every destination', () => {
    // Search, theme, shortcuts and the latch act on the app rather than
    // navigating it, so they sit below the last destination instead of among
    // them.
    const onOpenShortcuts = vi.fn();
    authState.profile = { role: 'admin' };
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRail onOpenShortcuts={onOpenShortcuts} />
      </MemoryRouter>,
    );
    const labels = railLabels();
    expect(labels.slice(-4)).toEqual([
      'Búsqueda global',
      'Cambiar a modo oscuro',
      'Atajos de teclado',
      'Fijar el menú abierto',
    ]);
    fireEvent.click(screen.getByLabelText('Atajos de teclado'));
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
  });

  it('ofrece la guía de uso al pie, y sólo cuando alguien puede abrirla', () => {
    // La ayuda vive en el raíl porque la pregunta que atiende —«¿cómo funciona
    // esto?»— no depende de dónde estés parado, al revés que el asistente de la
    // Oficina, que responde sobre un registro y se abre desde ese registro.
    const onOpenGuide = vi.fn();
    authState.profile = { role: 'student' };
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRail onOpenGuide={onOpenGuide} />
      </MemoryRouter>,
    );
    const guide = screen.getByLabelText('Guía de uso de la plataforma');
    // Con etiqueta visible, como los destinos: es la única forma de que la
    // encuentre quien todavía no sabe qué hace el producto.
    expect(guide).toHaveTextContent('Ayuda');
    expect(guide).toHaveAttribute('aria-haspopup', 'dialog');
    // Va antes de las utilidades, que son lo último del raíl.
    expect(railLabels().slice(-4)).toEqual([
      'Guía de uso de la plataforma',
      'Búsqueda global',
      'Cambiar a modo oscuro',
      'Fijar el menú abierto',
    ]);
    fireEvent.click(guide);
    expect(onOpenGuide).toHaveBeenCalledOnce();
  });

  it('sin quien la abra, el raíl no promete una ayuda que no existe', () => {
    renderRail('student');
    expect(screen.queryByLabelText('Guía de uso de la plataforma')).not.toBeInTheDocument();
  });
});

describe('AppRail · desplegado contextual', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('en reposo enseña el registro corto, y sólo ése', () => {
    renderRail('admin');
    const deliverables = screen.getByLabelText('Solicitudes de Entregables');

    expect(deliverables).toHaveTextContent('Entregables');
    expect(deliverables).not.toHaveTextContent('El trabajo gobernado');
  });

  /** Tabular hasta un destino: la tecla primero, el foco después. */
  const tabTo = (label: string) => {
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.focus(screen.getByLabelText(label));
  };

  it('el foco de teclado lo despliega, no sólo el ratón', () => {
    // La mitad que se suele olvidar: tabular a ciegas por un raíl que sólo se
    // explica al pasar el ratón deja fuera justo a quien no usa ratón.
    renderRail('admin');
    tabTo('Iniciativas de Negocio');

    const deliverables = screen.getByLabelText('Solicitudes de Entregables');
    expect(deliverables).toHaveTextContent('Solicitudes de Entregables');
    expect(deliverables).toHaveTextContent('El trabajo gobernado de la Oficina');
  });

  it('un clic con el ratón no lo deja abierto tapando el contenido', () => {
    // El defecto que esto fija: pulsar cualquier botón del raíl da foco al
    // botón, así que con un `onFocus` a secas cambiar el tema dejaba el raíl
    // desplegado sobre la página hasta que el usuario pinchaba en otro sitio.
    renderRail('admin');
    const theme = screen.getByLabelText('Cambiar a modo oscuro');
    fireEvent.mouseDown(theme);
    fireEvent.focus(theme);

    expect(screen.getByLabelText('Solicitudes de Entregables')).not.toHaveTextContent(
      'El trabajo gobernado de la Oficina',
    );
  });

  it('desplegado separa el trabajo del sistema con su rótulo', () => {
    renderRail('admin');
    tabTo('Centro de mando');

    expect(screen.getByText('El trabajo')).toBeInTheDocument();
    expect(screen.getByText('El sistema')).toBeInTheDocument();
  });

  it('el pestillo se recuerda entre cargas, porque una preferencia que hay que repetir no lo es', () => {
    const first = renderRail('admin');
    fireEvent.click(screen.getByLabelText('Fijar el menú abierto'));
    expect(screen.getByLabelText('Soltar el menú')).toHaveAttribute('aria-pressed', 'true');
    first.unmount();

    renderRail('admin');
    // Sin hover ni foco: el raíl abre fijado y el nombre largo ya está visible.
    expect(screen.getByLabelText('Solicitudes de Entregables')).toHaveTextContent('Solicitudes de Entregables');
    expect(screen.getByLabelText('Soltar el menú')).toBeInTheDocument();
  });

  it('abrir el raíl cambia lo que se ve y nunca lo que se anuncia', () => {
    // El nombre accesible es el largo en los dos estados. Si cambiara al
    // desplegarse, el mismo botón se llamaría de dos formas según dónde esté el
    // ratón, que es exactamente lo que un lector de pantalla no puede seguir.
    renderRail('admin');
    const collapsed = railLabels();
    tabTo('Centro de mando');

    expect(railLabels()).toEqual(collapsed);
  });
});
