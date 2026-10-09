-- 11.2 — Inventario empresarial (R-17, opción A: POR USUARIO).
--
-- El dueño vive en su propia columna (`owner_id`), no dentro del documento: el
-- día que el alcance sea una organización se añade `organization_id` y se
-- amplía la guarda de lectura; ninguna fila ni RPC existente se reescribe.
-- Reutiliza los permisos `portfolio:read` (leer) y `project:write` (escribir)
-- para no tocar la matriz sembrada en `private.role_permissions`.
begin;

create table api.enterprise_inventory_items (
  id text primary key check (btrim(id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('application', 'capability', 'technology')),
  name text not null check (btrim(name) <> ''),
  normalized_name text not null check (btrim(normalized_name) <> ''),
  lifecycle text not null check (lifecycle in ('candidate', 'active', 'deprecated', 'retired')),
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enterprise_inventory_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint enterprise_inventory_data_has_matching_identity check (
    data ->> 'id' = id and data ->> 'userId' = owner_id::text
  )
);
comment on table api.enterprise_inventory_items is
  'Inventario empresarial por usuario: aplicaciones, capacidades y tecnologías. Los grafos de proyecto lo referencian por id.';
comment on column api.enterprise_inventory_items.data is
  'Elemento InventoryItem completo (alias, descripción, proyectos donde aparece).';

-- Un nombre normalizado por tipo y dueño: la deduplicación no es sólo cosa del cliente.
create unique index enterprise_inventory_owner_kind_name_idx
  on api.enterprise_inventory_items (owner_id, kind, normalized_name);
create index enterprise_inventory_owner_updated_idx
  on api.enterprise_inventory_items (owner_id, updated_at desc);

alter table api.enterprise_inventory_items enable row level security;

-- La unicidad por nombre no puede depender de lo que el cliente declare: el
-- servidor calcula la clave. Es la misma regla que `normalizeInventoryName`
-- (sin acentos, minúsculas, sin comillas, signos a espacio, espacios colapsados).
create function private.inventory_normalize_name(p_name text)
returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(regexp_replace(normalize(coalesce(p_name, ''), nfd), E'[\\u0300-\\u036f]', '', 'g')),
        E'[`\'"\\u201c\\u201d\\u2019]', '', 'g'),
      E'[^a-z0-9\\s-]', ' ', 'g'),
    E'\\s+', ' ', 'g'));
$$;
revoke all on function private.inventory_normalize_name(text) from public, anon, authenticated, service_role;

create function api.list_enterprise_inventory()
returns setof api.enterprise_inventory_items
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  return query
    select * from api.enterprise_inventory_items
    where owner_id = actor
    order by updated_at desc;
end;
$$;
comment on function api.list_enterprise_inventory() is
  'Lista únicamente el inventario del auth.uid con permiso portfolio:read y sesión activa.';

create function api.save_enterprise_inventory_item(p_item jsonb, p_expected_revision bigint)
returns api.enterprise_inventory_items
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.enterprise_inventory_items;
  item_id text := btrim(coalesce(p_item ->> 'id', ''));
  item_kind text := coalesce(p_item ->> 'kind', '');
  item_name text := btrim(coalesce(p_item ->> 'name', ''));
  item_normalized text := private.inventory_normalize_name(p_item ->> 'name');
  item_lifecycle text := coalesce(p_item ->> 'lifecycle', '');
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_item) <> 'object' or item_id = '' or item_name = '' or item_normalized = ''
    or item_kind not in ('application', 'capability', 'technology')
    or item_lifecycle not in ('candidate', 'active', 'deprecated', 'retired') then
    raise exception 'El elemento de inventario no tiene una forma válida' using errcode = '22023';
  end if;
  if p_item ->> 'userId' is distinct from actor::text then
    raise exception 'El elemento no pertenece a la sesión actual' using errcode = '42501';
  end if;
  if p_expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa' using errcode = '22023';
  end if;

  insert into api.enterprise_inventory_items as target (
    id, owner_id, kind, name, normalized_name, lifecycle, data, revision
  ) values (
    item_id, actor, item_kind, item_name, item_normalized, item_lifecycle, p_item, 1
  )
  on conflict (id) do update
    set kind = excluded.kind,
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        lifecycle = excluded.lifecycle,
        data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;

  if not found then
    raise exception 'Conflicto de inventario: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.save_enterprise_inventory_item(jsonb, bigint) is
  'Guarda un elemento del inventario del auth.uid con permiso, sesión activa y concurrencia optimista.';

create function api.delete_enterprise_inventory_item(p_id text, p_expected_revision bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.enterprise_inventory_items
  where id = p_id and owner_id = actor and revision = p_expected_revision;
  if not found then
    raise exception 'Conflicto de inventario: recarga antes de borrar' using errcode = 'P0001';
  end if;
end;
$$;
comment on function api.delete_enterprise_inventory_item(text, bigint) is
  'Borra un elemento propio del inventario únicamente con la revisión vigente.';

revoke all on table api.enterprise_inventory_items from public, anon, authenticated, service_role;
revoke all on function api.list_enterprise_inventory() from public, anon, authenticated, service_role;
revoke all on function api.save_enterprise_inventory_item(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.delete_enterprise_inventory_item(text, bigint) from public, anon, authenticated, service_role;
grant execute on function api.list_enterprise_inventory() to authenticated;
grant execute on function api.save_enterprise_inventory_item(jsonb, bigint) to authenticated;
grant execute on function api.delete_enterprise_inventory_item(text, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
