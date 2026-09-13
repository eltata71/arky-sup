-- F5.6 — Corrección aditiva del contrato de progreso LMS.
--
-- La migración inicial ya está aplicada. Se preserva su historial y se recrea
-- únicamente la función para dar precedencia explícita al rechazo de secretos
-- anidados, antes de validar el resto de la forma del payload.
begin;

create or replace function api.save_progress(p_progress jsonb)
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
  if jsonb_path_exists(p_progress, '$.**.apiKey') then
    raise exception 'El progreso rechaza secretos anidados' using errcode = '22023';
  end if;
  if jsonb_typeof(p_progress) is distinct from 'object' then
    raise exception 'El progreso no tiene una forma válida' using errcode = '22023';
  end if;
  insert into api.lms_progress (owner_id, data, updated_at)
  values (actor, p_progress - 'userId', now())
  on conflict (owner_id) do update
    set data = excluded.data,
        updated_at = now();
end;
$$;

revoke all on function api.save_progress(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.save_progress(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
