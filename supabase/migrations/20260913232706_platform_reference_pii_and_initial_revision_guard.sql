-- F5 reparación aditiva: datos de referencia no admiten PII y la primera
-- escritura exige explícitamente revisión esperada 0. No modifica la fila ya
-- cargada: fue revalidada por ETL antes de aplicar esta migración.
begin;

create or replace function private.contains_platform_pii(p_value jsonb)
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
        if normalized_key in ('email', 'mail', 'phone', 'telephone', 'address', 'fullname', 'firstname', 'lastname')
          or private.contains_platform_pii(entry.value) then
          return true;
        end if;
      end loop;
    when 'array' then
      for entry in select value from jsonb_array_elements(p_value) loop
        if private.contains_platform_pii(entry.value) then
          return true;
        end if;
      end loop;
    when 'string' then
      text_value := p_value #>> '{}';
      return text_value ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
        or text_value ~ '(^|[^[:alnum:]])[+]?([0-9][ .()-]?){7,}[0-9]([^[:alnum:]]|$)';
    else
      return false;
  end case;
  return false;
end;
$$;
comment on function private.contains_platform_pii(jsonb) is
  'Detecta PII no autorizada para el singleton global de parámetros de referencia.';

alter table api.platform_reference_parameters
  add constraint platform_reference_parameters_no_pii
  check (not private.contains_platform_pii(data));

create or replace function api.save_platform_reference_parameters(p_data jsonb, p_expected_revision bigint)
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
  if private.contains_platform_pii(p_data) then
    raise exception 'Los parámetros globales no pueden contener datos personales' using errcode = '22023';
  end if;
  if not exists (select 1 from api.platform_reference_parameters where key = 'global')
    and p_expected_revision is distinct from 0 then
    raise exception 'Conflicto de parámetros globales: recarga antes de guardar' using errcode = 'P0001';
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

revoke all on function private.contains_platform_pii(jsonb) from public, anon, authenticated, service_role;
revoke all on function api.save_platform_reference_parameters(jsonb, bigint) from public, anon, authenticated, service_role;
grant execute on function api.save_platform_reference_parameters(jsonb, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
