-- F4.6 — Guarda de sesión para operaciones sensibles.
--
-- ADR-004 pide que la revocación sea real y no una promesa del cliente. En
-- Supabase Auth una sesión revocada **deja de existir** en `auth.sessions` (no
-- hay columna `revoked`: la fila se borra), y `not_after` marca un techo de uso.
-- Esta guarda comprueba las dos cosas contra el servidor, de modo que un token
-- válido de una sesión ya cerrada no sirve para cambiar roles.
--
-- Falla cerrado: sin `session_id` en el token, sin fila de sesión, con usuario
-- distinto o pasada la fecha techo, la operación se rechaza. Un llamante que no
-- puede demostrar que su sesión sigue viva no ejecuta operaciones de
-- autorización.
begin;

create function private.current_session_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id',
    ''
  )::uuid
$$;
comment on function private.current_session_id() is
  'Identificador de sesión del token. NULL cuando el token no lo declara: no se sustituye por el uid.';

create function private.is_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id = private.current_session_id()
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  )
$$;
comment on function private.is_session_active() is
  '¿La sesión del token sigue viva y pertenece a este usuario? Revocada = fila ausente en auth.sessions.';

create function private.assert_session_active() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_session_active() then
    raise exception 'La sesión no está activa: vuelva a iniciar sesión'
      using errcode = '42501';
  end if;
end;
$$;

-- ------------------------------------------------------- RPCs con la guarda
-- Se recrean las cuatro operaciones sensibles añadiendo la comprobación de
-- sesión tras la de permiso. Los grants ya existentes se conservan al recrear
-- la misma firma.
create or replace function api.provision_user_profile(
  target uuid,
  target_role text,
  target_name text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:create') then
    raise exception 'Permiso insuficiente: users:create' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if target_role in ('admin', 'superadmin')
     and not private.has_permission('users:grant-privileged') then
    raise exception 'Solo superadmin concede roles administrativos' using errcode = '42501';
  end if;
  if target_role not in ('viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin') then
    raise exception 'Rol desconocido: %', target_role using errcode = '22023';
  end if;

  insert into api.user_profiles (id, role, display_name)
  values (target, target_role, target_name)
  on conflict (id) do nothing;

  if not found then
    raise exception 'El perfil ya existe' using errcode = '23505';
  end if;

  insert into private.authorization_audit (actor_id, target_id, action, to_role)
  values (actor, target, 'provision', target_role);
end;
$$;

create or replace function api.set_user_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous text;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:update') then
    raise exception 'Permiso insuficiente: users:update' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  perform private.assert_role_is_not_self(target);
  if new_role in ('admin', 'superadmin')
     and not private.has_permission('users:grant-privileged') then
    raise exception 'Solo superadmin concede roles administrativos' using errcode = '42501';
  end if;
  if new_role not in ('viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin') then
    raise exception 'Rol desconocido: %', new_role using errcode = '22023';
  end if;

  select role into previous from api.user_profiles where id = target for update;
  if previous is null then
    raise exception 'El perfil no existe' using errcode = 'P0002';
  end if;

  update api.user_profiles set role = new_role where id = target;

  insert into private.authorization_audit (actor_id, target_id, action, from_role, to_role)
  values (actor, target, 'set-role', previous, new_role);
end;
$$;

create or replace function api.set_user_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:update') then
    raise exception 'Permiso insuficiente: users:update' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  perform private.assert_role_is_not_self(target);
  if new_status not in ('active', 'disabled') then
    raise exception 'Estado desconocido: %', new_status using errcode = '22023';
  end if;

  update api.user_profiles set status = new_status where id = target;
  if not found then
    raise exception 'El perfil no existe' using errcode = 'P0002';
  end if;

  insert into private.authorization_audit (actor_id, target_id, action)
  values (actor, target, 'set-status');
end;
$$;

create or replace function api.delete_user_profile(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:delete') then
    raise exception 'Permiso insuficiente: users:delete' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  perform private.assert_role_is_not_self(target);

  delete from api.user_profiles where id = target;
  if not found then
    raise exception 'El perfil no existe' using errcode = 'P0002';
  end if;

  insert into private.authorization_audit (actor_id, target_id, action)
  values (actor, target, 'delete');
end;
$$;

revoke all on function private.current_session_id() from public, anon, authenticated, service_role;
revoke all on function private.is_session_active() from public, anon, authenticated, service_role;
revoke all on function private.assert_session_active() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
