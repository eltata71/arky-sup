# F1.5 — Modelo PostgreSQL (Supabase) por contexto

Base: `docs/fase-1/mapa-contextos.md`, `docs/fase-1/agregados-invariantes-eventos.md`, `docs/fase-1/modelo-autorizacion.md`.
Convenciones: `snake_case` tablas/columnas, PK `uuid` gen_random_uuid(), `created_at`/`updated_at` `timestamptz` con `now()`, FK explícitas, RLS habilitada en todas las tablas expuestas, triggers de `updated_at`.

## 1. Identidad y Acceso

```sql
-- Esquema: auth (gestionado por Supabase Auth) + public.perfiles
-- Supabase Auth maneja auth.users, auth.identities, auth.sessions, auth.mfa_*
-- Perfil extendido en public.user_profiles

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role public.auth_role NOT NULL DEFAULT 'viewer',  -- enum auth_role
  organization_id uuid,  -- future multi-tenant
  email_verified boolean NOT NULL DEFAULT false,
  avatar_url text,
  locale text NOT NULL DEFAULT 'es',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_user_profiles_org ON public.user_profiles(organization_id);
CREATE INDEX idx_user_profiles_role ON public.user_profiles(role);

-- Enum roles (mirror de lib/authz/permissions.ts)
CREATE TYPE public.auth_role AS ENUM (
  'viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin'
);

-- Tabla de membresías para multi-tenencia futura
CREATE TABLE public.user_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  role public.auth_role NOT NULL DEFAULT 'viewer',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

-- Invitation tokens (provisioning)
CREATE TABLE public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.auth_role NOT NULL DEFAULT 'viewer',
  organization_id uuid,
  invited_by uuid NOT NULL REFERENCES public.user_profiles(id),
  token_hash text NOT NULL,  -- hash del token enviado por email
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_token ON public.user_invitations(token_hash);
CREATE INDEX idx_invitations_email ON public.user_invitations(email);

-- Outbox para eventos de dominio
CREATE TABLE public.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  retry_count int NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX idx_outbox_pending ON public.outbox_events(processed_at) WHERE processed_at IS NULL;
```

## 2. Iniciativas y Portafolio

```sql
-- Esquema: public (o schema initiatives si se prefiere aislamiento)

CREATE TABLE public.business_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,  -- NEG-YYYY-NNN, validado por CHECK
  title text NOT NULL,
  description text,
  driver text NOT NULL,  -- business driver
  objectives text[] NOT NULL DEFAULT '{}',
  outcomes text[] NOT NULL DEFAULT '{}',
  kpis jsonb NOT NULL DEFAULT '[]',  -- [{name, target, unit, current}]
  risks jsonb NOT NULL DEFAULT '[]', -- [{id, description, level, mitigation}]
  stakeholders jsonb NOT NULL DEFAULT '[]', -- [{id, name, role, contact}]
  linked_project_ids uuid[] NOT NULL DEFAULT '{}',
  status public.initiative_status NOT NULL DEFAULT 'draft',
  owner_id uuid NOT NULL REFERENCES public.user_profiles(id),
  organization_id uuid,
  started_at timestamptz,
  target_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TYPE public.initiative_status AS ENUM ('draft', 'active', 'on-hold', 'completed', 'cancelled');

CREATE INDEX idx_initiatives_code ON public.business_initiatives(code);
CREATE INDEX idx_initiatives_owner ON public.business_initiatives(owner_id);
CREATE INDEX idx_initiatives_status ON public.business_initiatives(status);
CREATE INDEX idx_initiatives_linked_projects ON public.business_initiatives USING GIN (linked_project_ids);

-- CHECK para formato de código
ALTER TABLE public.business_initiatives
  ADD CONSTRAINT chk_initiative_code_format
  CHECK (code ~ '^NEG-\d{4}-\d{3}$');

-- Documentos adjuntos a la iniciativa
CREATE TABLE public.initiative_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES public.business_initiatives(id) ON DELETE CASCADE,
  title text NOT NULL,
  storage_path text NOT NULL,  -- Supabase Storage path
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_initiative_docs_initiative ON public.initiative_documents(initiative_id);
```

## 3. Proyectos y Atenciones

