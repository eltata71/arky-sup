import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Dos campos que se llaman casi igual y hacen cosas opuestas.
 *
 * `supabase/config.toml` tiene `enable_signup` en dos sitios:
 *
 *   - `[auth] enable_signup` → `GOTRUE_DISABLE_SIGNUP`. Éste **sí** gobierna el
 *     alta, y es el que hace cumplir la regla del producto: nadie crea su
 *     propia cuenta, las crea un administrador.
 *   - `[auth.email] enable_signup` → `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Éste **no
 *     tiene nada que ver con el alta**: dice si el proveedor de correo existe.
 *     En `false`, `grant_type=password` responde 422 `email_provider_disabled`
 *     y no entra nadie, ni siquiera una cuenta ya provisionada.
 *
 * Estuvieron los dos en `false`, que es la lectura natural del nombre y la
 * combinación que deja el producto sin puerta. Costó cinco vueltas de CI
 * encontrarlo, porque el síntoma —iniciar sesión y seguir en `/auth`— se parece
 * a un fallo de credenciales, de perfil provisionado o de configuración del
 * cliente, y no era ninguno.
 *
 * Esta prueba no comprueba estilo: afirma la única combinación que sirve, que
 * es proveedor encendido y registro cerrado.
 */

const config = readFileSync('supabase/config.toml', 'utf8');

/** Lee `clave = valor` dentro de una sección concreta, sin parser de TOML. */
const valueInSection = (section: string, key: string): string | null => {
  const start = config.indexOf(`[${section}]`);
  if (start === -1) return null;
  const rest = config.slice(start + section.length + 2);
  const end = rest.search(/^\[/m);
  const body = end === -1 ? rest : rest.slice(0, end);
  const match = new RegExp(`^${key}\\s*=\\s*(\\S+)`, 'm').exec(body);
  return match ? match[1] : null;
};

describe('Supabase local auth configuration', () => {
  it('keeps the email provider enabled, or nobody can sign in at all', () => {
    expect(
      valueInSection('auth.email', 'enable_signup'),
      'A pesar del nombre, esto es GOTRUE_EXTERNAL_EMAIL_ENABLED: en false, ' +
        'ninguna cuenta puede iniciar sesión con correo y contraseña.',
    ).toBe('true');
  });

  it('keeps self-service signup closed, which is the rule the product is built on', () => {
    expect(
      valueInSection('auth', 'enable_signup'),
      'Éste es el campo que gobierna el alta. Nadie crea su propia cuenta.',
    ).toBe('false');
  });

  it('never allows anonymous sign-ins', () => {
    // Autenticar no es tener cuenta, y una sesión anónima no tiene ninguna.
    expect(valueInSection('auth', 'enable_anonymous_sign_ins')).toBe('false');
  });

  it('demands a password long enough for the one the E2E account uses', () => {
    // Si el mínimo subiera por encima de la contraseña sembrada, el alta de la
    // cuenta de pruebas fallaría con un error de política que tampoco se parece
    // a su causa.
    const minimum = Number(valueInSection('auth', 'minimum_password_length'));
    expect(Number.isFinite(minimum)).toBe(true);
    expect('Arky-E2E-Only-2026!'.length).toBeGreaterThanOrEqual(minimum);
  });
});
