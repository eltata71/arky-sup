# Fase 4 — Identidad, autorización y permisos (estado)

Rama: `feature/fase4-identidad-autorizacion` (sobre F3). Proyecto: **ArkyDB-US**
(`btbhkmckrazoayaoorys`, `us-east-1`). Modelo simple por decisión del usuario:
single-tenant, sin MFA y sin SSO.

## Estado por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| F4.1 Supabase Auth | **Adaptador hecho**; creación de usuarios de Auth (service role) **pendiente** | `services/adapters/supabaseIdentityAdapter.ts`, `supabaseAuthClient.ts`, `identityBackend.ts`; 21 pruebas |
| F4.2 Roles, permisos y RLS en PostgreSQL | **Hecho y verificado en remoto** | migraciones `20260912044359`, `20260912052000` |
| F4.3 Paridad de matriz y pruebas negativas | **Hecho** | `sqlMatrixParity.test.ts` (5), pgTAP (51 aserciones), sonda remota (23 casos) |
| F4.4 Migración de usuarios | **No aplica en la PoC**: no hay usuarios reales que trasladar | ADR-004; inventario aprobado |
| F4.5 Convivencia temporal Firebase/Supabase | **No aplica** (proveedor único) | ADR-004 |
| F4.6 Expiración, revocación y semántica de sesión | **Hecho y verificado en remoto** | migración `20260912060500_session_guard.sql`; 4 casos negativos |

## Lo implementado

### Autorización como datos (`api.user_profiles`, `private.role_permissions`)

- `api.user_profiles`: `id` (FK a `auth.users`), `role` (6 valores), `status`,
  `display_name`, marcas de tiempo. RLS activa.
- `private.role_permissions`: las **63 celdas** de la matriz, espejo en SQL de
  `ROLE_PERMISSIONS`. RLS activa y forzada.
- `private.authorization_audit`: quién, sobre quién, qué acción y transición de
  rol. Sin datos personales.
- Helpers `private.current_role()` y `private.has_permission(text)`:
  `SECURITY DEFINER`, `search_path` vacío, fallan cerrado.
- `api.current_permissions()`: superficie de lectura para el cliente, limitada a
  los permisos **del propio llamante**.
- RPC auditadas: `provision_user_profile`, `set_user_role`, `set_user_status`,
  `delete_user_profile`. El cliente **no** inserta, borra ni cambia su rol por
  `UPDATE`: solo lee y edita su nombre.

### Identidad (F4.1)

- `IdentityPort` ampliado con sesión: `getSession`, `signInWithPassword`,
  `signOut`, `requestPasswordReset`, más `AuthSession` con vencimiento explícito
  y `sessionId` declarado como `null` cuando el proveedor no lo expone.
- Adaptador Supabase con el **cliente inyectado** (interfaz estructural), lo que
  permite probarlo sin red, sin SDK y sin base de datos.
- `sessionIdFromAccessToken`: extrae el `session_id` del token para que el
  servidor pueda validar revocación. No verifica la firma —eso es del servidor—
  y devuelve `null` en vez de inventar un id.
- Carga del SDK **dinámica** en `supabaseAuthClient.ts`, el único fichero que
  importa `@supabase/supabase-js`.
- `loadIdentityPort(env, contexto)`: Firebase por defecto (el proveedor que hoy
  atiende), Supabase cuando el backend se resuelve a `supabase`.

### Sesión y revocación (F4.6)

- `private.is_session_active()`: la sesión del token debe existir en
  `auth.sessions`, pertenecer a `auth.uid()` y no haber pasado `not_after`.
  **Revocar en Supabase Auth es borrar la fila** — no hay columna `revoked`.
  Comprobado en el catálogo real antes de escribir la guarda.
- `private.assert_session_active()`: se ejecuta en las cuatro RPC sensibles
  después de comprobar el permiso. Falla cerrado si el token no declara
  `session_id`.
- `isSessionUsable(session, nowMs, skew)`: política de cliente, falla cerrado,
  con margen para el desfase de reloj.

## Verificación

### Arnés SQL local (PostgreSQL 16.15, dos reconstrucciones limpias)

`python3 scripts/supabase/test-native.py` — **51/51** en
`identity_authorization.test.sql` y **41/41** en `platform_foundation.test.sql`,
con `plpgsql_check` sin hallazgos y la detección de política debilitada activa.

### Sonda funcional contra el PostgreSQL 17 real (23 casos, cero fallos)

`scripts/supabase/authz-remote-probe.sql`, en una transacción que **revierte**.
Además de los casos de autorización ya verificados, cubre: **sesión revocada**,
**token sin `session_id`**, **sesión de otro usuario** y **sesión pasada de su
fecha techo**, todas rechazadas con `42501`.

### Bundle: el SDK no entra en el arranque

`npm run build:placeholders` + `check:bundle-budget`: **exit 0**, eager
**432.8 KB** de 450 — **sin cambios**. El bundle no contiene clases del SDK
(`GoTrueClient`/`PostgrestClient`/`SupabaseClient`): la única aparición de
«supabase» es una palabra en un prompt del motor legacy. `check:bundle-secrets`:
sin credenciales en `dist/`.

**Matiz honesto:** hoy el módulo de adaptadores **no está cableado en la
aplicación**, así que su aporte al bundle es cero por ausencia de uso, no por la
carga diferida. La carga dinámica es lo que lo mantendrá fuera cuando el cableado
llegue en el corte vertical; la prueba que lo vigilará es `check:bundle-budget`.

### Gates

`typecheck`, `lint`, `check:module-boundaries`, `check:module-size`,
`check:any-budget` (23/23), `sqlMatrixParity` (5/5) y las 21 pruebas del
adaptador: en verde. Tipos regenerados desde el proyecto: **sin drift** frente al
baseline.

## Correcciones que produjo la verificación

1. La prueba de paridad no leía `users:grant-privileged` (expresión regular sin
   guion), y esa omisión aparecía como un permiso ausente en SQL.
2. El pgTAP llamaba `private.has_permission(...)` desde el cliente: en la
   plataforma eso **falla** con `42501`. Se añadió `api.current_permissions()`.
3. Una aserción afirmaba que un observador tiene **cero** permisos, cuando tiene
   los suyos. Se corrigió a «no tiene el permiso de directorio».
4. El borrado de `auth.users` en la prueba chocaba con la FK de
   `platform_probes`; ahora solo se tocan las fixtures propias.
5. El arnés usaba `tests[0]` para su prueba de mutante, y dejó de ser el archivo
   correcto al añadirse el de autorización.
6. El adaptador de Supabase guardaba el uid observado en estado de módulo, así
   que dos instancias se pisaban; ahora el estado es por instancia.

## Pendiente

- **Creación de usuarios de Auth** (`auth.admin.createUser`) requiere clave de
  servicio: va en Edge Function, no en el navegador. No implementado.
- **Cableado del adaptador** en `context/AuthContext` y `services/identity` para
  que la aplicación use el puerto: entra con el corte vertical (F5), no antes.
- **F4.4** sin trabajo por diseño: la PoC no tiene usuarios reales.
- **Exposición de esquemas en el Data API remoto**: confirmar en el dashboard
  qué esquemas están expuestos; `config.toml` solo gobierna lo local.
- **Docker ausente**: el arnés nativo no sustituye la paridad PG17 vía CLI, el
  `db reset` de la CLI ni los servicios Auth/REST/Storage del workflow de CI.