```sql
CREATE TABLE public.architecture_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  initiative_ids uuid[] NOT NULL DEFAULT '{}',  -- FK lógica a business_initiatives
  owner_id uuid NOT NULL REFERENCES public.user_profiles(id),
  status public.project_status NOT NULL DEFAULT 'active',
  priority public.project_priority NOT NULL DEFAULT 'medium',
  artifact_index jsonb NOT NULL DEFAULT '[]',  -- [{artifactId, versionGroupId, type, title, updatedAt}]
  artifact_count int NOT NULL DEFAULT 0,
  risk_level public.risk_level,
  health_score int,  -- 0-100
  progress_ratio numeric(4,3),  -- 0.000-1.000
  started_at timestamptz,
  target_date timestamptz,
  organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TYPE public.project_status AS ENUM ('active', 'on-hold', 'completed', 'archived');
CREATE TYPE public.project_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.risk_level AS ENUM ('low', 'medium', 'high', 'critical');

CREATE INDEX idx_projects_initiatives ON public.architecture_projects USING GIN (initiative_ids);
CREATE INDEX idx_projects_owner ON public.architecture_projects(owner_id);
CREATE INDEX idx_projects_status ON public.architecture_projects(status);

-- Hitos del proyecto
CREATE TABLE public.project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.architecture_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_at timestamptz,
  status public.milestone_status NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.milestone_status AS ENUM ('pending', 'in-progress', 'completed', 'at-risk', 'missed');

CREATE INDEX idx_milestones_project ON public.project_milestones(project_id);

-- Riesgos del proyecto
CREATE TABLE public.project_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.architecture_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  level public.risk_level NOT NULL,
  mitigation text,
  owner_id uuid REFERENCES public.user_profiles(id),
  identified_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_risks_project ON public.project_risks(project_id);
```

## 4. Encargos y Gobernanza ARB

```sql
-- Esquema: office (aislamiento fuerte recomendado)

CREATE SCHEMA IF NOT EXISTS office;

CREATE TYPE office.engagement_status AS ENUM (
  'intake', 'planning', 'awaiting-charter', 'in-progress',
  'awaiting-arb', 'delivered', 'blocked', 'cancelled'
);

CREATE TYPE office.engagement_kind AS ENUM (
  'new-solution', 'modernization', 'integration', 'assessment', 'compliance-review'
);

CREATE TYPE office.task_status AS ENUM (
  'pending', 'ready', 'in-progress', 'awaiting-review',
  'changes-requested', 'completed', 'failed', 'skipped', 'cancelled'
);

CREATE TYPE office.task_kind AS ENUM ('produce-artifact', 'review-artifact', 'consolidate', 'report');

CREATE TYPE office.arb_verdict AS ENUM ('approved', 'changes-requested', 'rejected');

CREATE TABLE office.engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.architecture_projects(id),
  title text NOT NULL,
  brief text NOT NULL,
  initiative_ids uuid[] NOT NULL DEFAULT '{}',
  business_project_codes text[] NOT NULL DEFAULT '{}',  -- mirror NEG- codes
  status office.engagement_status NOT NULL DEFAULT 'intake',
  priority public.project_priority NOT NULL DEFAULT 'medium',
  due_at timestamptz,
  charter jsonb NOT NULL DEFAULT '{}',  -- OfficeCharter completo
  tasks jsonb NOT NULL DEFAULT '[]',    -- OfficeTask[]
  gate_assessment jsonb,
  arb_decisions jsonb NOT NULL DEFAULT '[]',
  budget jsonb NOT NULL DEFAULT '{"maxAiCalls":40,"consumedAiCalls":0}',
  current_run_id uuid,
  audit_trail jsonb NOT NULL DEFAULT '[]',
  created_by jsonb NOT NULL,  -- OfficeActor
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_engagements_project ON office.engagements(project_id);
CREATE INDEX idx_engagements_status ON office.engagements(status);
CREATE INDEX idx_engagements_initiatives ON office.engagements USING GIN (initiative_ids);

-- Decisiones ARB (también en engagement.arb_decisions, tabla para consultas e integridad)
CREATE TABLE office.arb_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES office.engagements(id) ON DELETE CASCADE,
  verdict office.arb_verdict NOT NULL,
  rationale text NOT NULL,
  actor jsonb NOT NULL,  -- OfficeActor
  gate_status_at_decision text,
  previous_status office.engagement_status,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_arb_decisions_engagement ON office.arb_decisions(engagement_id);
```

## 5. Artefactos y Publicación

