-- F5.5 / Corte 2 — Iniciativas de negocio.
--
-- El id se mantiene como texto porque las atenciones Firebase existentes ya
-- guardan `initiativeIds` con valores `init_*`. Cambiarlo a uuid antes del
-- corte de proyectos rompería esas relaciones.
begin;

create table api.business_initiatives (
  id text primary key check (btrim(id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  code text not null unique check (code ~ '^NEG-[0-9]{4}-[0-9]{3}$'),
  title text not null check (btrim(title) <> ''),
  need text not null check (btrim(need) <> ''),
  status text not null check (status in ('draft', 'proposed', 'approved', 'in-progress', 'on-hold', 'delivered', 'realized', 'cancelled')),
  priority text not null check (priority in ('critical', 'high', 'medium', 'low')),
  horizon text not null check (horizon in ('now', 'next', 'later')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_initiatives_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint business_initiatives_data_has_matching_identity check (
    data ->> 'id' = id
    and data ->> 'userId' = owner_id::text
    and data ->> 'code' = code
  )
);
comment on table api.business_initiatives is
  'Agregado de iniciativa. id textual preserva referencias Firebase init_* hasta migrar proyectos.';
comment on column api.business_initiatives.data is
  'Agregado BusinessInitiative completo, incluidas colecciones embebidas y fechas de origen.';

create index business_initiatives_owner_updated_idx
  on api.business_initiatives (owner_id, updated_at desc);
create index business_initiatives_status_idx
  on api.business_initiatives (status, updated_at desc);

alter table api.business_initiatives enable row level security;

create function api.list_business_initiatives()
returns setof api.business_initiatives
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
    select *
    from api.business_initiatives
    where owner_id = actor
    order by updated_at desc;
end;
$$;
comment on function api.list_business_initiatives() is
  'Lista únicamente iniciativas del auth.uid con permiso portfolio:read y sesión activa.';

create function api.save_business_initiative(p_initiative jsonb, p_expected_revision bigint)
returns api.business_initiatives
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.business_initiatives;
  initiative_id text := btrim(coalesce(p_initiative ->> 'id', ''));
  initiative_code text := btrim(coalesce(p_initiative ->> 'code', ''));
  initiative_title text := btrim(coalesce(p_initiative ->> 'title', ''));
  initiative_need text := btrim(coalesce(p_initiative ->> 'need', ''));
  initiative_status text := coalesce(p_initiative ->> 'status', '');
  initiative_priority text := coalesce(p_initiative ->> 'priority', '');
  initiative_horizon text := coalesce(p_initiative ->> 'horizon', '');
  initiative_risk_level text := coalesce(p_initiative ->> 'riskLevel', '');
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('initiative:write') then
    raise exception 'Permiso insuficiente: initiative:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_initiative) <> 'object' or initiative_id = '' or initiative_code !~ '^NEG-[0-9]{4}-[0-9]{3}$'
    or initiative_title = '' or initiative_need = '' then
    raise exception 'La iniciativa no tiene una forma válida' using errcode = '22023';
  end if;
  if p_initiative ->> 'userId' is distinct from actor::text then
    raise exception 'La iniciativa no pertenece a la sesión actual' using errcode = '42501';
  end if;
  if p_expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa' using errcode = '22023';
  end if;

  insert into api.business_initiatives as target (
    id, owner_id, code, title, need, status, priority, horizon, risk_level, data, revision
  ) values (
    initiative_id, actor, initiative_code, initiative_title, initiative_need,
    initiative_status, initiative_priority, initiative_horizon, initiative_risk_level,
    p_initiative, 1
  )
  on conflict (id) do update
    set code = excluded.code,
        title = excluded.title,
        need = excluded.need,
        status = excluded.status,
        priority = excluded.priority,
        horizon = excluded.horizon,
        risk_level = excluded.risk_level,
        data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;

  if not found then
    raise exception 'Conflicto de iniciativa: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.save_business_initiative(jsonb, bigint) is
  'Guarda una iniciativa del auth.uid con permiso, sesión activa y concurrencia optimista.';

create function api.delete_business_initiative(p_id text, p_expected_revision bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('initiative:write') then
    raise exception 'Permiso insuficiente: initiative:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.business_initiatives
  where id = p_id and owner_id = actor and revision = p_expected_revision;
  if not found then
    raise exception 'Conflicto de iniciativa: recarga antes de borrar' using errcode = 'P0001';
  end if;
end;
$$;
comment on function api.delete_business_initiative(text, bigint) is
  'Borra una iniciativa propia únicamente con la revisión vigente.';

revoke all on table api.business_initiatives from public, anon, authenticated, service_role;
revoke all on function api.list_business_initiatives() from public, anon, authenticated, service_role;
revoke all on function api.save_business_initiative(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.delete_business_initiative(text, bigint) from public, anon, authenticated, service_role;
grant execute on function api.list_business_initiatives() to authenticated;
grant execute on function api.save_business_initiative(jsonb, bigint) to authenticated;
grant execute on function api.delete_business_initiative(text, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
