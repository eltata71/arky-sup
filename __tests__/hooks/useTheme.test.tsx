/**
 * El tema tiene un solo dueño, y esta prueba es lo que lo mantiene así.
 *
 * El defecto que fija: `useSettingsState` escribía la clase `dark` a partir de
 * `settings.theme` y `useTheme` la escribía a partir de `localStorage`, cada uno
 * con su propia idea de cuál era el tema. Con una cuenta recién creada —ajustes
 * en `dark`, `localStorage` vacío— la aplicación se pintaba oscura, el botón del
 * raíl ofrecía «Modo oscuro», y pulsarlo guardaba lo que ya estaba en pantalla:
 * un interruptor de tema que no cambiaba el tema.
 *
 * @vitest-environment jsdom
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const appState = {
  settings: { theme: 'dark' as 'light' | 'dark' },
  updateSettings: vi.fn(),
};

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => appState,
}));

import { THEME_STORAGE_KEY, mirrorThemeForBoot, useTheme } from '../../hooks/useTheme';

const Harness: React.FC = () => {
  const { resolved, toggle } = useTheme();
  return (
    <div>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={toggle}>alternar</button>
    </div>
  );
};

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    appState.settings.theme = 'dark';
    appState.updateSettings.mockClear();
  });

  it('reads the theme from settings, not from its own storage key', () => {
    // Ésta es la afirmación central: con `localStorage` vacío y los ajustes en
    // oscuro, el hook dice «oscuro». Antes decía «claro» y el botón mentía.
    render(<Harness />);

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('writes the change to settings, so it follows the user between devices', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'alternar' }));

    expect(appState.updateSettings).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('keeps the boot mirror in step, so the next load does not flash', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'alternar' }));

    // El espejo se escribe aunque la escritura remota falle: verse bien y no
    // haber sincronizado es mejor degradación que un destello blanco.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('toggles from light back to dark', () => {
    appState.settings.theme = 'light';
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'alternar' }));

    expect(appState.updateSettings).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('survives a storage that throws, which is what a private window does', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => mirrorThemeForBoot('dark')).not.toThrow();
    setItem.mockRestore();
  });
});
