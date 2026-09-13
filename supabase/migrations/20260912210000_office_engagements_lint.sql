-- F5 additive correction: keep deployed migration history immutable while
-- eliminating the plpgsql_check warning that CI treats as an error.
create or replace function api.load_engagements(p_project_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project_key text := btrim(coalesce(p_project_id, ''));
  payload jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  select coalesce(jsonb_agg(
    e.data || jsonb_build_object(
      'arbDecisions',
      coalesce((select jsonb_agg(d.data order by d.created_at) from api.office_arb_decisions d
                where d.owner_id = actor and d.project_id = project_key
                  and d.engagement_id = e.id), '[]'::jsonb)
    ) order by e.updated_at desc), '[]'::jsonb)
  into payload
  from api.office_engagements e
  where e.owner_id = actor and e.project_id = project_key;

  return payload;
end;
$$;