```sql
-- Esquema: artifacts (aislamiento)

CREATE SCHEMA IF NOT EXISTS artifacts;

CREATE TYPE artifacts.artifact_type AS ENUM (
  'markdown', 'hybrid-text-diagram', 'mermaid-c4-context', 'mermaid-c4-container',
  'mermaid-c4-component', 'mermaid-graph', 'mermaid-sequence', 'react-flow-graph',
  'sdd-brd', 'sdd-use-case', 'sdd-user-story', 'sdd-domain-model',
  'sdd-event-storming', 'sdd-glossary', 'sdd-nfr', 'sdd-bdd',
  'sdd-traceability', 'pdf', 'pptx', 'docx', 'xlsx', 'html', 'csv', 'json', 'txt',
  'mermaid-diagram', 'excalidraw', 'lucid-diagram', 'image'
);

CREATE TABLE artifacts.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_group_id uuid NOT NULL,  -- inmutable tras creación
  version_number int NOT NULL DEFAULT 1,
  project_id uuid NOT NULL REFERENCES public.architecture_projects(id),
  engagement_id uuid REFERENCES office.engagements(id),
  deliverable_template_name text,  -- vínculo a charter
  artifact_type artifacts.artifact_type NOT NULL,
  title text NOT NULL,
  content jsonb NOT NULL,  -- contenido estructurado según tipo
  markdown_content text,   -- versión renderizable
  status public.artifact_status NOT NULL DEFAULT 'draft',
  author_id uuid NOT NULL REFERENCES public.user_profiles(id),
  reviewer_id uuid REFERENCES public.user_profiles(id),
  quality_gate_status jsonb,  -- resultados de quality gates
  expected_updated_at timestamptz,  -- concurrencia optimista
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (version_group_id, version_number)
);

CREATE TYPE public.artifact_status AS ENUM ('draft', 'in-review', 'approved', 'published', 'archived');

CREATE INDEX idx_artifacts_vg ON artifacts.artifacts(version_group_id);
CREATE INDEX idx_artifacts_project ON artifacts.artifacts(project_id);
CREATE INDEX idx_artifacts_engagement ON artifacts.artifacts(engagement_id);
CREATE INDEX idx_artifacts_author ON artifacts.artifacts(author_id);
CREATE INDEX idx_artifacts_status ON artifacts.artifacts(status);

-- Exportaciones generadas
CREATE TABLE artifacts.exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts.artifacts(id),
  format text NOT NULL,  -- pdf, pptx, html, ...
  storage_path text NOT NULL,
  file_size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  generated_by uuid NOT NULL REFERENCES public.user_profiles(id),
  expires_at timestamptz,  -- para descargas temporales
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_exports_artifact ON artifacts.exports(artifact_id);
```

## 6. Conocimiento Arquitectónico

```sql
-- Esquema: knowledge

CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE knowledge.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,  -- component, system, interface, capability, ...
  name text NOT NULL,
  description text,
  properties jsonb NOT NULL DEFAULT '{}',
  source_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  freshness_score numeric(4,3) NOT NULL DEFAULT 1.000,
  last_extracted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, name)
);

CREATE INDEX idx_entities_type ON knowledge.entities(type);
CREATE INDEX idx_entities_freshness ON knowledge.entities(freshness_score);

CREATE TABLE knowledge.relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  relation_type text NOT NULL,  -- depends_on, implements, contains, ...
  properties jsonb NOT NULL DEFAULT '{}',
  confidence numeric(3,2) NOT NULL DEFAULT 1.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_entity_id, target_entity_id, relation_type)
);

CREATE INDEX idx_relations_source ON knowledge.relations(source_entity_id);
CREATE INDEX idx_relations_target ON knowledge.relations(target_entity_id);
```

## 7. Aprendizaje

```sql
-- Esquema: learning

CREATE SCHEMA IF NOT EXISTS learning;

CREATE TABLE learning.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  language text NOT NULL DEFAULT 'es',
  trainer_id uuid NOT NULL REFERENCES public.user_profiles(id),
  status public.course_status NOT NULL DEFAULT 'draft',
  module_ids uuid[] NOT NULL DEFAULT '{}',
  organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TYPE public.course_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE learning.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES learning.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  order_index int NOT NULL,
  lesson_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_modules_course ON learning.modules(course_id);

CREATE TABLE learning.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES learning.modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  content jsonb NOT NULL,  -- rich text / markdown / video refs
  duration_minutes int,
  order_index int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lessons_module ON learning.lessons(module_id);

-- Progreso del usuario
CREATE TABLE learning.user_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  course_id uuid NOT NULL REFERENCES learning.courses(id),
  module_id uuid REFERENCES learning.modules(id),
  lesson_id uuid REFERENCES learning.lessons(id),
  status public.lesson_status NOT NULL DEFAULT 'not-started',
  completed_at timestamptz,
  score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE TYPE public.lesson_status AS ENUM ('not-started', 'in-progress', 'completed');

CREATE INDEX idx_progress_user ON learning.user_progress(user_id);
CREATE INDEX idx_progress_course ON learning.user_progress(course_id);
```

