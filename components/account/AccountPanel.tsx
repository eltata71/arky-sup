/**
 * What a person may do with their own account, and nothing beyond it.
 *
 * The product's rule is that an account is created by an administrator. The
 * mirror of that rule is that its owner must be able to *maintain* it without
 * asking anyone: change their display name, change their password. Without this
 * panel the rule reads as a restriction rather than a division of duties, and
 * every password change becomes a support ticket.
 *
 * The one thing deliberately absent is the role. It is shown, because a person
 * should be able to see what they are, and it is not editable, because a role
 * one can edit is not a role — `firestore.rules` refuses the write regardless,
 * and offering a control the server rejects only teaches distrust of the UI.
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, parseAuthRole } from '../../lib/authz';
import { Button, Card, Input } from '../ui';

/** A minimum that matches Firebase's own; stated rather than discovered on submit. */
const MIN_PASSWORD_LENGTH = 8;

export const AccountPanel: React.FC = () => {
  const { profile, user, changePassword, updateOwnDisplayName } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [nameNotice, setNameNotice] = useState('');
  const [nameError, setNameError] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  const role = parseAuthRole(profile?.role);

  /**
   * Con Supabase Auth como proveedor único (ADR-004) toda cuenta entra con
   * correo y contraseña, así que el formulario aplica siempre que haya sesión.
   * Antes esto miraba `providerData` para esconder el formulario a una
   * identidad de Google, que no tenía contraseña que cambiar en Arky; ese caso
   * desapareció con Firebase.
   */
  const hasPasswordCredential = Boolean(user?.email);

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError('');
    setNameNotice('');
    setIsSavingName(true);
    try {
      await updateOwnDisplayName(displayName);
      setNameNotice('Tu nombre quedó actualizado.');
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'No se pudo actualizar el nombre.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordNotice('');

    // Checked here so the person learns both problems before a round trip, not
    // one at a time from the server.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('La confirmación no coincide con la contraseña nueva.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('La contraseña nueva tiene que ser distinta de la actual.');
      return;
    }

    setIsChanging(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordNotice('Tu contraseña quedó cambiada.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setIsChanging(false);
    }
  };

  if (!profile) {
    return (
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No hay una cuenta cargada en esta sesión.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-xl font-semibold mb-1">Tu cuenta</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Estos datos son tuyos y solo tú los cambias.
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Correo</dt>
            <dd className="mt-1 text-sm text-gray-900 dark:text-white">{profile.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Rol</dt>
            <dd className="mt-1 text-sm text-gray-900 dark:text-white">
              {role ? ROLE_LABELS[role] : 'rol desconocido'}
            </dd>
            <dd className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {role
                ? ROLE_DESCRIPTIONS[role]
                : 'Pide a un administrador que revise tu cuenta.'}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
          El rol lo asigna un administrador desde la gestión de usuarios. Si necesitas
          otro alcance, pídeselo a quien administra la herramienta.
        </p>

        <form onSubmit={handleNameSubmit} className="space-y-3">
          <label htmlFor="cuenta-nombre" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Nombre para mostrar
          </label>
          <Input
            id="cuenta-nombre"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Tu nombre"
          />
          {nameError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{nameError}</p>}
          {nameNotice && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{nameNotice}</p>}
          <Button type="submit" loading={isSavingName} disabled={displayName.trim() === (profile.displayName ?? '').trim()}>
            Guardar nombre
          </Button>
        </form>
      </Card>

      {hasPasswordCredential ? (
        <Card>
          <h2 className="text-xl font-semibold mb-1">Cambiar contraseña</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Te pedimos la contraseña actual antes de cambiarla: sin ese paso, una sesión
            abierta y olvidada bastaría para quedarse con la cuenta.
          </p>

          <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-sm">
            <div>
              <label htmlFor="cuenta-actual" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Contraseña actual
              </label>
              <Input
                id="cuenta-actual"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="cuenta-nueva" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Contraseña nueva
              </label>
              <Input
                id="cuenta-nueva"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Al menos {MIN_PASSWORD_LENGTH} caracteres.
              </p>
            </div>
            <div>
              <label htmlFor="cuenta-confirmar" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Repite la contraseña nueva
              </label>
              <Input
                id="cuenta-confirmar"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {passwordError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
            {passwordNotice && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{passwordNotice}</p>}

            <Button type="submit" loading={isChanging}>Cambiar contraseña</Button>
          </form>
        </Card>
      ) : (
        <Card>
          <h2 className="text-xl font-semibold mb-1">Contraseña</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Entras con Google, así que tu contraseña la gestionas en tu cuenta de Google.
            Arky no guarda ninguna.
          </p>
        </Card>
      )}
    </div>
  );
};

export default AccountPanel;
