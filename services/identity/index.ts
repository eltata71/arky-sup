/**
 * `services/identity` — quién es el usuario y cómo se le da una cuenta.
 *
 * Los ficheros de este módulo vivían sueltos en la raíz de `services/`, que es
 * donde va lo que no pertenece a ningún sitio. Son un contexto: la sesión
 * (`authService`), el perfil y su rol (`userService`), el alta de cuentas por un
 * administrador (`userProvisioningService`) y el enlace de invitación
 * (`supabasePasswordSetup`). Hablan el mismo lenguaje —`AuthRole`,
 * `UserProfile`, `uid`— y ninguno tiene sentido sin los otros.
 *
 * Este módulo y `services/adapters` son los únicos autorizados a tocar el SDK
 * de Supabase Auth: es el adaptador de la identidad, y la regla de
 * `eslint.config.js` lo nombra por eso. Nada más lo toca — cuatro caminos
 * distintos al SDK es como el Centro de Formación acabó degradando a
 * `localStorage` con un `console.warn` sin decírselo a nadie.
 *
 * El alta de cuentas ya no necesita una segunda app del SDK: crear una
 * identidad es lo único que el navegador no puede hacer, y lo hace la Edge
 * Function `provision-user` con la clave de servicio. El perfil y el rol los
 * sigue escribiendo el navegador con la sesión del administrador, que es donde
 * están las reglas.
 */
export {
  AuthUnavailableError,
  currentAccessToken,
  currentUser,
  currentUserId,
  isAuthAvailable,
  observeAuthState,
  reauthenticateAndUpdatePassword,
  rememberAuthUser,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutCurrentUser,
  toAuthUser,
  type AuthUser,
} from './authService';
export { userService, type UserProfile } from './userService';
export {
  completeSupabasePasswordSetup,
  isSupabasePasswordSetupCallback,
  type SupabasePasswordClient,
} from './supabasePasswordSetup';
export { provisionUser, resendInvitation } from './userProvisioningService';