## 8. Capacidades de soporte (tablas técnicas)

```sql
-- Configuración de IA por organización/usuario
CREATE TABLE public.ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('organization', 'user')),
  scope_id uuid NOT NULL,  -- org_id o user_id
  provider text NOT NULL,  -- 'gemini', 'openrouter', 'anthropic', ...
  model text NOT NULL,
  api_key_encrypted text,  -- cifrado con vault, solo para BYOK org
  max_output_tokens int,
  temperature numeric(3,2),
  refinement_enabled boolean NOT NULL DEFAULT false,
  refinement_max_passes int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id)
);

-- Settings de usuario (preferencias UI)
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  language text NOT NULL DEFAULT 'es',
  diagram_pipeline text NOT NULL DEFAULT 'canonical',
  notifications jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auditoría de accesos sensibles
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor ON public.audit_log(actor_id);
CREATE INDEX idx_audit_resource ON public.audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);
```

## 9. Triggers y funciones auxiliares

```sql
-- Trigger genérico updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Aplicar a todas las tablas con updated_at
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_%'
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trigger_updated_at ON public.%I;
      CREATE TRIGGER trigger_updated_at
      BEFORE UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t, t);
  END LOOP;
END $$;

-- Función para concurrencia optimista en artefactos
CREATE OR REPLACE FUNCTION artifacts.check_and_update_expected()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.expected_updated_at IS NOT NULL AND NEW.expected_updated_at IS NOT NULL THEN
    IF OLD.updated_at != OLD.expected_updated_at THEN
      RAISE EXCEPTION 'CONCURRENT_MODIFICATION: artifact % was modified by another transaction', OLD.id
        USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_optimistic_lock
BEFORE UPDATE ON artifacts.artifacts
FOR EACH ROW EXECUTE FUNCTION artifacts.check_and_update_expected();

-- Función helper para RLS: usuario tiene rol en organización
CREATE OR REPLACE FUNCTION public.user_has_role(target_role public.auth_role, org_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    LEFT JOIN public.user_memberships um ON um.user_id = up.id
    WHERE up.id = auth.uid()
      AND (org_id IS NULL OR um.organization_id = org_id)
      AND (
        up.role = target_role
        OR (target_role = 'admin' AND up.role IN ('admin','superadmin'))
        OR (target_role = 'superadmin' AND up.role = 'superadmin')
        OR (target_role = 'reviewer' AND up.role IN ('reviewer','admin','superadmin'))
        OR (target_role = 'architect' AND up.role IN ('architect','reviewer','admin','superadmin'))
        OR (target_role = 'trainer' AND up.role IN ('trainer','admin','superadmin'))
        OR (target_role = 'viewer')
      )
  );
$$;
```

## 10. Migración de datos (estrategia)

| Colección Firebase | Tabla PostgreSQL | Estrategia |
| --- | --- | --- |
| `users/{uid}` | `public.user_profiles` | Export → transform (role mapping) → upsert por PK |
| `businessInitiatives/{id}` | `public.business_initiatives` | Export → validar `code` único → insert con `ON CONFLICT DO UPDATE` |
| `projects/{id}` | `public.architecture_projects` | Export → validar `initiative_ids` existen → insert |
| `engagements/{id}` | `office.engagements` | Export → validar `project_id` y `initiative_ids` → insert |
| `artifacts/{id}` | `artifacts.artifacts` | Export por `version_group_id` → agrupar versiones → insert ordenado |
| `agent_actions/{traceId}` | (no se migra; solo observabilidad histórica) | Opcional: export a JSONL en Storage para análisis |
| `courses/`, `training/*` | `learning.*` | Export jerárquico course→module→lesson → insert en orden |
| `architectureKnowledge/*` | `knowledge.*` | Export entities + relations → upsert con `ON CONFLICT (type,name)` |

**Idempotencia**: cada migración usa `INSERT ... ON CONFLICT (pk) DO UPDATE SET ... WHERE excluded.updated_at > target.updated_at` (o comparable). Checkpoints por lote de 500-1000 registros. Manifiesto JSON con conteos, checksums y errores por colección.