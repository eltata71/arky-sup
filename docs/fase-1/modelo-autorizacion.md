# F1.4 — Modelo de autorización por permiso y alcance

Base: `lib/authz/permissions.ts`, `firestore.rules`, `services/identity/index.ts`, `docs/oficina-arquitectura.md`.
Objetivo: autorización declarativa, testeable, consistente entre cliente (UI) y servidor (RLS/RPC), migrable a Supabase.

## 1. Principios

1. **Permiso, no rol**: el código pregunta `can(profile, 'permiso:acción')`, nunca `profile.role === 'admin'`.
2. **Una sola matriz**: `PERMISSION_MATRIX` en `lib/authz/permissions.ts` es la fuente de verdad. `firestore.rules` implementa la misma matriz; `__tests__/authz/rulesMatrix.test.ts` compara ambas celda por celda.
3. **Alcance (scope)**: los permisos se evalúan en un ámbito — organización, iniciativa, proyecto, encargo, artefacto. Un permiso global no implica acceso a todo.
4. **Separación de funciones**: productor ≠ revisor; aprobador ≠ autor; quien concede privilegio no lo recibe.
5. **Revoco y caducidad**: un permiso concedido puede revocarse; los claims en JWT no son frescos hasta que el token se refresca. Operaciones sensibles validan `session_id` contra `auth.sessions` (o equivalente Supabase).

## 2. Catálogo de permisos (de `lib/authz/permissions.ts`)

| Permiso | Descripción | Ámbito natural |
| --- | --- | --- |
| `initiatives:create` | Crear iniciativa de negocio | Organización |
| `initiatives:read` | Leer iniciativas (lista/detalle) | Organización / Iniciativa |
| `initiatives:update` | Actualizar iniciativa (no `code`) | Iniciativa (owner/admin) |
| `initiatives:delete` | Eliminar iniciativa | Iniciativa (admin) |
| `initiatives:consolidate` | Ejecutar consolidación de entrega | Iniciativa (owner/reviewer) |
| `projects:create` | Crear proyecto de arquitectura | Iniciativa (architect/reviewer) |
| `projects:read` | Leer proyectos | Proyecto / Iniciativa |
| `projects:update` | Actualizar proyecto (no `ownerId`) | Proyecto (owner/admin) |
| `projects:delete` | Eliminar proyecto | Proyecto (admin) |
| `projects:artifact:index` | Gestionar índice de artefactos del proyecto | Proyecto (owner) |
| `deliverables:create` | Crear solicitud de entregable (intake) | Proyecto (architect/reviewer) |
| `deliverables:read` | Leer entregables | Encargo / Proyecto |
| `deliverables:write` | Producir/revisar artefactos de un entregable | Entregable (assignee/reviewer) |
| `deliverables:approve-charter` | Aprobar charter propuesto | Encargo (reviewer/coordinator) |
| `deliverables:arb-decide` | Decidir en ARB (entregar/cambios/rechazar) | Encargo (reviewer/superadmin) |
| `artifacts:create` | Crear artefacto (primera versión) | Proyecto / Entregable |
| `artifacts:revise` | Crear nueva versión de artefacto | Artefacto (autor/reviewer) |
| `artifacts:read` | Leer artefacto | Proyecto / Encargo |
| `artifacts:export` | Exportar artefacto (PDF/PPTX/…) | Artefacto (lector autorizado) |
| `artifacts:publish` | Publicar artefacto (pipeline) | Artefacto (reviewer) |
| `engagements:run` | Ejecutar/reanudar encargo | Encargo (coordinator/assignee) |
| `engagements:read` | Leer encargo y tareas | Encargo / Proyecto |
| `users:read` | Leer perfiles de usuarios | Organización |
| `users:provision` | Crear cuenta (admin) | Organización (admin) |
| `users:update-role` | Cambiar rol de usuario (superadmin) | Usuario (superadmin) |
| `users:delete` | Eliminar perfil (no identity) | Usuario (admin, no propio superadmin) |
| `settings:read` | Leer configuración | Usuario / Organización |
| `settings:write` | Escribir configuración (IA, flags) | Usuario (own) / Organización (admin) |
| `training:create` | Crear curso/módulo/lección | Organización (trainer/admin) |
| `training:read` | Consumir formación | Usuario (viewer+) |
| `training:write-progress` | Registrar progreso propio | Usuario (own) |
| `knowledge:read` | Consultar grafo de conocimiento | Organización |
| `knowledge:write` | Actualizar grafo (pipeline) | Sistema / Admin |
| `ai:generate` | Invocar generación de artefactos/diagramas | Usuario (architect+) con cuota |
| `ai:configure` | Configurar proveedor/modelo IA | Organización (admin) |

