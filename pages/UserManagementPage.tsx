import React, { useState, useEffect } from 'react';
import { provisionUser, resendInvitation, userService, type UserProfile } from '../services/identity';
import { useAuth } from '../context/AuthContext';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  assignableRoles,
  can,
  canAssignRole,
  parseAuthRole,
  type AuthRole,
} from '../lib/authz';
import { Shield, Trash2, Edit2, Check, X, Mail, UserPlus, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TableRowSkeleton } from '../components/SkeletonLoader';

/** Tint per role, so reach reads at a glance rather than by parsing a word. */
const ROLE_TINT: Record<AuthRole, string> = {
  viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  architect: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  reviewer: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  trainer: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  superadmin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
};

interface RoleBadgeProps {
  role: string | null | undefined;
}

/**
 * A stored role rendered for a person.
 *
 * A legacy value (`student`, `teacher`) is migrated on read so the directory
 * shows what the account can actually do, and an unreadable one says so instead
 * of pretending the account has some role — that record needs an administrator's
 * attention, not a plausible-looking label.
 */
const RoleBadge: React.FC<RoleBadgeProps> = ({ role }) => {
  const parsed = parseAuthRole(role);
  if (!parsed) {
    return (
      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
        rol desconocido
      </span>
    );
  }
  return (
    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${ROLE_TINT[parsed]}`}>
      {ROLE_LABELS[parsed]}
    </span>
  );
};

export const UserManagementPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<AuthRole>('viewer');

  /**
   * The roles this administrator may hand out. An `admin` cannot grant `admin`
   * or `superadmin` — widening the circle that administers the product is
   * reserved to a superadmin, because an administrator who can mint
   * administrators can multiply.
   */
  const grantable = assignableRoles(profile);

  // Create User State — no password field on purpose: the account is created
  // with a single-use secret nobody sees and its owner sets their own via the
  // invitation email. An administrator who types a colleague's first password
  // knows a credential that is not theirs.
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<AuthRole>('viewer');
  const [notice, setNotice] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ uid: string; name: string } | null>(null);

  const fetchUsers = async () => {
    try {
      const usersList = await userService.getAllUsers();
      setUsers(usersList);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (can(profile, 'users:read')) {
      fetchUsers();
    }
  }, [profile]);

  const handleUpdateRole = async (uid: string) => {
    // Re-checked here rather than trusted from the dropdown: the options are a
    // convenience, and a convenience is not a control.
    if (!canAssignRole(profile, editRole)) {
      setNotice('No puedes asignar ese rol.');
      return;
    }
    if (uid === profile?.uid) {
      // Nobody edits their own role, administrator included. The rules refuse
      // it too; this only makes the refusal legible.
      setNotice('No puedes cambiar tu propio rol. Pídeselo a otro administrador.');
      return;
    }
    try {
      await userService.updateUserRole(uid, editRole);
      setUsers(users.map(u => u.uid === uid ? { ...u, role: editRole } : u));
      setEditingId(null);
    } catch (error) {
      console.error("Error updating role:", error);
    }
  };

  const handleDeleteUser = (uid: string) => {
    const user = users.find(u => u.uid === uid);
    setDeleteConfirm({ uid, name: user?.displayName || 'este usuario' });
  };

  const confirmDeleteUser = async () => {
    if (!deleteConfirm) return;
    try {
      await userService.deleteUser(deleteConfirm.uid);
      setUsers(users.filter(u => u.uid !== deleteConfirm.uid));
    } catch (error) {
      console.error("Error deleting user:", error);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setIsCreating(true);

    const result = await provisionUser({ email: newEmail, displayName: newName, role: newRole });

    if (!result.ok) {
      setCreateError(result.message ?? 'No se pudo crear la cuenta.');
      setIsCreating(false);
      return;
    }

    await fetchUsers();
    setShowCreateModal(false);
    setNewEmail('');
    setNewName('');
    setNewRole('viewer');
    setNotice(`Cuenta creada. Se envió a ${result.profile?.email} un correo para que fije su contraseña.`);
    setIsCreating(false);
  };

  const handleResendInvitation = async (email: string | null) => {
    if (!email) return;
    const sent = await resendInvitation(email);
    setNotice(sent
      ? `Se reenvió la invitación a ${email}.`
      : 'No se pudo reenviar la invitación. Revisa la consola de observabilidad.');
  };

  if (!can(profile, 'users:read')) {
    return (
      <div className="p-8 text-center text-gray-600 dark:text-gray-400">
        Esta sección es para administrar cuentas. Tu rol no la incluye.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 md:pl-20 max-w-6xl mx-auto">
      <div className="mb-6">
        <button 
          onClick={() => navigate('/')}
          className="flex items-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          Volver al panel
        </button>
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-500" />
          Gestión de usuarios
        </h1>
        {can(profile, 'users:create') && (
          <button
            onClick={() => { setCreateError(''); setShowCreateModal(true); }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Crear cuenta
          </button>
        )}
      </div>

      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
        Las cuentas se crean únicamente desde aquí. Nadie puede darse de alta por su
        cuenta: quien recibe la invitación fija su propia contraseña y luego puede
        cambiarla o recuperarla desde la pantalla de acceso.
      </p>

      {notice && (
        <div
          role="status"
          className="mb-6 flex items-start justify-between gap-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300 rounded-lg p-3 text-sm"
        >
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Descartar aviso" className="shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Correo</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Correo</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {users.map((u) => (
                <tr key={u.uid}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {u.displayName || 'Sin nombre'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {u.email || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {editingId === u.uid ? (
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as AuthRole)}
                        aria-label={`Rol de ${u.displayName || u.email || 'la cuenta'}`}
                        className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                      >
                        {/* Only the roles this administrator may actually grant.
                            A superadmin option an admin cannot use would be a
                            control that lies about what it does. */}
                        {grantable.map((role) => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={u.role} />
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {editingId === u.uid ? (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleUpdateRole(u.uid)} className="text-green-600 hover:text-green-900 dark:hover:text-green-400">
                          <Check className="h-5 w-5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-gray-600 hover:text-gray-900 dark:hover:text-gray-400">
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        {u.email && can(profile, 'users:create') && (
                          <button
                            onClick={() => handleResendInvitation(u.email)}
                            className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 p-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            aria-label={`Reenviar invitación a ${u.displayName || u.email}`}
                          >
                            <Mail className="h-4 w-4" />
                          </button>
                        )}
                        {/* Own row: the role selector is not offered at all.
                            Offering it and then refusing the save teaches the
                            operator that the screen is unreliable. */}
                        {can(profile, 'users:update') && u.uid !== profile?.uid && (
                          <button
                            onClick={() => { setEditingId(u.uid); setEditRole(parseAuthRole(u.role) ?? 'viewer'); }}
                            className="text-indigo-600 hover:text-indigo-900 dark:hover:text-indigo-400 p-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            aria-label={`Editar rol de ${u.displayName || u.email}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {can(profile, 'users:delete') && u.uid !== profile?.uid && (
                          <button
                            onClick={() => handleDeleteUser(u.uid)}
                            className="text-red-600 hover:text-red-900 dark:hover:text-red-400 p-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            aria-label={`Eliminar usuario ${u.displayName || u.email}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl border border-gray-200 dark:border-gray-800">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Crear una cuenta</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateUser} className="space-y-4">
              {createError && (
                <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm">
                  {createError}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre completo</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div>
                <label htmlFor="nuevo-rol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rol</label>
                <select
                  id="nuevo-rol"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as AuthRole)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {grantable.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {ROLE_DESCRIPTIONS[newRole]}
                </p>
              </div>

              {/* Said plainly, because the absent password field is the part an
                  administrator will look for. */}
              <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                No se fija una contraseña aquí. La cuenta se crea con un secreto de un solo
                uso que nadie ve y la persona recibe un correo para elegir la suya.
              </p>
              
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isCreating ? 'Creando…' : 'Crear e invitar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
          isOpen={!!deleteConfirm}
          title="Eliminar Perfil de Usuario"
          message={`¿Estás seguro de que deseas eliminar el perfil de "${deleteConfirm?.name}"? Esto no elimina su cuenta de autenticación.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          variant="danger"
          onConfirm={confirmDeleteUser}
          onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
};
