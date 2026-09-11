# F1.6 — Architecture Decision Records (ADRs)

Cada ADR sigue el formato: título, estado, contexto, decisión, consecuencias, implementación.

---

## ADR-001: Backend confiable para operaciones sensibles

**Estado**: Aprobado (propuesto para F1)

**Contexto**: La aplicación es frontend-only (React + Firebase + Gemini). Operaciones sensibles (aprobar encargo ARB, provisionar usuarios, cambiar roles, rotar claves IA) no pueden depender únicamente de validaciones del cliente ni de reglas de base de datos que un atacante pueda evadir invocando la API directamente.

**Decisión**: Introducir un backend confiable mínimo mediante **Supabase Edge Functions** (Deno) y **PostgreSQL functions (RPC)** con `SECURITY DEFINER` solo donde sea estrictamente necesario. El frontend nunca expone `service_role` ni claves secretas.

| Operación | Mecanismo | Validación servidor |
|-----------|-----------|---------------------|
| Provisionar usuario | Edge Function `provision_user` | `initiated_by` tiene `users:provision`; `role ≠ admin/superadmin` salvo superadmin; crea en `auth.users` + perfil en transacción |
| Decidir encargo ARB | Edge Function `decide_engagement` | `actor_id` tiene `deliverables:arb-decide` en ese encargo; verdict ∈ {approved, changes-requested, rejected}; si approved → `status = delivered` inmutable |
| Revocar sesiones | Edge Function `revoke_sessions` | `requested_by` admin/superadmin; invalida `auth.sessions` |
| Rotar claves IA | Edge Function `rotate_ai_keys` | `requested_by` superadmin; actualiza `vault.secrets` |
| Concurrencia artefactos | PostgreSQL RPC `upsert_artifact_version` | Optimistic lock vía `expected_updated_at`; retorna conflicto en lugar de sobrescribir |

**Consecuencias**:
- El frontend deja de ser la autoridad de reglas sensibles.
- Edge Functions corren en el mismo proyecto Supabase; latencia < 50ms desde el cliente.
- RPC con `SECURITY DEFINER` solo para operaciones que *requieren* bypass RLS (upsert con lock optimista, agregados); auditadas con `supabase db advisors`.
- Requiere configurar `supabase/functions/` con Deno, tests locales (`supabase functions serve`), y deploy por entorno.

**Implementación**: F2.3 (plataforma) → F4.1 (identidad) → F4.2 (autorización) → F5 (migración por cortes).

---

## ADR-002: Contratos de módulo (Public API) y barriles

**Estado**: Aprobado

**Contexto**: `modules.json` declara 32 módulos en capas `ui`, `domain`, `foundation`. Hoy hay 76 deep imports y 23 ciclos presupuestados. Un módulo solo es un módulo si se entra por su `index.ts` (barril).

**Decisión**:
1. Cada módulo de `domain` expone **solo** su `index.ts` como API pública. Internals no son importables desde fuera.
2. `lib/` y `utils/` (foundation) **nunca** importan de `services/` (domain) ni `ui`.
3. Una pantalla (página/componente de ruta) importa **máximo 2** módulos de servicio. Si necesita un tercero, la orquestación pasa a un *application service* que la pantalla llama una vez.
4. Tipos compartidos entre contextos bajan a `lib/artifacts/`.
5. Dependencia unidireccional → puerto en el receptor (interface en `domain/`, implementación en `infrastructure/adapters/`).

**Consecuencias**:
- El gate `check:module-boundaries` pasa de "presupuesto decreciente" a "cero tolerancia" al cerrar F1.
- `services/geminiService.ts` (5413 líneas, raíz de `services/`) **debe** moverse a `services/ai/` con puertos definidos antes del primer piloto de datos (F3.1/F3.2).
- Los 19 archivos sueltos en `services/` se asignan a módulos o se eliminan.

**Implementación**: F3.1 (puertos), F3.2 (adaptadores), F3.3 (extraer reglas de UI).

---

## ADR-003: Data API, RLS y exposición de esquemas

**Estado**: Aprobado

**Contexto**: Supabase expone Data API (PostgREST) sobre esquemas con grants a `anon`/`authenticated`. Por defecto, tablas nuevas en `public` reciben grants automáticos. RLS no basta si la tabla es accesible.

**Decisión**:
1. **Esquema privado por defecto**: tablas de dominio en esquemas dedicados (`office`, `artifacts`, `knowledge`, `learning`, `public` solo para `user_profiles`, `business_initiatives`, `architecture_projects`, `ai_settings`, `user_settings`, `audit_log`, `outbox_events`).
2. **Grants explícitos**: `GRANT SELECT, INSERT, UPDATE, DELETE ON schema.table TO authenticated;` (y `anon` solo donde proceda, p. ej. `user_settings` own). **Ningún grant automático**.
3. **RLS enable + policies** en **todas** las tablas expuestas. `SECURITY INVOKER` para vistas.
4. **Pre-request function** para rate limiting por IP/usuario y validación de API key organizacional en endpoints públicos.
5. **No `firestore.indexes.json`**: los índices se declaran en migraciones SQL; deploy de reglas nunca reconciliará índices.

**Consecuencias**:
- Control total de superficie de API.
- `supabase db advisors` debe pasar antes de cada migración.
- `GRANT` y `REVOKE` versionados en migraciones.