## 3. Matriz rol → permisos (extraída de `lib/authz/permissions.ts`)

| Permiso | viewer | architect | reviewer | trainer | admin | superadmin |
| --- | --- | --- | --- | --- | --- | --- |
| `initiatives:create` |  | ✓ | ✓ |  | ✓ | ✓ |
| `initiatives:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `initiatives:update` |  | own | own |  | ✓ | ✓ |
| `initiatives:delete` |  |  |  |  | ✓ | ✓ |
| `initiatives:consolidate` |  | ✓ | ✓ |  | ✓ | ✓ |
| `projects:create` |  | ✓ | ✓ |  | ✓ | ✓ |
| `projects:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `projects:update` |  | own | own |  | ✓ | ✓ |
| `projects:delete` |  |  |  |  | ✓ | ✓ |
| `projects:artifact:index` |  | own | own |  | ✓ | ✓ |
| `deliverables:create` |  | ✓ | ✓ |  | ✓ | ✓ |
| `deliverables:read` | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `deliverables:write` |  | assignee | reviewer |  | ✓ | ✓ |
| `deliverables:approve-charter` |  |  | ✓ |  | ✓ | ✓ |
| `deliverables:arb-decide` |  |  | ✓ |  |  | ✓ |
| `artifacts:create` |  | ✓ | ✓ |  | ✓ | ✓ |
| `artifacts:revise` |  | own | reviewer |  | ✓ | ✓ |
| `artifacts:read` | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `artifacts:export` | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `artifacts:publish` |  |  | ✓ |  | ✓ | ✓ |
| `engagements:run` |  | assignee | ✓ |  | ✓ | ✓ |
| `engagements:read` | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `users:read` |  |  | ✓ |  | ✓ | ✓ |
| `users:provision` |  |  |  |  | ✓ | ✓ |
| `users:update-role` |  |  |  |  |  | ✓ |
| `users:delete` |  |  |  |  | ✓* | ✓* |
| `settings:read` | own | own | own | own | ✓ | ✓ |
| `settings:write` | own | own | own | own | ✓ | ✓ |
| `training:create` |  |  |  | ✓ | ✓ | ✓ |
| `training:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `training:write-progress` | own | own | own | own | ✓ | ✓ |
| `knowledge:read` | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `knowledge:write` |  |  |  |  |  | ✓ |
| `ai:generate` |  | ✓ | ✓ |  | ✓ | ✓ |
| `ai:configure` |  |  |  |  | ✓ | ✓ |

\* `users:delete` en admin/superadmin: no puede eliminar su propio perfil superadmin; no degrada superadmin a rol inferior (ver SEC-04).

## 4. Alcance (scope) — cómo se resuelve

```typescript
// En lib/authz/permissions.ts
interface PermissionScope {
  organizationId?: string;      // single-tenant lógico actual
  initiativeId?: string;        // NEG-YYYY-NNN
  projectId?: string;           // ArchitectureProject.id
  engagementId?: string;        // OfficeEngagement.id
  artifactId?: string;          // Artifact.id / versionGroupId
  userId?: string;              // para own/assignee/reviewer
}

function can(profile: AuthProfile, permission: string, scope: PermissionScope): boolean {
  // 1. Resuelve rol efectivo (incluye claims frescos si hay sesión válida)
  // 2. Busca permiso en PERMISSION_MATRIX[role]
  // 3. Evalúa alcance:
  //    - 'own'      → profile.uid === scope.userId
  //    - 'assignee' → scope.engagementId + charter.deliverables[].assigneeId === profile.uid
  //    - 'reviewer' → scope.engagementId + charter.deliverables[].reviewerId === profile.uid
  //    - 'admin'    → role === 'admin' || role === 'superadmin'
  //    - global     → sin restricción de ámbito
}
```

## 5. Reglas de servidor (Supabase / PostgreSQL)

### 5.1 RLS por tabla (equivalente a `firestore.rules`)

```sql
-- users
CREATE POLICY "user read own" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "admin read all users" ON users
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin')));

CREATE POLICY "superadmin write roles" ON users
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'superadmin'));

-- business_initiatives
CREATE POLICY "initiative read" ON business_initiatives
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin','reviewer')));

