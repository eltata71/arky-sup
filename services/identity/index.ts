/**
 * `services/identity` — quién es el usuario y cómo se le da una cuenta.
 *
 * Los tres ficheros que forman este módulo vivían sueltos en la raíz de
 * `services/`, que es donde va lo que no pertenece a ningún sitio. Son un
 * contexto: la sesión (`authService`), el perfil y su rol (`userService`) y el
 * alta de cuentas por un administrador (`userProvisioningService`). Hablan el
 * mismo lenguaje —`AuthRole`, `UserProfile`, `uid`— y ninguno tiene sentido
 * sin los otros dos.
 *
 * Este módulo es uno de los pocos autorizados a tocar los SDK de Firebase Auth
 * y Firestore directamente: es el adaptador de la identidad, y la regla de
 * `eslint.config.js` lo nombra por eso. Nada más los toca — cuatro caminos
 * distintos al SDK es como el Centro de Formación acabó degradando a
 * `localStorage` con un `console.warn` sin decírselo a nadie.
 *
 * `userProvisioningService` merece una nota: usa una app Firebase secundaria
 * con nombre propio para que `createUserWithEmailAndPassword` no reemplace la
 * sesión del administrador que está creando la cuenta.
 *
 * `createUserWithEmailAndPassword` no se reexporta aquí: es el SDK crudo, que
 * `authService` deja disponible para su vecino de módulo y para nadie más.
 */
export {
  AuthUnavailableError,
  currentUser,
  isAuthAvailable,
  observeAuthState,
  readRoleClaim,
  reauthenticateAndUpdatePassword,
  sendPasswordReset,
  signInAnonymouslyForDevBypass,
  signInWithEmail,
  signInWithGooglePopup,
  signOutCurrentUser,
  updateDisplayName,
  type AuthUser,
} from './authService';
export { userService, type UserProfile } from './userService';
export { provisionUser, resendInvitation } from './userProvisioningService';
