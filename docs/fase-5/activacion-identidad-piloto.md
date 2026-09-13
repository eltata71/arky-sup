# Activación de identidad — piloto F5

## Cohorte autorizada

- Una identidad administradora piloto, aprovisionada en Supabase Auth y con un perfil `api.user_profiles` activo de rol `superadmin`.
- El correo de la cohorte se declara explícitamente en `VITE_SUPABASE_PILOT_EMAILS`; quien no esté en esa lista conserva el flujo Firebase.
- No existe registro público: `auth.enable_signup` y `auth.email.enable_signup` están deshabilitados.

## Flujo de primer acceso

1. El administrador invita a la identidad desde Supabase.
2. Supabase redirige a `https://arkypro-1-0.vercel.app` después de validar el enlace.
3. El callback `#access_token=…&type=invite` (o `recovery`) muestra **Define tu contraseña**.
4. La persona establece una contraseña de al menos 12 caracteres; el cliente llama `auth.updateUser` exclusivamente con la sesión efímera del enlace.
5. La aplicación comprueba que la sesión corresponde a la cohorte piloto y lee su perfil asignado; nunca crea un perfil desde el navegador.

## Límites de seguridad

- La clave `service_role` no se usa ni se publica en Vercel. El cliente usa únicamente la clave publicable de Supabase.
- El callback se rechaza si no tiene `access_token`, si su tipo no es `invite`/`recovery`, si expiró o si no pertenece a la cohorte.
- Las URL locales (`localhost` y `127.0.0.1`) siguen permitidas sólo para desarrollo; la URL de sitio productiva ya no apunta a localhost.
- No se debe usar una URL individual de despliegue de Vercel como `site_url`; la URL estable del proyecto es `https://arkypro-1-0.vercel.app`.

## Evidencia de configuración

- `supabase config diff` contra el manifiesto mínimo de Auth no reporta actualizaciones declaradas después de la aplicación.
- La identidad piloto mantiene perfil activo `superadmin` y correo confirmado.
- Antes de enviar otro enlace, el build que contiene este flujo debe estar desplegado en Production; los valores `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_SUPABASE_PILOT_EMAILS` ya están establecidos allí.
