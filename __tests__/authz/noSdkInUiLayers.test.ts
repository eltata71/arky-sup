/**
 * The presentation layers do not import an SDK.
 *
 * Persistence has been behind a repository for a long time and the model
 * providers behind `services/ai`. Auth was the exception: `AuthContext`
 * imported fifteen symbols from the auth SDK and made the calls itself.
 *
 * It broke no lint rule — `no-restricted-imports` covered `@google/genai` and
 * the legacy engine and never mentioned the backend SDK — so it was a
 * convention violation, which is the kind that survives review indefinitely.
 * ESLint now covers it; this asserts the same thing from the source tree, so
 * the boundary holds even if someone relaxes a rule or adds a directory the
 * config misses.
 *
 * **El proveedor cambió en F9 y la frontera no.** Lo que se prohíbe aquí es
 * `@supabase/supabase-js`, y Firebase se mantiene en la lista como sonda de
 * regresión: una prueba que sólo busca el SDK actual no impide que vuelva el
 * anterior.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const UI_LAYERS = ['components', 'pages', 'context', 'hooks'];

const sourceFiles = ({ roots = UI_LAYERS }: { roots?: readonly string[] } = {}): string[] =>
  execSync(`git ls-files --cached --others --exclude-standard ${roots.join(' ')}`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));

/** Comments stripped: a note explaining the rule is not a violation of it. */
const readCode = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const importsFrom = (code: string, module: string): boolean =>
  new RegExp(`from\\s+['"]${module}['"]`).test(code);

describe('no backend SDK in the UI layers', () => {
  it.each([
    '@supabase/supabase-js',
    'firebase/auth',
    'firebase/firestore',
    'firebase/app',
  ])('nothing imports %s', (module) => {
    const offenders = sourceFiles().filter((file) => importsFrom(readCode(file), module));
    expect(offenders, 'Use services/identity for the session and your context repository for data').toEqual([]);
  });
});

describe('no model SDK in the UI layers', () => {
  it('nothing imports @google/genai', () => {
    const offenders = sourceFiles().filter((file) => importsFrom(readCode(file), '@google/genai'));
    expect(offenders).toEqual([]);
  });

  it('nothing imports the legacy engine', () => {
    const offenders = sourceFiles()
      .filter((file) => /from\s+['"][^'"]*geminiService['"]/.test(readCode(file)));
    expect(offenders, 'Use a domain façade from services/ai, or aiGateway').toEqual([]);
  });
});

describe('the adapters exist and are where the boundary points', () => {
  it('the SDK is imported in exactly one file under services/adapters', () => {
    // Antes esta lista tenía un fichero por contexto, porque cada repositorio
    // hablaba con Firestore. Con todo el acceso por RPC, el SDK sólo hace falta
    // para *crear el cliente*, y ése tiene que ser uno: cualquier otro fichero
    // que lo importe está rehaciendo la puerta que ya existe.
    const allowed = ['services/adapters/supabaseClient.ts'];
    const offenders = sourceFiles({ roots: ['services', 'lib', 'api'] })
      .filter((file) => /['"]@supabase\/supabase-js['"]/.test(readCode(file)))
      .filter((file) => !allowed.includes(file));
    expect(offenders).toEqual([]);
  });

  it('constructs exactly one Supabase client in the whole application', () => {
    /**
     * La regresión que esta prueba nombra ocurrió de verdad y no dejó ningún
     * error a la vista.
     *
     * Identidad y datos construían cada uno su `createClient` con
     * `persistSession: true` y, al no declarar `storageKey`, sobre **la misma
     * clave de almacenamiento**. Los dos traen `autoRefreshToken`, así que los
     * dos renovaban el mismo refresh token; el segundo recibía
     * `refresh_token_already_used`, el SDK borraba la sesión guardada y emitía
     * `SIGNED_OUT`, y el resultado visible era iniciar sesión correctamente y
     * aparecer de vuelta en `/auth`. Tumbó los tres recorridos autenticados de
     * la suite E2E y habría tumbado a cualquier persona usando el producto.
     *
     * Se cuenta la construcción, no el import: reexportar el SDK y llamar a
     * `createClient` desde otro sitio dejaría el import donde está y traería el
     * defecto de vuelta entero.
     */
    const constructors = sourceFiles({ roots: ['services', 'lib', 'context', 'hooks', 'components', 'pages'] })
      .filter((file) => /\bcreateClient\s*\(/.test(readCode(file)));
    expect(constructors).toEqual(['services/adapters/supabaseClient.ts']);
  });

  it('authService talks to the adapter so the context does not have to', () => {
    const source = readFileSync('services/identity/authService.ts', 'utf8');
    expect(source).toContain("from '../adapters'");
  });

  it('AuthContext holds no SDK call of its own', () => {
    const code = readCode('context/AuthContext.tsx');
    expect(code).not.toContain('@supabase/supabase-js');
    expect(code).not.toContain('firebase/auth');
    // The SDK verbs, not just the import: a re-export elsewhere would let them
    // back in without the import line reappearing.
    for (const verb of ['signInWithPassword(', 'onAuthStateChange(', 'updateUser(', 'signInAnonymously(']) {
      expect(code, `${verb} belongs in services/identity/authService`).not.toContain(verb);
    }
  });
});
