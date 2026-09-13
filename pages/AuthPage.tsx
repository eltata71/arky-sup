/**
 * The door, and only the door.
 *
 * This screen used to carry a registration form: anyone who reached the URL
 * could mint an account and pick its role from a dropdown. That is the defect
 * the whole access-control work exists to close — an account is now created by
 * an administrator in `UserManagementPage` and handed to its owner by email.
 *
 * What a person legitimately does alone is recover access, so the recovery flow
 * lives here beside sign-in. It is deliberately not an existence oracle: the
 * confirmation reads the same whether or not the address has an account, so the
 * form cannot be used to enumerate who works here.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabasePasswordSetupCallback } from '../services/identity';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, Shield, Sparkles, CheckCircle2, Network, ArrowLeft } from 'lucide-react';

interface AuthError {
  code?: string;
  message?: string;
}

/** Sign in, recover access, or establish a password from a one-time Supabase callback. */
type AuthMode = 'login' | 'recover' | 'setup-password';

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>(() => (
    isSupabasePasswordSetupCallback(window.location.hash) ? 'setup-password' : 'login'
  ));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    login,
    sendPasswordReset,
    completeSupabasePasswordSetup,
    signInAsDeveloper,
    signInWithGoogle,
    user,
    isLoading,
    error: contextError,
    isDeveloperBypassAvailable,
  } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && mode !== 'setup-password') {
      navigate('/');
    }
  }, [user, mode, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const handleDeveloperSignIn = async () => {
    try {
      setError('');
      await signInAsDeveloper();
      navigate('/');
    } catch (err: unknown) {
      const authError = err as AuthError;
      setError(authError.message || 'No se pudo iniciar en modo desarrollo');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setError('');
      await signInWithGoogle();
      navigate('/');
    } catch (err: unknown) {
      const authError = err as AuthError;
      if (authError.code === 'auth/unauthorized-domain') {
        setError(`Dominio no autorizado: agrega "${window.location.hostname}" en Firebase Console > Authentication > Settings > Authorized Domains.`);
      } else {
        setError(authError.message || 'Falló la autenticación con Google');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      if (mode === 'recover') {
        await sendPasswordReset(email);
        // The same sentence whether or not that address exists. A recovery form
        // that says "no encontramos esa cuenta" tells a stranger who works here.
        setNotice('Si esa dirección tiene una cuenta en Arky, le enviamos un enlace para restablecer la contraseña. Revisa también la carpeta de correo no deseado.');
        setIsSubmitting(false);
        return;
      }

      if (mode === 'setup-password') {
        if (password !== passwordConfirmation) {
          throw new Error('La confirmación de la contraseña no coincide.');
        }
        await completeSupabasePasswordSetup(password);
        window.history.replaceState({}, document.title, window.location.pathname);
        navigate('/');
        return;
      }

      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      const authError = err as AuthError;
      if (authError.code === 'auth/operation-not-allowed') {
        setError("Configuración pendiente: habilita 'Email/Password' en Firebase Console > Authentication > Sign-in method.");
      } else {
        setError(authError.message || 'No fue posible autenticar la cuenta');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl shadow-gray-300/20 dark:shadow-black/30 bg-white dark:bg-gray-900">
        <section className="relative hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-950 text-white">
          <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-indigo-400/20 blur-3xl" />

          <div className="relative z-10 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 border border-white/20 text-xs font-semibold tracking-wide uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              Arquitectura con IA
            </div>
            <h1 className="text-4xl font-bold leading-tight">
              Diseña soluciones que cuentan una historia técnica clara.
            </h1>
            <p className="text-primary-100 leading-relaxed">
              Arky transforma ideas de arquitectura en decisiones trazables, artefactos accionables y colaboración de alto impacto.
            </p>
          </div>

          <div className="relative z-10 space-y-4 text-sm">
            {[
              'Visión ejecutiva y técnica en un mismo flujo.',
              'Artefactos de arquitectura asistidos por IA con contexto real.',
              'Trazabilidad desde el problema hasta la decisión de diseño.'
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4.5 w-4.5 mt-0.5 text-primary-200" />
                <span className="text-primary-100">{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 sm:p-10">
          <div className="max-w-md mx-auto">
            <div className="space-y-3 text-center">
              <div className="mx-auto h-12 w-12 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
                <Network className="h-6 w-6" />
              </div>
              <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">
                {mode === 'login'
                  ? 'Bienvenido de nuevo'
                  : mode === 'recover' ? 'Recupera tu acceso' : 'Define tu contraseña'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {mode === 'login'
                  ? 'Accede y continúa construyendo arquitectura de clase mundial.'
                  : mode === 'recover'
                    ? 'Te enviamos un enlace al correo con el que fue creada tu cuenta.'
                    : 'Elige una contraseña personal para terminar de activar tu acceso al piloto.'}
              </p>
            </div>

            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-lg text-sm text-center border border-red-200 dark:border-red-800">
                  <p className="font-semibold">{error}</p>
                </div>
              )}
              {contextError && !error && (
                <div className="bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 p-4 rounded-lg text-sm text-center border border-amber-200 dark:border-amber-800">
                  <p className="font-semibold mb-1">Aviso</p>
                  <p>{contextError}</p>
                </div>
              )}
              {notice && (
                <div role="status" className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 p-4 rounded-lg text-sm text-center border border-emerald-200 dark:border-emerald-800">
                  {notice}
                </div>
              )}

              <div className="rounded-md shadow-sm space-y-4">
                {mode !== 'setup-password' && (
                <div>
                  <label htmlFor="auth-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo electrónico</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      id="auth-email"
                      type="email"
                      required
                      className="appearance-none rounded-lg relative block w-full px-3 py-2.5 pl-10 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="tu@empresa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                )}

                {mode !== 'recover' && (
                <div>
                  <label htmlFor="auth-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {mode === 'setup-password' ? 'Nueva contraseña' : 'Contraseña'}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      id="auth-password"
                      type="password"
                      required
                      minLength={mode === 'setup-password' ? 12 : undefined}
                      className="appearance-none rounded-lg relative block w-full px-3 py-2.5 pl-10 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setMode('recover'); setError(''); setNotice(''); }}
                    className="mt-2 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                  )}
                </div>
                )}

                {mode === 'setup-password' && (
                <div>
                  <label htmlFor="auth-password-confirmation" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirma la contraseña</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      id="auth-password-confirmation"
                      type="password"
                      required
                      minLength={12}
                      className="appearance-none rounded-lg relative block w-full px-3 py-2.5 pl-10 border border-gray-300 dark:border-gray-700 placeholder-gray-500 text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="••••••••••••"
                      value={passwordConfirmation}
                      onChange={(e) => setPasswordConfirmation(e.target.value)}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Usa al menos 12 caracteres.</p>
                </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 transition-all active:scale-[0.98] shadow-sm hover:shadow-md"
              >
                {isSubmitting
                  ? 'Enviando…'
                  : mode === 'login' ? 'Iniciar sesión' : mode === 'recover' ? 'Enviarme el enlace' : 'Guardar contraseña y activar acceso'}
              </button>
            </form>

            {mode !== 'setup-password' && (
            <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-900 text-gray-500">o continúa con</span>
              </div>
            </div>

            <div className="space-y-3">
              {isDeveloperBypassAvailable && (
                <button
                  onClick={handleDeveloperSignIn}
                  className="w-full flex items-center justify-center px-4 py-2.5 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  <Shield className="h-5 w-5 mr-2" />
                  Entrar como Administrador (Modo Desarrollo)
                </button>
              )}

              <button
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="h-5 w-5 mr-2" referrerPolicy="no-referrer" />
                Continuar con Google
              </button>
            </div>

            <div className="text-center mt-6 space-y-3">
              {mode === 'recover' && (
                <button
                  onClick={() => { setMode('login'); setError(''); setNotice(''); }}
                  className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver a iniciar sesión
                </button>
              )}
              {/* No hay registro público, y se dice en lugar de dejar al visitante
                  buscando el enlace que ya no existe. */}
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Las cuentas de Arky las crea un administrador. Si aún no tienes acceso,
                solicítalo a quien administra la herramienta en tu organización.
              </p>
            </div>
            </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
