/**
 * A dónde vuelve una persona después de pasar por un proveedor de identidad.
 *
 * Es una sola línea y tiene su propio fichero porque estaba escrita en unos
 * sitios y olvidada en otros, y el olvido no se ve: el enlace *funciona*, sólo
 * que lleva a otra parte.
 *
 * Lo que costó. `signInWithGoogle` y la Edge Function de invitación sí decían
 * a dónde volver; `sendPasswordReset` no decía nada, así que Supabase construía
 * el enlace del correo con la *Site URL* del proyecto — que apuntaba a un
 * despliegue anterior del producto, todavía vivo y sobre la misma base de
 * datos. Quien pidió recuperar su contraseña desde la aplicación nueva recibió
 * un correo que lo devolvió a la vieja: allí la sesión se abrió, pero esa
 * versión no tenía la pantalla de «nueva contraseña», ni «Seguridad», ni
 * «Cerrar sesión». Es el peor modo de fallo de los enlaces de retorno, porque
 * todo parece funcionar y lo que cambia es *qué aplicación* te atiende.
 *
 * La regla, entonces: **el retorno lo decide el origen desde el que se pidió**,
 * nunca la configuración del proyecto. La Site URL sigue siendo el respaldo
 * para el caso en que no haya origen que leer.
 *
 * Devuelve `undefined` fuera del navegador —una prueba, un render de servidor—
 * en vez de inventar un dominio: pasar `redirectTo: undefined` deja que el SDK
 * use la Site URL, que es exactamente el comportamiento correcto cuando nadie
 * puede decir desde dónde se pidió.
 */
export function authReturnUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const origin = window.location?.origin;
  return typeof origin === 'string' && origin !== '' ? `${origin}/auth` : undefined;
}
