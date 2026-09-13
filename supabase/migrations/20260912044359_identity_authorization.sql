-- F4.2 — Fundación de autorización: roles y permisos como datos.
--
-- Decisión de diseño documentada (single-tenant, sin organizationId):
-- la matriz de permisos vive en SQL y la interfaz la refleja, no la impone.
-- El cliente nunca muta rol ni estado: lee su perfil y actualiza su nombre;
-- todo lo demás pasa por RPC que valida permiso y deja auditoría.
--
-- NOTA DE SEGURIDAD IMPORTANTE (por qué esta tabla NO lleva FORCE RLS):
-- `private.current_role()` es SECURITY DEFINER y lee `api.user_profiles`. Con
-- `force row level security`, el propietario también queda sujeto a las
-- políticas; la política de lectura llama al helper, y el helper reentraría en
-- la política: "infinite recursion detected in policy". Se activa RLS y se
-- protege por privilegios (revoke por defecto + grants explícitos) más las
-- políticas que sí aplican a `authenticated`. El propietario no es un cliente.
begin;

-- ---------------------------------------------------------------- perfiles
create table api.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table api.user_profiles is
  'Perfil y rol por usuario. El rol nunca se lee de user_metadata; el cliente solo lee y edita su nombre.';
create index user_profiles_role_idx on api.user_profiles(role);

alter table api.user_profiles enable row level security;

-- ------------------------------------------------- matriz de permisos (datos)
create table private.role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);
comment on table private.role_permissions is
  'Espejo en SQL de ROLE_PERMISSIONS (lib/authz/permissions.ts). Una prueba de paridad compara ambos.';

insert into private.role_permissions (role, permission) values
  -- viewer
  ('viewer', 'portfolio:read'),
  ('viewer', 'training:consume'),
  ('viewer', 'settings:manage'),
  -- architect
  ('architect', 'portfolio:read'),
  ('architect', 'initiative:write'),
  ('architect', 'project:write'),
  ('architect', 'deliverable:write'),
  ('architect', 'deliverable:run'),
  ('architect', 'artifact:write'),
  ('architect', 'training:consume'),
  ('architect', 'settings:manage'),
  -- reviewer
  ('reviewer', 'portfolio:read'),
  ('reviewer', 'initiative:write'),
  ('reviewer', 'project:write'),
  ('reviewer', 'deliverable:write'),
  ('reviewer', 'deliverable:run'),
  ('reviewer', 'artifact:write'),
  ('reviewer', 'charter:approve'),
  ('reviewer', 'arb:decide'),
  ('reviewer', 'publication:publish'),
  ('reviewer', 'training:consume'),
  ('reviewer', 'training:analytics'),
  ('reviewer', 'settings:manage'),
  -- trainer
  ('trainer', 'portfolio:read'),
  ('trainer', 'training:consume'),
  ('trainer', 'training:author'),
  ('trainer', 'training:analytics'),
  ('trainer', 'settings:manage'),
  -- admin
  ('admin', 'portfolio:read'),
  ('admin', 'initiative:write'),
  ('admin', 'project:write'),
  ('admin', 'deliverable:write'),
  ('admin', 'deliverable:run'),
  ('admin', 'artifact:write'),
  ('admin', 'charter:approve'),
  ('admin', 'arb:decide'),
  ('admin', 'publication:publish'),
  ('admin', 'training:consume'),
  ('admin', 'training:author'),
  ('admin', 'training:analytics'),
  ('admin', 'users:read'),
  ('admin', 'users:create'),
  ('admin', 'users:update'),
  ('admin', 'users:delete'),
  ('admin', 'settings:manage'),
  -- superadmin
  ('superadmin', 'portfolio:read'),
  ('superadmin', 'initiative:write'),
  ('superadmin', 'project:write'),
  ('superadmin', 'deliverable:write'),
  ('superadmin', 'deliverable:run'),
  ('superadmin', 'artifact:write'),
  ('superadmin', 'charter:approve'),
  ('superadmin', 'arb:decide'),
  ('superadmin', 'publication:publish'),
  ('superadmin', 'training:consume'),
  ('superadmin', 'training:author'),
  ('superadmin', 'training:analytics'),
  ('superadmin', 'users:read'),
  ('superadmin', 'users:create'),
  ('superadmin', 'users:update'),
  ('superadmin', 'users:delete'),
  ('superadmin', 'users:grant-privileged'),
  ('superadmin', 'settings:manage');

-- --------------------------------------------------------------- auditoría
create table private.authorization_audit (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null,
  target_id uuid not null,
  action text not null check (action in ('provision', 'set-role', 'set-status', 'delete')),
  from_role text,
  to_role text
);
comment on table private.authorization_audit is
  'Auditoría de cambios de autorización: quién, sobre quién, qué acción y transición de rol. Sin datos personales.';
alter table private.authorization_audit enable row level security;
alter table private.authorization_audit force row level security;

-- ------------------------------------------------------------------ helpers
-- Lectura del rol efectivo. Falla cerrado: sin perfil, inactivo o rol
-- desconocido devuelven NULL, y NULL no concede nada.
create function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role
  from api.user_profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;
comment on function private.current_role() is
  'Rol efectivo del llamante: perfil activo del usuario del JWT. NULL si no hay perfil o está deshabilitado.';

create function private.has_permission(required text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from private.role_permissions rp
    where rp.role = private.current_role() and rp.permission = required
  )
$$;
comment on function private.has_permission(text) is
  '¿El llamante tiene este permiso? Falla cerrado ante rol ausente o desconocido.';

-- El rol no puede leerse de user_metadata: es editable por el usuario.
create function private.assert_role_is_not_self(target uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if target = auth.uid() then
    raise exception 'Nadie cambia su propio rol' using errcode = '42501';
  end if;
end;
$$;

create function private.touch_user_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_user_profiles
  before update on api.user_profiles
  for each row execute function private.touch_user_profiles();

-- ---------------------------------------------------------------- políticas
create policy profiles_select_own on api.user_profiles for select
  to authenticated using (id = (select auth.uid()) and status = 'active');
create policy profiles_select_directory on api.user_profiles for select
  to authenticated using (private.has_permission('users:read'));
-- Un usuario puede cambiar su nombre, no su rol: el `with check` no menciona
-- role/status y los grants de columna de más abajo limitan lo escribible.
create policy profiles_update_own_name on api.user_profiles for update
  to authenticated using (id = (select auth.uid()) and status = 'active')
  with check (id = (select auth.uid()) and status = 'active');

-- ------------------------------------------------------------------- RPCs
create function api.provision_user_profile(
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

create function api.set_user_role(target uuid, new_role text) returns void
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

create function api.set_user_status(target uuid, new_status text) returns void
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

create function api.delete_user_profile(target uuid) returns void
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
  perform private.assert_role_is_not_self(target);

  delete from api.user_profiles where id = target;
  if not found then
    raise exception 'El perfil no existe' using errcode = 'P0002';
  end if;

  insert into private.authorization_audit (actor_id, target_id, action)
  values (actor, target, 'delete');
end;
$$;

-- ------------------------------------------------------------- privilegios
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

grant select on api.user_profiles to authenticated;
-- Solo el nombre es escribible directamente; rol y estado pasan por RPC.
grant update (display_name) on api.user_profiles to authenticated;

grant execute on function private.current_role() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function api.provision_user_profile(uuid, text, text) to authenticated;
grant execute on function api.set_user_role(uuid, text) to authenticated;
grant execute on function api.set_user_status(uuid, text) to authenticated;
grant execute on function api.delete_user_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
