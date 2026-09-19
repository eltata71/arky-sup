# Runbook de operación — Arky sobre Supabase

**Estado:** vigente desde F9 (2026-09-19). Sustituye a todo procedimiento que
mencione Firebase, Firestore o su emulador.

Este documento responde a las preguntas que se hacen **cuando algo va mal o hay
que cambiar algo**, en el orden en que se hacen. Lo que explica *por qué* la
arquitectura es así vive en `CLAUDE.md` y en `docs/fase-1/adrs.md`; aquí sólo
está qué hacer.

---

## 0. El mapa, en un párrafo

Vercel sirve la SPA y dos funciones apátridas (`api/ai`, `api/gemini`) cuyo único
trabajo es que la clave del proveedor de IA no llegue al navegador. Todo lo
demás es Supabase: **Auth** para la identidad, **PostgreSQL** para los datos y
los permisos, **Storage** para los archivos, y una **Edge Function**
(`provision-user`) para lo único que necesita clave de servicio. El navegador no
escribe ninguna tabla: los privilegios están revocados y lo único que puede
ejecutar son las RPC del esquema `api`.

---

## 1. Diagnóstico rápido por síntoma

| Síntoma | Primera causa a descartar | Cómo se comprueba |
|---|---|---|
| **Todo aparece vacío y ninguna acción guarda** | El esquema `api` no está expuesto en la Data API | `select rolconfig from pg_roles where rolname='authenticator'` debe contener `pgrst.db_schemas` con `api`. Si no, reaplica la migración `data_api_exposed_schemas` |
| **«Tu identidad es válida pero no tiene una cuenta»** | La persona autenticó pero no tiene fila en `api.user_profiles`, o la tiene `disabled` | Pantalla *Seguridad* → crear o reactivar. Es el comportamiento correcto, no un fallo |
| **Inicia sesión bien y vuelve a la pantalla de entrada** | Dos clientes de Supabase peleándose por el refresh token — **defecto corregido en F9.1** | La consola del navegador muestra «Multiple GoTrueClient instances detected». Si vuelve a aparecer, alguien añadió un segundo `createClient`: sólo debe existir el de `services/adapters/supabaseClient.ts` |
| **«Continuar con Google» devuelve un error del proveedor** | El proveedor Google no está habilitado, o la URL de retorno no está autorizada | *Authentication → Providers → Google* (client id y secreto de Google Cloud) y *URL Configuration → Redirect URLs*. Paso 5 de `docs/primer-administrador.md` |
| **Entra con Google y sale con «no tiene una cuenta»** | Es el comportamiento correcto: autenticar no es tener cuenta | Dale de alta en *Seguridad*. Google cambia cómo se llama a la puerta, no quién tiene llave |
| **Una acción falla con «permiso o sesión no activa»** | El rol no tiene el permiso, **o la sesión fue revocada** | `select * from private.authorization_audit order by occurred_at desc limit 20` |
| **La IA responde «el proxy está limitando»** | Distingue el límite del proxy del del proveedor | El evento de observabilidad lleva `rateLimitOrigin`: `proxy`, `provider` o `unknown`. `unknown` significa que no se pudo determinar, y se dice en vez de adivinar |
| **La IA no responde y el proxy da 401** | El token no llega, o la identidad no tiene cuenta | El motivo viaja en el envoltorio: `missing_bearer_token`, `unexpected_issuer`, `account_required`, `anonymous_caller` |
| **Un archivo adjunto no se abre** | La URL firmada caducó (5 min) o el objeto no llegó a `ready` | `select state from api.file_objects where object_path = '...'` |
| **El despliegue no sale** | Faltan los secretos, o los gates están rojos | Pestaña *Actions* → workflow `CI` → trabajo `deploy` |

---

## 2. Cambiar el esquema

```bash
supabase link --project-ref <ref>     # una vez
supabase db push                      # aplica lo pendiente, en orden
```

**Las migraciones se aplican antes que el código que las usa, nunca al revés.**
Son aditivas respecto a la aplicación en ejecución: una tabla nueva que nadie
lee todavía no molesta; un código que llama a una RPC que aún no existe, sí.

Antes de subir nada:

```bash
bash scripts/supabase/local.sh verify
```

Reconstruye el esquema desde cero dos veces, corre los contratos pgTAP, el lint
de SQL, los advisors de seguridad y la comprobación de tipos generados. Necesita
Docker. Es exactamente lo que corre `.github/workflows/supabase.yml`.

