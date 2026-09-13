-- F5.2 — Piloto vertical: preferencias no sensibles por usuario.
--
-- Solo existe una fila por identidad Supabase. No se migra `settings/global`
-- (carece de propietario) ni una clave BYOK: estas claves permanecen locales.
begin;

create table api.user_settings (
  id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_is_object check (jsonb_typeof(settings) = 'object'),
  constraint user_settings_has_no_provider_key check (
    not jsonb_path_exists(settings, '$.**.apiKey')
  )
);
comment on table api.user_settings is
  'Preferencias no sensibles del propietario. La clave BYOK nunca se persiste: queda en localStorage.';

alter table api.user_settings enable row level security;

create policy user_settings_select_own on api.user_settings for select
  to authenticated using (id = (select auth.uid()));

create function api.save_user_settings(p_settings jsonb, p_expected_revision bigint)
returns api.user_settings
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.user_settings;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('settings:manage') then
    raise exception 'Permiso insuficiente: settings:manage' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_settings) <> 'object' then
    raise exception 'La configuración debe ser un objeto' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_settings, '$.**.apiKey') then
    raise exception 'La configuración no puede contener claves de proveedor' using errcode = '22023';
  end if;

  insert into api.user_settings as target (id, settings, revision)
  values (actor, p_settings, 1)
  on conflict (id) do update
    set settings = excluded.settings,
        revision = target.revision + 1,
        updated_at = now()
    where target.revision = p_expected_revision
  returning target.* into saved;

  if not found then
    raise exception 'Conflicto de configuración: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.save_user_settings(jsonb, bigint) is
  'Guarda preferencias del auth.uid con concurrencia optimista y sesión activa. No acepta claves BYOK.';

revoke all on table api.user_settings from public, anon, authenticated, service_role;
revoke all on function api.save_user_settings(jsonb, bigint) from public, anon, authenticated, service_role;
grant select on api.user_settings to authenticated;
grant execute on function api.save_user_settings(jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