**Implementación**: F2.3 (esquemas, grants, RLS), F2.4 (CI validation).

---

## ADR-004: Identidad — Supabase Auth como proveedor único

**Estado**: Aprobado

**Contexto**: Migración desde Firebase Auth. Usuarios existentes con Firebase UID, roles en `user_profiles.role`, claims personalizados. Supabase Auth usa `auth.users` (PostgreSQL) + JWT estándar.

**Decisión**:
1. **Proveedor único**: Supabase Auth (email/password, Google OAuth, SSO/MFA futuro). Sin convivencia Firebase+Supabase en producción.
2. **Migración de usuarios**: Exportar de Firebase → importar a Supabase (`supabase-community/firebase-to-supabase`). Preservar `uid` **solo si** es UUID v4 estándar; si no, mapear `firebase_uid → supabase_uuid` en tabla `user_identity_map` y reescribir FKs en migración de datos.
3. **Roles/permisos**: En `app_metadata` (no `user_metadata`) + tabla `user_profiles.role` + `user_memberships` para multi-tenencia. RLS/RPC leen de aquí, nunca de `user_metadata`.
4. **Sesiones**: JWT corto (15-30 min) + refresh token rotativo. Revocación real via `auth.sessions` (validar `session_id` en operaciones sensibles).
5. **Bootstrap superadmin**: Un solo script admin una vez (`supabase.auth.admin.createUser` + perfil `superadmin`); sin auto-provisión "primer usuario".

**Consecuencias**:
- No hay promesa de continuidad de contraseña ni sesiones sin prueba.
- Requiere acceso autorizado a Firebase para exportación (F0.5 pendiente).
- `deleteUser` en Firebase solo borraba perfil; en Supabase RPC `delete_user_profile` borra perfil + invoca `supabase.auth.admin.deleteUser` (service role) en misma transacción lógica.

**Implementación**: F2.1 (decisión managed vs self-hosted), F4.1–F4.6.

---

## ADR-005: Migración progresiva por cortes verticales

**Estado**: Aprobado

**Contexto**: Reescribir todo de una vez es riesgoso. El plan define cortes: piloto → iniciativas → proyectos → encargos → artefactos → conocimiento/aprendizaje.

**Decisión**:
1. **Un corte = un contexto completo** (UI → caso de uso → dominio → adaptador Supabase → tabla + RLS + RPC + tests).
2. **Una sola fuente de escritura** por conjunto de datos durante la transición. Sin dual-write ingenuo.
3. **Adaptadores intercambiables** (F3.2): repositorios hablan puertos; configuración selecciona Firebase o Supabase por contexto.
4. **ETL idempotente** con checkpoints, manifiesto y reconciliación de conteos/checksums.
5. **Reversión ensayada** antes de expandir: snapshot + script de rollback por corte.

**Consecuencias**:
- F5.1–F5.7 se ejecutan en secuencia; no se inicia el siguiente sin aceptar el anterior.
- El orden puede cambiar si invariantes exigen mover conjuntos juntos (consistencia > orden tentativo).

**Implementación**: F3 (fundaciones) → F5 (migración por cortes).

---

## ADR-006: Hosting y operación

**Estado**: Propuesto (requiere decisión de operaciones)

**Contexto**: Hoy Vercel para React + Firebase Functions (proxy IA). Supabase Edge Functions sustituyen Functions; hosting puede seguir en Vercel o moverse.

**Decisión** (por confirmar con operaciones):
- Opción A: **Vercel sigue** (React build + preview deploy). Edge Functions en Supabase. DNS `app.dominio.com` → Vercel; `api.dominio.com` → Supabase (o mismo dominio con rewrite).
- Opción B: **Supabase Hosting** (si maduro) o **Cloudflare Pages** + Workers para edge.
- **Secretos**: Solo en Vercel/Supabase dashboard (NUNCA en repo). `VITE_*` build-time inlined; runtime config via Edge Function env.
- **Observabilidad**: Supabase Logs + Vercel Analytics + Sentry (si contratado).

**Implementación**: Decisión en F1.7 / F2.1.

---

## ADR-007: Kernel de IA canónico y credenciales organizacionales

**Estado**: Aprobado (refuerza AGENTS.md regla 13)

**Contexto**: `services/geminiService.ts` monolito de 5413 líneas mezcla motor, prompts, retry, fallback, error mapping. Credenciales de operador (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`) están en variables de entorno del proxy Vercel.

**Decisión**:
1. **Separar** `services/ai/` (kernel canónico: `Domain → ai → adapter → API`) de `services/geminiService.ts` (legacy adapter).
2. **Credenciales organizacionales** (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`) solo en backend (Edge Function proxy `/api/ai`). El frontend usa `VITE_AI_PROXY_URL` y BYOK opcional por usuario (guardado cifrado en `ai_settings`).
3. **Guardrails** (`services/ai/guardrails`) corren **antes** de cualquier llamada al adapter (hard-block = 0 llamadas).
4. **Model tier routing** (`routeRequest`) elige backend por capacidad declarada, no por string de proveedor.

**Consecuencias**:
- `strict` completo habilitable módulo a módulo tras split.
- Tests finos por capacidad (mock adapter in-memory).
- Proveedor intercambiable sin tocar casos de uso.

**Implementación**: F3.1 (puertos IA), F3.6 (kernel canónico), F3.4 (split geminiService).