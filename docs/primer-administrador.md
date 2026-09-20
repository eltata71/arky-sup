# Crear el primer administrador de Arky

> **Para quién es esta guía:** la persona que va a poner Arky en marcha. **No
> hace falta saber programar** ni instalar nada. Todo se hace con clics en el
> panel de Supabase.
>
> **Cuánto toma:** unos 5 minutos, una sola vez en la vida del sistema.

---

## Por qué hay que hacer esto una vez

En Arky **nadie puede crearse su propia cuenta**. Las cuentas las crea un
administrador desde la pantalla de *Seguridad*. Eso es exactamente lo que se
buscaba, y tiene una consecuencia: **la primera cuenta no puede crearse desde
Arky**, porque todavía no hay ningún administrador que la cree.

Es el problema del primer huevo. Se resuelve creando esa primera cuenta
directamente en Supabase, que es donde Arky guarda todo. A partir de ahí,
**todas las demás cuentas se crean dentro de Arky**, con un formulario normal, y
nunca más vuelves aquí.

---

## Lo que necesitas antes de empezar

- Acceso al panel de **https://supabase.com/dashboard** con el proyecto de Arky.
- El correo que quieres usar para tu cuenta de Arky.

---

## Paso 1 · Crea la identidad

1. Abre el proyecto en el panel de Supabase.
2. En el menú de la izquierda, **Authentication** → **Users**.
3. Botón **Add user** → **Send invitation** (recomendado) o **Create new user**.
   - Con *Send invitation* recibes un correo con un enlace para poner tu
     contraseña. Es la forma preferida: **nadie, ni siquiera tú, teclea la
     contraseña de otra persona**, y es la misma regla que el producto aplica
     después para todas las altas.
   - Con *Create new user* la escribes tú y marcas *Auto Confirm User*.
4. Copia el **User UID** que aparece en la lista. Es una cadena larga con
   guiones. Lo necesitas en el paso siguiente.

---

## Paso 2 · Dale el rol de superadministrador

Autenticarse no basta: Arky exige además una **cuenta** con un rol, y esa cuenta
es una fila en la base de datos. Sin ella, la aplicación cierra la sesión y
explica que un administrador debe crearla — que es justo lo que estamos
resolviendo.

1. En el menú de la izquierda, **SQL Editor** → **New query**.
2. Pega esto, **sustituyendo el UID** por el que copiaste, y ejecuta:

```sql
insert into api.user_profiles (id, role, status, display_name)
values ('PEGA-AQUI-EL-UID', 'superadmin', 'active', 'Tu Nombre')
on conflict (id) do update
  set role = 'superadmin', status = 'active';
```

3. Debe responder `Success. No rows returned`.

Eso es todo. Esta es la **única** vez que se escribe un rol a mano: a partir de
aquí los cambios de rol pasan por `api.set_user_role`, que comprueba el permiso,
comprueba que la sesión sigue viva, impide que alguien se cambie el rol a sí
mismo, impide que un `admin` conceda privilegios administrativos, y deja la
entrada correspondiente en `private.authorization_audit`.

---

## Paso 3 · Entra en Arky

1. Abre la aplicación.
2. Inicia sesión con ese correo y esa contraseña.
3. Verás **Seguridad** en el menú lateral: es la pantalla desde la que se crean
   las demás cuentas.

Si la aplicación dice *«Tu identidad es válida pero no tiene una cuenta en
Arky»*, el paso 2 no se aplicó al UID correcto. Vuelve al SQL Editor y comprueba:

```sql
select p.id, p.role, p.status, u.email
from api.user_profiles p join auth.users u on u.id = p.id;
```

---

## Paso 4 · Comprueba que las invitaciones llegan

Antes de crear cuentas de verdad, conviene asegurarse de que los enlaces vuelven
al sitio correcto. En **Authentication → URL Configuration**:

- **Site URL**: la dirección de la aplicación en producción.
- **Redirect URLs**: añade también la de las vistas previas si las usas.

Un enlace de invitación con la URL equivocada lleva a la persona a una página
que no existe, y el síntoma —«el enlace no funciona»— no dice dónde mirar.

---

## Paso 5 · (Opcional) Deja entrar con Google

Arky trae el botón **«Continuar con Google»** en la pantalla de entrada. Funciona
en cuanto habilites el proveedor; hasta entonces el botón está, y al pulsarlo
muestra el error que devuelve Supabase.

Sirve igual para una cuenta personal de Google y para una de organización
(Workspace): Arky pide siempre el selector de cuenta, así que quien tenga las dos
elige con cuál entra, y puede cambiar sin cerrar sesión en Google.

Son dos consolas, una vez:

**En Google Cloud** (https://console.cloud.google.com) →
*APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth*,
tipo **Aplicación web**. En *URIs de redireccionamiento autorizados* pega
exactamente:

```
https://<TU-REF>.supabase.co/auth/v1/callback
```

`<TU-REF>` es la referencia del proyecto, la misma que aparece en la URL de tu
panel de Supabase. Copia el **Client ID** y el **Client Secret**.

**En Supabase** → *Authentication → Providers → Google*: actívalo, pega las dos
cosas y guarda. Después, en *Authentication → URL Configuration*, revisa **las
dos** casillas:

- **Redirect URLs** tiene que incluir la dirección de tu despliegue, o el
  retorno de Google cae en el sitio equivocado.
- **Site URL** tiene que ser *esa misma* dirección. Es la que Supabase usa
  cuando un correo no dice a dónde volver, y si apunta a un despliegue anterior
  del producto —uno que todavía esté publicado— el enlace de recuperación
  abrirá sesión en **la aplicación vieja**. No da ningún error: simplemente te
  atiende otra versión, con otras pantallas y otros menús.

> **Entrar con Google no crea una cuenta en Arky.** Quien entre con Google sin
> que tú le hayas dado de alta autentica bien y sale de vuelta, con el mensaje de
> que un administrador tiene que crear su cuenta. La regla del Paso 2 sigue
> siendo la única forma de que alguien exista: esto sólo cambia cómo se llama a
> la puerta, no quién tiene llave.

---

## Lo que **no** hay que hacer nunca

- **No pongas la clave `service_role` en una variable `VITE_*`.** Esas viajan
  dentro del código que se descarga el navegador: sería entregar a cada
  visitante una llave que se salta todas las políticas. La aplicación sólo usa
  la clave *publicable*, que es pública por diseño.
- **No edites `api.user_profiles` a mano** después de este paso. Todo cambio de
  rol posterior debe pasar por la aplicación, que es lo que deja el rastro de
  quién lo hizo.
- **No borres al último superadministrador.** Sin él nadie puede conceder roles
  administrativos, y volverías a este documento.

---

## Variante para quien sí instala cosas

Con la CLI de Supabase y la clave de servicio en el entorno (nunca en el
repositorio):

```bash
supabase link --project-ref <ref>
# 1. la identidad
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"tu@correo.com","password":"...","email_confirm":true}'
# 2. el rol (con el uid devuelto arriba)
psql "$SUPABASE_DB_URL" -c "insert into api.user_profiles (id, role, status) \
  values ('<uid>','superadmin','active') on conflict (id) do update set role='superadmin';"
```

§3.2.1 de `security-hardening.md` documenta el resto de la postura de seguridad.
