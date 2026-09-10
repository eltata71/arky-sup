/**
 * Provisioning an account — the operation the product did not have.
 *
 * Until now the only way an account came into existence was for the person to
 * register themselves. Administration could change a role and delete a user,
 * but not create one, which is why self-registration had to stay.
 *
 * ## Why a second Firebase app
 *
 * `createUserWithEmailAndPassword` signs the *new* user in on the auth instance
 * it is given. Called on the main instance it would silently replace the
 * administrator's session with the account they just created — which is exactly
 * why this feature is usually skipped in frontend-first apps and pushed to a
 * server.
 *
 * A second, named Firebase app has its own auth instance and its own session.
 * The new account is created there, that instance is signed out immediately,
 * and the administrator's session on the primary instance is never touched.
 * This is Firebase's documented pattern for the case.
 *
 * ## Why the administrator never chooses the password
 *
 * The account is created with a single-use random secret that is discarded
 * without ever being displayed, and the person receives a reset email to set
 * their own. An administrator who types a colleague's first password knows a
 * credential that is not theirs, and "temporary" passwords are famously
 * permanent. The random value exists only because the API requires one.
 */

import { deleteApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { firebaseConfig, isFirebaseAvailable } from '../../firebase';
import { DEFAULT_PROVISIONED_ROLE, type AuthRole } from '../../lib/authz';
import { observabilityService } from '../observability';
import { userService, type UserProfile } from './userService';

/** Name of the isolated app used only for provisioning. */
const PROVISIONING_APP = 'arky-user-provisioning';

export interface ProvisionUserInput {
  email: string;
  displayName: string;
  role?: AuthRole;
}

export interface ProvisionUserResult {
  ok: boolean;
  profile?: UserProfile;
  /** Stable reason code when provisioning failed. */
  reason?: string;
  /** Message written for the administrator reading the screen. */
  message?: string;
}

/**
 * A password nobody will ever use, and nobody sees.
 *
 * `createUserWithEmailAndPassword` demands one; the person sets their own via
 * the reset email. Generated from the platform CSPRNG so it is not guessable in
 * the window before that email is opened.
 */
function singleUseSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  // Mixed case, digit and symbol so it satisfies any password policy the
  // project has configured, whatever it happens to be.
  return `Aq1!${body}`;
}

/** Translate a Firebase auth error code into something an operator can act on. */
function explain(code: string): { reason: string; message: string } {
  if (code.includes('email-already-in-use')) {
    return {
      reason: 'email_already_in_use',
      message: 'Ya existe una cuenta con ese correo. Búscala en el directorio en lugar de crearla otra vez.',
    };
  }
  if (code.includes('invalid-email')) {
    return { reason: 'invalid_email', message: 'El correo no tiene un formato válido.' };
  }
  if (code.includes('operation-not-allowed')) {
    return {
      reason: 'password_provider_disabled',
      message: 'Habilita el proveedor Correo/Contraseña en Firebase Console para poder crear cuentas.',
    };
  }
  return { reason: 'provisioning_failed', message: 'No se pudo crear la cuenta. Revisa la consola de observabilidad.' };
}

/**
 * Create an account and hand it to its owner.
 *
 * The caller is responsible for checking `users:create` before calling — this
 * module does not know who is asking. The real enforcement is in
 * `firestore.rules`, which refuses the profile write from a non-administrator
 * regardless of what the UI allowed.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const role = input.role ?? DEFAULT_PROVISIONED_ROLE;

  if (!isFirebaseAvailable) {
    return {
      ok: false,
      reason: 'firebase_unavailable',
      message: 'Sin conexión con Firebase no se pueden crear cuentas. Las altas nunca se guardan solo en este navegador.',
    };
  }
  if (!email.includes('@')) {
    return { ok: false, reason: 'invalid_email', message: 'El correo no tiene un formato válido.' };
  }
  if (displayName.length < 2) {
    return { ok: false, reason: 'invalid_name', message: 'El nombre debe tener al menos 2 caracteres.' };
  }

  // A named secondary app keeps the new sign-in off the administrator's session.
  const existing = getApps().find((app) => app.name === PROVISIONING_APP);
  const app = existing ?? initializeApp(firebaseConfig, PROVISIONING_APP);
  const secondaryAuth = getAuth(app);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, singleUseSecret());
    await updateProfile(credential.user, { displayName });

    const profile: UserProfile = {
      uid: credential.user.uid,
      email,
      displayName,
      role,
    };

    // The profile is written from the *administrator's* session, which is the
    // one the rules will check for `users:create`. Writing it from the
    // secondary session would let the brand-new account author its own role.
    await userService.createUserProfile(profile);

    // Hand the account to its owner. Sent from the secondary instance so the
    // administrator's session is untouched even by this last step.
    await sendPasswordResetEmail(secondaryAuth, email);

    observabilityService.recordWarning({
      source: 'user-action',
      title: 'Cuenta creada por un administrador',
      message: `Se creó la cuenta ${email} con rol ${role} y se envió la invitación para fijar contraseña.`,
      metadata: { uid: profile.uid, email, role },
      recoverable: true,
      userVisible: false,
    });

    return { ok: true, profile };
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    const explained = explain(code);
    observabilityService.reportError(error, {
      source: 'user-action',
      title: 'No se pudo crear la cuenta',
      message: explained.message,
      metadata: { email, role, reason: explained.reason },
      recoverable: true,
      userVisible: false,
    });
    return { ok: false, ...explained };
  } finally {
    // Always leave the secondary instance signed out, even on failure: a
    // lingering session there is a second identity nobody is watching.
    try {
      await signOut(secondaryAuth);
    } catch {
      /* nothing useful to do; the app is torn down next */
    }
    try {
      await deleteApp(getApp(PROVISIONING_APP));
    } catch {
      /* already gone */
    }
  }
}

/** Re-send the "set your password" invitation for an existing account. */
export async function resendInvitation(email: string): Promise<boolean> {
  if (!isFirebaseAvailable) return false;
  const existing = getApps().find((app) => app.name === PROVISIONING_APP);
  const app = existing ?? initializeApp(firebaseConfig, PROVISIONING_APP);
  try {
    await sendPasswordResetEmail(getAuth(app), email.trim().toLowerCase());
    return true;
  } catch {
    return false;
  } finally {
    try {
      await deleteApp(getApp(PROVISIONING_APP));
    } catch {
      /* already gone */
    }
  }
}