**Una tabla nueva sin `revoke` queda expuesta por la Data API.** El gate que lo
detecta es `supabase db advisors`; los avisos `rls_enabled_no_policy` que sí
aparecen son la postura deny-by-default declarada y son correctos.

---

## 3. Altas, bajas y cambios de rol

Todo se hace desde la pantalla **Seguridad**, con una cuenta que tenga
`users:create` / `users:update` / `users:delete`.

Lo que ocurre por debajo, y por qué está partido en dos:

1. La Edge Function `provision-user` **invita** a la persona. Es lo único que
   necesita la clave de servicio, y comprueba el permiso del administrador
   preguntándoselo a la base de datos antes de hacer nada.
2. El navegador, con la sesión del administrador, llama a
   `api.provision_user_profile`. Ahí viven el permiso, la regla de que sólo un
   `superadmin` concede roles administrativos, y la entrada de auditoría con el
   actor real.

Escribir el perfil dentro de la función habría duplicado esas reglas, y la copia
que se queda vieja siempre es la que concede de más.

**El primer administrador** no se puede crear así, porque no hay ninguno que lo
cree: `docs/primer-administrador.md` es el procedimiento, en cinco minutos y sin
programar.

**Revocar el acceso de alguien** es `set_user_status(target, 'disabled')` desde
la pantalla. Surte efecto en la siguiente llamada: `private.current_role()`
devuelve `NULL` para un perfil no activo, y `NULL` no concede nada.

---

## 4. Archivos

Dos cubos privados: `artifact-files` e `initiative-documents`. Ninguno es
público y ninguno se abre sin una URL firmada, que caduca en cinco minutos.

La ruta de un objeto **es** su autorización:

```
{uid}/{contexto}/{agregado}/{entidad}/v{versión}/{objectId}.{ext}
```

El primer segmento es el uid de quien subió, así que una ruta ajena falla en la
política antes de tocar ningún byte. El último es el id que Storage asigna, que
es lo que ata la fila de `api.file_objects` al binario.

**Un objeto cuyo registro no llegó a `ready` es ilegible por política.** Es
deliberado: un fallo a medio camino deja un archivo inaccesible en vez de un
documento que existe para el almacenamiento y no para el producto. Para
encontrarlos:

```sql
select id, object_path, state, created_at
from api.file_objects
where state <> 'ready' and created_at < now() - interval '1 hour';
```

---

## 5. Respaldo y recuperación

**El respaldo de PostgreSQL no respalda los binarios de Storage.** Son dos
copias distintas y hay que probar las dos; darlo por hecho es el error que F2.6
existe para evitar.

- **Base de datos**: los respaldos automáticos del plan, más
  `supabase db dump -f respaldo.sql` para una copia bajo control propio.
- **Storage**: `supabase storage cp -r ss:///artifact-files ./respaldo/` y lo
  mismo para `initiative-documents`.

Para restaurar: primero el esquema (`supabase db push` sobre un proyecto
limpio), después los datos, después los objetos. Comprobación de que la
restauración sirve: las filas de `api.file_objects` en estado `ready` tienen que
tener su objeto, y `scripts/supabase/retirement-completeness-remote-probe.sql`
recorre las RPC principales en una transacción que se revierte.

---

## 6. Desplegar

Un solo camino publica producción: **PR contra `main` → los gates de `ci.yml` →
su trabajo `deploy`**. `vercel.json` apaga el despliegue automático de la
integración Git *sólo* en `main`, así que cada PR conserva su vista previa.

Nunca `vercel --prod` a mano: un artefacto que no se puede reconstruir desde
`main` no es un despliegue, y este proyecto ya sirvió durante días un commit que
no existía en el repositorio.

Reversión y detalle de secretos: `docs/ci-cd-pipeline.md`.

---

## 7. Lo que no hay que hacer

- **No pongas `service_role` en una variable `VITE_*`.** Viajaría dentro del
  bundle. Lo único que la usa es la Edge Function, y allí la inyecta la
  plataforma.
- **No cambies «Exposed schemas» desde el panel** sin volver a comprobar que
  `api` sigue dentro. Reescribe la configuración del contenedor y puede
  deshacer lo que la migración fija.
- **No edites `api.user_profiles` a mano** después del primer administrador. Se
  pierde el rastro de quién concedió qué.
- **No concedas privilegios a `service_role` sobre las tablas de `api`.** Están
  revocados a propósito: la clave de servicio se salta RLS, y el día que una
  función la use por comodidad, la postura deny-by-default deja de existir.
