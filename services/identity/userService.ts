/**
 * El perfil de una persona y su rol, contra PostgreSQL.
 *
 * Cada operación es una RPC `security definer` que comprueba el permiso **y la
 * sesión viva** antes de tocar nada, y deja su entrada en
 * `private.authorization_audit`. Eso es lo que distingue este módulo del que
 * sustituye: en Firestore la regla y la auditoría eran dos cosas separadas —la
 * regla en `firestore.rules`, la auditoría en ninguna parte—, y aquí la
 * operación que cambia un rol es la misma que lo registra.
 *
 * Tres reglas viven en SQL y no aquí, y conviene saber dónde mirar cuando una
 * llamada falla con `42501`:
 *
 *   - nadie cambia su propio rol (`assert_role_is_not_self`),
 *   - sólo `superadmin` concede `admin` o `superadmin`,
 *   - una sesión revocada no cambia autorizaciones (`assert_session_active`).
 */
import type { AuthRole } from "../../lib/authz";
import { parseAuthRole } from "../../lib/authz";
import { PersistenceError, createFailureResult, executeRemoteWrite, isWriteConfirmed } from "../persistence";
import { callRpc } from "../adapters";

export interface UserProfile {
    uid: string;
    email: string | null;
    displayName: string | null;
    role: AuthRole;
    /** `disabled` sigue existiendo como fila; el producto simplemente no la deja entrar. */
    status?: 'active' | 'disabled';
}

const asProfile = (row: unknown): UserProfile | null => {
    if (!row || typeof row !== 'object') return null;
    const value = row as Record<string, unknown>;
    const uid = typeof value.uid === 'string' ? value.uid : null;
    const role = parseAuthRole(value.role);
    if (!uid || role === null) return null;
    return {
        uid,
        email: typeof value.email === 'string' ? value.email : null,
        displayName: typeof value.displayName === 'string' && value.displayName.trim() !== ''
            ? value.displayName
            : null,
        role,
        status: value.status === 'disabled' ? 'disabled' : 'active',
    };
};

const confirm = async (operationName: string, userId: string, run: () => Promise<unknown>): Promise<void> => {
    let result;
    try {
        result = await executeRemoteWrite({ operationName, userId }, run);
    } catch (error) {
        result = createFailureResult(operationName, error);
    }
    if (!isWriteConfirmed(result)) throw new PersistenceError(result);
};

class UserService {
    /**
     * El perfil propio.
     *
     * `api.load_own_profile` devuelve `null` cuando no hay perfil o está
     * deshabilitado — falla cerrado, igual que `private.current_role()`. Esa es
     * la señal que `AuthContext` convierte en «tu identidad es válida pero no
     * tiene una cuenta»: autenticar y existir no son lo mismo.
     */
    async getOwnProfile(): Promise<UserProfile | null> {
        return asProfile(await callRpc<unknown>('load_own_profile'));
    }

    async updateUserRole(uid: string, role: UserProfile['role']): Promise<void> {
        await confirm('updateUserRole', uid, () => callRpc('set_user_role', { target: uid, new_role: role }));
    }

    async setUserStatus(uid: string, status: 'active' | 'disabled'): Promise<void> {
        await confirm('setUserStatus', uid, () => callRpc('set_user_status', { target: uid, new_status: status }));
    }

    async deleteUser(uid: string): Promise<void> {
        await confirm('deleteUser', uid, () => callRpc('delete_user_profile', { target: uid }));
    }

    async getAllUsers(): Promise<UserProfile[]> {
        const rows = await callRpc<unknown>('list_user_profiles');
        return (Array.isArray(rows) ? rows : [])
            .map(asProfile)
            .filter((profile): profile is UserProfile => profile !== null);
    }

    /**
     * Crea el perfil de una identidad que la Edge Function acaba de invitar.
     *
     * Se llama **con la sesión del administrador**, a propósito: así el permiso
     * `users:create`, la regla de que sólo un superadmin concede roles
     * privilegiados, y la entrada de auditoría con el actor real quedan todos
     * en la RPC. Si lo escribiera la función con clave de servicio, esas tres
     * reglas habría que duplicarlas allí.
     */
    async provisionProfile(uid: string, role: AuthRole, displayName: string | null): Promise<void> {
        await confirm('provisionUserProfile', uid, () => callRpc('provision_user_profile', {
            target: uid,
            target_role: role,
            target_name: displayName,
        }));
    }

    /**
     * Update the signed-in user's own display name.
     *
     * Deliberadamente más estrecha que `provisionProfile`: escribe un campo, así
     * que no puede convertirse en una forma de editar un rol por un camino
     * compartido. La RPC lo refuerza; que el método no sepa expresar la otra
     * escritura es una comodidad, no el control.
     */
    async updateOwnDisplayName(uid: string, displayName: string): Promise<void> {
        await confirm('updateOwnDisplayName', uid, () => callRpc('update_own_display_name', {
            p_display_name: displayName,
        }));
    }
}

export const userService = new UserService();
