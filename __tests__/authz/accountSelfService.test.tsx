/**
 * The other half of "an administrator creates the account".
 *
 * If the owner cannot maintain their own credentials, the rule stops being a
 * division of duties and becomes a support queue. These tests pin the three
 * decisions in that panel that are easy to undo by accident.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountPanel } from '../../components/account/AccountPanel';

const auth = vi.hoisted(() => ({
  profile: { uid: 'u1', email: 'ana@empresa.com', displayName: 'Ana', role: 'architect' } as Record<string, unknown> | null,
  user: { providerData: [{ providerId: 'password' }] } as Record<string, unknown> | null,
  changePassword: vi.fn(),
  updateOwnDisplayName: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => auth,
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.profile = { uid: 'u1', email: 'ana@empresa.com', displayName: 'Ana', role: 'architect' };
  auth.user = { providerData: [{ providerId: 'password' }] };
  auth.changePassword.mockResolvedValue(undefined);
  auth.updateOwnDisplayName.mockResolvedValue(undefined);
});

describe('the role is shown, never offered', () => {
  it('renders the role by its label instead of its identifier', () => {
    render(<AccountPanel />);
    expect(screen.getByText('Arquitecto')).toBeInTheDocument();
    expect(screen.queryByText('architect')).not.toBeInTheDocument();
  });

  it('gives the owner no control that changes their own role', () => {
    const { container } = render(<AccountPanel />);
    // A select or a role input here would be a control the rules refuse, which
    // teaches the user that the screen lies.
    expect(container.querySelector('select')).toBeNull();
    const inputs = Array.from(container.querySelectorAll('input')).map((i) => i.id);
    expect(inputs).not.toContain('cuenta-rol');
  });

  it('says an unreadable role is unreadable rather than inventing one', () => {
    auth.profile = { uid: 'u1', email: 'a@b.com', displayName: 'Ana', role: 'wizard' };
    render(<AccountPanel />);
    expect(screen.getByText('rol desconocido')).toBeInTheDocument();
  });
});

describe('changing the password', () => {
  const fill = (current: string, next: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña nueva'), { target: { value: confirm } });
  };

  it('re-authenticates with the current password', async () => {
    render(<AccountPanel />);
    fill('anterior-123', 'siguiente-456', 'siguiente-456');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    await waitFor(() =>
      expect(auth.changePassword).toHaveBeenCalledWith('anterior-123', 'siguiente-456'),
    );
  });

  it('refuses a mismatched confirmation without calling Firebase', async () => {
    render(<AccountPanel />);
    fill('anterior-123', 'siguiente-456', 'siguiente-457');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/confirmación no coincide/i);
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than the stated minimum', async () => {
    render(<AccountPanel />);
    fill('anterior-123', 'corta', 'corta');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 8 caracteres/i);
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('clears the fields once the change succeeds', async () => {
    render(<AccountPanel />);
    fill('anterior-123', 'siguiente-456', 'siguiente-456');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    await waitFor(() =>
      expect((screen.getByLabelText('Contraseña actual') as HTMLInputElement).value).toBe(''),
    );
  });

  it('surfaces the reason the change failed', async () => {
    auth.changePassword.mockRejectedValue(new Error('La contraseña actual no es correcta.'));
    render(<AccountPanel />);
    fill('equivocada', 'siguiente-456', 'siguiente-456');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña actual no es correcta.');
  });
});

describe('an identity without a password credential', () => {
  it('is told where its password lives instead of shown a form that cannot work', () => {
    auth.user = { providerData: [{ providerId: 'google.com' }] };
    render(<AccountPanel />);

    expect(screen.queryByLabelText('Contraseña actual')).not.toBeInTheDocument();
    expect(screen.getByText(/la gestionas en tu cuenta de Google/i)).toBeInTheDocument();
  });
});

describe('changing the display name', () => {
  it('is disabled until the name actually changes', () => {
    render(<AccountPanel />);
    expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Nombre para mostrar'), { target: { value: 'Ana Torres' } });
    expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeEnabled();
  });

  it('saves only the name', async () => {
    render(<AccountPanel />);
    fireEvent.change(screen.getByLabelText('Nombre para mostrar'), { target: { value: 'Ana Torres' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    await waitFor(() => expect(auth.updateOwnDisplayName).toHaveBeenCalledWith('Ana Torres'));
    // One argument: there is no shape here that could carry a role.
    expect(auth.updateOwnDisplayName.mock.calls[0]).toHaveLength(1);
  });
});