CREATE POLICY "initiative create" ON business_initiatives
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('architect','reviewer','admin','superadmin')));

-- projects (architecture_projects)
CREATE POLICY "project read" ON architecture_projects
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR initiative_ids && (SELECT initiative_ids FROM architecture_projects WHERE id = architecture_projects.id) OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin','reviewer')));

CREATE POLICY "project create" ON architecture_projects
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('architect','reviewer','admin','superadmin')) AND initiative_ids IS NOT NULL AND array_length(initiative_ids, 1) > 0);

-- engagements (office_engagements)
CREATE POLICY "engagement read" ON office_engagements
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by_id OR project_id IN (SELECT id FROM architecture_projects WHERE owner_id = auth.uid()) OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin','reviewer')));

-- artifacts
CREATE POLICY "artifact read" ON artifacts
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM architecture_projects WHERE owner_id = auth.uid() OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin','reviewer'))));

CREATE POLICY "artifact write" ON artifacts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM architecture_projects p WHERE p.id = project_id AND p.owner_id = auth.uid()) OR EXISTS (SELECT 1 FROM office_engagements e WHERE e.project_id = project_id AND e.charter->'deliverables' @> jsonb_build_array(jsonb_build_object('assigneeId', auth.uid()))) OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin')));
```

### 5.2 RPC para operaciones sensibles (backend confiable)

| Operación | RPC | Validaciones servidor |
| --- | --- | --- |
| `provisionUser` | `provision_user(email, role, initiated_by)` | `initiated_by` tiene `users:provision`; `role ≠ admin/superadmin` salvo superadmin; crea en `auth.users` + perfil en txn |
| `decideEngagement` | `decide_engagement(engagement_id, verdict, rationale, actor_id)` | `actor_id` tiene `deliverables:arb-decide` en ese encargo; `verdict ∈ {approved, changes-requested, rejected}`; si `approved` → `status = delivered`, inmutable |
| `provisionProject` | (no existe; proyecto se crea via factory) | `createArchitectureProject` valida `initiativeIds` en txn |
| `revokeSession` | `revoke_user_sessions(uid, requested_by)` | `requested_by` admin/superadmin; invalida `auth.sessions` |
| `rotateKeys` | `rotate_ai_keys(provider, new_key, requested_by)` | `requested_by` superadmin; actualiza `vault.secrets` |

## 6. Pruebas de paridad y negativas (F4/F7)

### 6.1 Paridad cliente/servidor
- `__tests__/authz/rulesMatrix.test.ts`: compara `PERMISSION_MATRIX` con `firestore.rules` (hoy) / RLS (Supabase).
- Cada permiso probado con `can(profile, perm, scope)` para cada rol y cada ámbito válido/inválido.

### 6.2 Pruebas negativas (deben fallar)
| Caso | Permiso | Scope | Esperado |
| --- | --- | --- | --- |
| Anónimo intenta leer iniciativas | `initiatives:read` | org | `false` |
| Viewer crea proyecto | `projects:create` | iniciativa | `false` |
| Architect aprueba charter | `deliverables:approve-charter` | encargo | `false` |
| Reviewer se asigna a revisar su propio entregable | `deliverables:write` | encargo (assignee=reviewer) | `false` (validación planner) |
| Admin elimina su propio perfil superadmin | `users:delete` | user (own, role=superadmin) | `false` |
| Usuario provisionado con `admin` por actor sin `users:provision` | `users:provision` | org | `false` |
| JWT válido sin perfil en BD accede a `ai:generate` | `ai:generate` | — | `false` (requiere membresía) |
| Token expirado / revocado accede a `projects:read` | `projects:read` | proyecto | `false` (validación `session_id`) |

## 7. Migración a Supabase (resumen F2/F4)

| Firebase actual | Supabase objetivo |
| --- | --- |
| `firestore.rules` (DSL) | RLS policies + RPC (SQL/TypeScript) |
| Custom claims (`admin`, `superadmin`) | `app_metadata` en `auth.users` + tabla `user_roles` |
| `auth.uid()` en rules | `auth.uid()` en RLS (igual) |
| `auth.token.email_verified` | `auth.email_verified` claim |
| Secondary app para `createUser` | `supabase.auth.admin.createUser` (service role, solo RPC) |
| Session cookies (Firebase) | Supabase Auth session (JWT + refresh token, httpOnly cookie) |

**No se usan `user_metadata` para autorización** (editable por usuario). Roles/permisos en `app_metadata` / tabla dedicada.