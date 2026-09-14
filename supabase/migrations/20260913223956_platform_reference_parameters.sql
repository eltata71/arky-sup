-- F5 — Parámetros globales de referencia que apoyan la creación asistida.
--
-- Este corte conserva únicamente `settings/global` de Firestore. No contiene
-- proyectos, artefactos, cursos ni preferencias de personas. La lectura y
-- escritura se mantienen limitadas a administración, igual que las reglas
-- heredadas de `settings/global`.
begin;

-- El filtro se aplica tanto al valor como a los nombres de propiedad. Así no
-- depende de que una exportación heredada nombre su credencial `apiKey`.
create function private.contains_platform_secret(p_value jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  entry record;
  text_value text;
  normalized_key text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      for entry in select key, value from jsonb_each(p_value) loop
        normalized_key := lower(replace(replace(entry.key, '_', ''), '-', ''));
        if normalized_key in ('apikey', 'clientsecret', 'secret', 'token', 'credential', 'password')
          or private.contains_platform_secret(entry.value) then
          return true;
        end if;
      end loop;
    when 'array' then
      for entry in select value from jsonb_array_elements(p_value) loop
        if private.contains_platform_secret(entry.value) then
          return true;
        end if;
      end loop;
    when 'string' then
      text_value := p_value #>> '{}';
      return text_value ~ 'AIza[0-9A-Za-z_-]{35}'
        or text_value ~ 'sk-or-v1-[0-9a-f]{64}'
        or text_value ~ 'sk-ant-[A-Za-z0-9_-]{24,}'
        or text_value ~ 'sk-[A-Za-z0-9]{32,}'
        or text_value ~ '-----BEGIN [A-Z ]*PRIVATE KEY-----';
  end case;
  return false;
end;
$$;
comment on function private.contains_platform_secret(jsonb) is
  'Detecta nombres y formas conocidas de secretos en JSON antes de persistir parámetros de referencia.';

create table api.platform_reference_parameters (
  key text primary key check (key = 'global'),
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_reference_parameters_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint platform_reference_parameters_no_provider_key check (
    not private.contains_platform_secret(data)
  )
);
comment on table api.platform_reference_parameters is
  'Parámetros globales de referencia para creación asistida. Singleton global; sin datos de proyectos, artefactos, cursos ni claves de proveedor.';

alter table api.platform_reference_parameters enable row level security;

create function api.load_platform_reference_parameters()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:read') then
    raise exception 'Permiso insuficiente: users:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select parameters.data into saved
  from api.platform_reference_parameters parameters
  where parameters.key = 'global';
  return saved;
end;
$$;
comment on function api.load_platform_reference_parameters() is
  'Lee el parámetro global únicamente para administración con sesión activa. NULL significa que aún no se cargó el corte.';

create function api.save_platform_reference_parameters(p_data jsonb, p_expected_revision bigint)
returns api.platform_reference_parameters
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.platform_reference_parameters;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:read') then
    raise exception 'Permiso insuficiente: users:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'Los parámetros globales deben ser un objeto' using errcode = '22023';
  end if;
  if private.contains_platform_secret(p_data) then
    raise exception 'Los parámetros globales no pueden contener claves de proveedor' using errcode = '22023';
  end if;

  insert into api.platform_reference_parameters as target (key, data, revision)
  values ('global', p_data, 1)
  on conflict (key) do update
    set data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.revision = p_expected_revision
  returning target.* into saved;

  if not found then
    raise exception 'Conflicto de parámetros globales: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.save_platform_reference_parameters(jsonb, bigint) is
  'Guarda el singleton global con concurrencia optimista, autorización administrativa y sesión activa.';

revoke all on table api.platform_reference_parameters from public, anon, authenticated, service_role;
revoke all on function api.load_platform_reference_parameters() from public, anon, authenticated, service_role;
revoke all on function api.save_platform_reference_parameters(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function private.contains_platform_secret(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.load_platform_reference_parameters() to authenticated;
grant execute on function api.save_platform_reference_parameters(jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
