-- F5 / Corte 6 — Aprendizaje (LMS).
--
-- El LMS usa la matriz F4 vigente: training:consume para progreso, contexto y
-- notas; training:author para cursos; training:analytics para lectura de
-- catálogo transversal. No añade permisos nuevos ni modifica migraciones ya
-- aplicadas.
begin;

create table api.lms_courses (
  id text primary key check (btrim(id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lms_courses_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint lms_courses_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
create index lms_courses_owner_idx on api.lms_courses (owner_id, updated_at desc);
comment on table api.lms_courses is
  'Cursos del Centro de Formación. El autor es el dueño; catálogo transversal solo con training:analytics.';

create table api.lms_progress (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint lms_progress_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint lms_progress_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
comment on table api.lms_progress is
  'Progreso de aprendizaje: un documento por usuario; última escritura confirmada gana.';

create table api.lms_context (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint lms_context_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint lms_context_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
comment on table api.lms_context is
  'Contexto de aprendizaje: un documento por usuario; última escritura confirmada gana.';

create table api.lms_notes (
  id text primary key check (btrim(id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lms_notes_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint lms_notes_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
create index lms_notes_owner_idx on api.lms_notes (owner_id, updated_at desc);
comment on table api.lms_notes is
  'Notas de aprendizaje: una fila por nota; el propietario es la frontera de lectura y escritura.';

alter table api.lms_courses enable row level security;
alter table api.lms_progress enable row level security;
alter table api.lms_context enable row level security;
alter table api.lms_notes enable row level security;

create function api.list_courses(p_include_all boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  rows jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if p_include_all and not private.has_permission('training:analytics') then
    raise exception 'Permiso insuficiente: training:analytics' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'data', data,
    'revision', revision,
    'owner_id', owner_id
  ) order by updated_at desc), '[]'::jsonb)
  into rows
  from api.lms_courses
  where not p_include_all or owner_id = actor;
  return rows;
end;
$$;

create function api.save_course(p_course jsonb, p_expected_revision bigint)
returns api.lms_courses
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  course_key text := btrim(coalesce(p_course ->> 'id', ''));
  saved api.lms_courses;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:author') then
    raise exception 'Permiso insuficiente: training:author' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_course) is distinct from 'object'
    or course_key = ''
    or p_course ->> 'id' <> course_key
    or btrim(coalesce(p_course ->> 'title', '')) = ''
    or btrim(coalesce(p_course ->> 'description', '')) = ''
    or jsonb_path_exists(p_course, '$.**.apiKey') then
    raise exception 'El curso no tiene una forma válida' using errcode = '22023';
  end if;

  insert into api.lms_courses as target (id, owner_id, data, revision)
  values (course_key, actor, p_course || jsonb_build_object('userId', actor::text), 1)
  on conflict (id) do update
    set data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;
  if not found then
    raise exception 'Conflicto de curso: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;

create function api.delete_course(p_course_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:author') then
    raise exception 'Permiso insuficiente: training:author' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.lms_courses
  where id = btrim(coalesce(p_course_id, '')) and owner_id = actor;
  if not found then
    raise exception 'El curso no existe o es ajeno' using errcode = 'P0002';
  end if;
end;
$$;

create function api.save_progress(p_progress jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_progress) is distinct from 'object'
    or jsonb_path_exists(p_progress, '$.**.apiKey') then
    raise exception 'El progreso no tiene una forma válida' using errcode = '22023';
  end if;
  insert into api.lms_progress (owner_id, data, updated_at)
  values (actor, p_progress - 'userId', now())
  on conflict (owner_id) do update
    set data = excluded.data,
        updated_at = now();
end;
$$;

create function api.load_progress()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  row api.lms_progress;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select * into row from api.lms_progress where owner_id = actor;
  if not found then
    raise exception 'El progreso no existe' using errcode = 'P0002';
  end if;
  return row.data || jsonb_build_object('updatedAt', row.updated_at);
end;
$$;

create function api.save_context(p_context jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_context) is distinct from 'object'
    or jsonb_path_exists(p_context, '$.**.apiKey') then
    raise exception 'El contexto no tiene una forma válida' using errcode = '22023';
  end if;
  insert into api.lms_context (owner_id, data, updated_at)
  values (actor, p_context - 'userId', now())
  on conflict (owner_id) do update
    set data = excluded.data,
        updated_at = now();
end;
$$;

create function api.load_context()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  row api.lms_context;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select * into row from api.lms_context where owner_id = actor;
  if not found then
    raise exception 'El contexto no existe' using errcode = 'P0002';
  end if;
  return row.data || jsonb_build_object('updatedAt', row.updated_at);
end;
$$;

create function api.list_notes()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  rows jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(jsonb_build_object('data', data, 'owner_id', owner_id) order by updated_at desc), '[]'::jsonb)
  into rows from api.lms_notes where owner_id = actor;
  return rows;
end;
$$;

create function api.save_note(p_note jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  note_key text := btrim(coalesce(p_note ->> 'id', ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_note) is distinct from 'object'
    or note_key = ''
    or p_note ->> 'id' <> note_key
    or jsonb_path_exists(p_note, '$.**.apiKey') then
    raise exception 'La nota no tiene una forma válida' using errcode = '22023';
  end if;
  insert into api.lms_notes as target (id, owner_id, data)
  values (note_key, actor, p_note || jsonb_build_object('userId', actor::text))
  on conflict (id) do update
    set data = excluded.data,
        updated_at = now()
    where target.owner_id = actor;
  if not found then
    raise exception 'La nota no existe o es ajena' using errcode = 'P0002';
  end if;
end;
$$;

create function api.delete_note(p_note_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('training:consume') then
    raise exception 'Permiso insuficiente: training:consume' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.lms_notes
  where id = btrim(coalesce(p_note_id, '')) and owner_id = actor;
  if not found then
    raise exception 'La nota no existe o es ajena' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on table api.lms_courses from public, anon, authenticated, service_role;
revoke all on table api.lms_progress from public, anon, authenticated, service_role;
revoke all on table api.lms_context from public, anon, authenticated, service_role;
revoke all on table api.lms_notes from public, anon, authenticated, service_role;
revoke all on function api.list_courses(boolean) from public, anon, authenticated, service_role;
revoke all on function api.save_course(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.delete_course(text) from public, anon, authenticated, service_role;
revoke all on function api.save_progress(jsonb) from public, anon, authenticated, service_role;
revoke all on function api.load_progress() from public, anon, authenticated, service_role;
revoke all on function api.save_context(jsonb) from public, anon, authenticated, service_role;
revoke all on function api.load_context() from public, anon, authenticated, service_role;
revoke all on function api.list_notes() from public, anon, authenticated, service_role;
revoke all on function api.save_note(jsonb) from public, anon, authenticated, service_role;
revoke all on function api.delete_note(text) from public, anon, authenticated, service_role;
grant execute on function api.list_courses(boolean) to authenticated;
grant execute on function api.save_course(jsonb, bigint) to authenticated;
grant execute on function api.delete_course(text) to authenticated;
grant execute on function api.save_progress(jsonb) to authenticated;
grant execute on function api.load_progress() to authenticated;
grant execute on function api.save_context(jsonb) to authenticated;
grant execute on function api.load_context() to authenticated;
grant execute on function api.list_notes() to authenticated;
grant execute on function api.save_note(jsonb) to authenticated;
grant execute on function api.delete_note(text) to authenticated;

notify pgrst, 'reload schema';
commit;
