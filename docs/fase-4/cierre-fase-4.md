# Fase 4 — Identidad, autorización y permisos (estado)

Rama: `feature/fase4-identidad-autorizacion` (sobre F3). Proyecto: **ArkyDB-US**
(`btbhkmckrazoayaoorys`, `us-east-1`). Modelo simple por decisión del usuario:
single-tenant, sin MFA y sin SSO.

## Estado por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| F4.1 Supabase Auth (login, logout, recuperación, provisión) | **Pendiente** | Requiere el adaptador TypeScript y `@supabase/supabase-js`; no implementado |
| F4.2 Roles, permisos y RLS en PostgreSQL | **Hecho y verificado en remoto** | `supabase/migrations/20260912044359_identity_authorization.sql`, `20260912052000_authorization_surface.sql` |
| F4.3 Paridad de la matriz y pruebas negativas | **Hecho** | `__tests__/authz/sqlMatrixParity.test.ts` (5 pruebas), `supabase/tests/database/identity_authorization.test.sql` (45 aserciones), sonda remota de 19 casos |
| F4.4 Migración de usuarios | **Pendiente por diseño**: la PoC no tiene usuarios reales; sin datos que migrar | ADR-004; inventario aprobado sin usuarios que trasladar |
| F4.5 Convivencia temporal Firebase/Supabase | **No aplica** (proveedor único) | ADR-004 |
| F4.6 Expiración, revocación y semántica de sesión | **Pendiente** | Diseñado en ADR-004 punto 4; sin implementar |

## Lo implementado

### Autorización como datos (`api.user_profiles`, `private.role_permissions`)

- `api.user_profiles`: `id` (FK a `auth.users`), `role` (6 valores), `status`
  (`active`/`disabled`), `display_name`, marcas de tiempo. RLS activa.
- `private.role_permissions`: las **63 celdas** de la matriz, espejo en SQL de
  `ROLE_PERMISSIONS`. RLS activa y forzada.
- `private.authorization_audit`: quién, sobre quién, qué acción y transición de
  rol. Sin datos personales.
- Helpers `private.current_role()` y `private.has_permission(text)`:
  `SECURITY DEFINER`, `search_path` vacío, fallan cerrado (sin perfil, cuenta
  deshabilitada o rol desconocido → cero permisos).
- `api.current_permissions()`: superficie de lectura para el cliente, limitada a
  los permisos **del propio llamante**.
- RPC auditadas: `api.provision_user_profile`, `api.set_user_role`,
  `api.set_user_status`, `api.delete_user_profile`. El cliente **no** puede
  insertar, borrar ni cambiar su rol por `UPDATE`: solo leer y editar su nombre.

### Invariantes del servidor, no de la interfaz

1. Nadie cambia su propio rol ni se deshabilita a sí mismo.
2. Solo `superadmin` concede `admin`/`superadmin`; un `admin` no puede.
3. Un rol inventado se rechaza con `22023`.
4. El borrado directo está cerrado: solo por RPC auditada.
5. Cada cambio autorizado deja exactamente una entrada de auditoría.

## Verificación

### Sonda funcional contra el PostgreSQL 17 real (19/19, cero fallos)

`scripts/supabase/authz-remote-probe.sql` — se ejecuta dentro de una transacción
que **revierte**, de modo que no deja usuarios, perfiles ni auditoría. Casos
cubiertos: cuenta sin perfil, `viewer` (solo se ve a sí mismo, no cambia roles,
no se auto-provisiona), cuenta deshabilitada (sin filas ni permisos), `admin`
(ve el directorio, cambia roles no privilegiados, **no** concede `admin`, no se
cambia el suyo), `superadmin` (concede `admin`, no puede por `UPDATE` directo,
sí edita su nombre), borrado directo cerrado, rol inventado, `anon` sin acceso, y
auditoría con el número exacto de entradas.

### Catálogo (consultado tras aplicar)

RLS activa en `user_profiles` (sin `FORCE`, deliberado) y forzada en
`authorization_audit` y `role_permissions`; 3 políticas de perfil; `authenticated`
con `SELECT` y `UPDATE` **solo** de `display_name`.

### Paridad de matrices

`sqlMatrixParity.test.ts` compara la migración SQL, celda por celda, con
`ROLE_PERMISSIONS`: roles, permisos, universo completo y el total de 63 celdas.

### Dos hallazgos que la verificación produjo

1. **`FORCE RLS` no bloqueaba la auditoría**: el arnés nativo corre `postgres`
   como *superusuario* (bypasa RLS siempre), pero en Supabase `postgres` no es
   superusuario. Se comprobó por consulta que `postgres` tiene
   `rolbypassrls = true` en la plataforma, así que el diseño de la fundación es
   correcto. Se verificó en vez de suponerlo.
2. **Un cliente no puede llamar `private.has_permission(...)`**: sin `USAGE` en
   `private`, la llamada directa falla con `42501`. La política sí puede
   invocarlo (su expresión está resuelta). Esto rompía el propio test pgTAP y
   dejaba a la interfaz sin forma de conocer sus permisos: se añadió
   `api.current_permissions()` y se corrigió el test.

## Pendiente y bloqueado

- **Arnés SQL local (`scripts/supabase/test-native.py`)**: bloqueado por
  expiración del aviso de aprobación en este entorno. Las pruebas pgTAP
  (`identity_authorization.test.sql`) están escritas y sus semánticas
  corregidas, pero **no se han ejecutado localmente**; la verificación real se
  hizo contra el PostgreSQL 17 remoto con la sonda de 19 casos.
- **`FORCE RLS` en `api.user_profiles`** no es posible sin recursión en la
  política; se documenta en la migración y se compensa con privilegios.
- **F4.1 y F4.6** siguen abiertos: adaptador de identidad en TypeScript y
  semántica de sesión/revocación.
- **Exposición de esquemas en el Data API remoto**: `config.toml` solo gobierna
  el entorno local; confirmar en el dashboard qué esquemas están expuestos.
