-- Sonda F9.1 contra el proyecto remoto. Transaccional: todo se revierte.
--
-- Comprueba las seis piezas que la migración `retirement_completeness` añade
-- para que Firestore pueda retirarse, con su caso positivo y su negativo.
-- Ejecutada el 2026-09-19 sobre ArkyDB-US: 14/14 OK.
begin;
create temp table f9_probe(caso text, resultado text);
do $$ begin execute format('grant insert on %s to authenticated', 'pg_temp.f9_probe'); end $$;

insert into auth.users (id, email) values
  ('95000000-0000-4000-8000-000000000001', 'f9-probe-owner@probe.invalid'),
  ('95000000-0000-4000-8000-000000000002', 'f9-probe-other@probe.invalid');
insert into api.user_profiles (id, role, status) values
  ('95000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('95000000-0000-4000-8000-000000000002', 'architect', 'active');
insert into auth.sessions (id, user_id, not_after) values
  ('96000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', null),
  ('96000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', null);
insert into api.business_initiatives (id, owner_id, code, title, need, status, priority, horizon, risk_level, data)
values ('init_f9_probe', '95000000-0000-4000-8000-000000000001', 'NEG-2026-950', 'Probe', 'Probe',
  'draft','medium','next','medium',
  jsonb_build_object('id','init_f9_probe','userId','95000000-0000-4000-8000-000000000001','code','NEG-2026-950'));
insert into api.architecture_projects (id, owner_id, name, initiative_ids, data)
values ('proj_f9_probe', '95000000-0000-4000-8000-000000000001', 'Probe', array['init_f9_probe'],
  jsonb_build_object('id','proj_f9_probe','userId','95000000-0000-4000-8000-000000000001','name','Probe'));

do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000001"}', true);
  select jsonb_array_length(api.list_project_aggregates()) into n;
  insert into f9_probe values ('01 portafolio propio', case when n = 1 then 'OK' else 'FALLO' end);
  insert into f9_probe values ('01b portafolio sin cuerpos',
    case when (api.list_project_aggregates() -> 0 -> 'artifacts') = '[]'::jsonb then 'OK' else 'FALLO' end);
  perform api.save_chat_history('proj_f9_probe', '[{"role":"user","text":"hola"}]'::jsonb);
  select jsonb_array_length(api.load_chat_history('proj_f9_probe')) into n;
  insert into f9_probe values ('02 historial ida y vuelta', case when n = 1 then 'OK' else 'FALLO' end);
  perform api.append_agent_action('proj_f9_probe', '{"traceId":"t1"}'::jsonb);
  select jsonb_array_length(api.list_agent_actions('proj_f9_probe', 50)) into n;
  insert into f9_probe values ('03 accion del agente', case when n = 1 then 'OK' else 'FALLO' end);
  perform api.save_agent_profile('{"agentId":"lucia","alias":"L"}'::jsonb);
  select jsonb_array_length(api.list_agent_profiles()) into n;
  insert into f9_probe values ('04 ficha de agente', case when n = 1 then 'OK' else 'FALLO' end);
  perform api.save_artifact_comment(jsonb_build_object('id','c1','projectId','proj_f9_probe','artifactId','a1','body','x','author',jsonb_build_object('id','95000000-0000-4000-8000-000000000001')));
  select jsonb_array_length(api.list_artifact_comments('proj_f9_probe','a1')) into n;
  insert into f9_probe values ('05 comentario', case when n = 1 then 'OK' else 'FALLO' end);
  perform api.record_artifact_review_decision(jsonb_build_object('id','d1','projectId','proj_f9_probe','artifactId','a1','status','approved'));
  perform api.record_artifact_review_decision(jsonb_build_object('id','d1','projectId','proj_f9_probe','artifactId','a1','status','rejected'));
  insert into f9_probe values ('06 decision inmutable',
    case when (api.list_artifact_review_decisions('proj_f9_probe','a1') -> 0 ->> 'status') = 'approved' then 'OK' else 'FALLO' end);
  insert into f9_probe values ('07 perfil propio',
    case when (api.load_own_profile() ->> 'email') = 'f9-probe-owner@probe.invalid' then 'OK' else 'FALLO' end);
  perform api.update_own_display_name('Probe Owner');
  insert into f9_probe values ('08 nombre propio',
    case when (api.load_own_profile() ->> 'displayName') = 'Probe Owner' then 'OK' else 'FALLO' end);
  reset role;
end $$;

do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000001"}', true);
  begin
    perform api.save_chat_history('proj_f9_probe', '[{"aiConfig":{"apiKey":"x"}}]'::jsonb);
    insert into f9_probe values ('09 clave en historial', 'FALLO');
  exception when others then
    insert into f9_probe values ('09 clave en historial', 'OK ('||sqlstate||')');
  end;
  reset role;
end $$;

do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000002"}', true);
  select jsonb_array_length(api.list_project_aggregates()) into n;
  insert into f9_probe values ('10 ajeno no ve portafolio', case when n = 0 then 'OK' else 'FALLO' end);
  select jsonb_array_length(api.list_agent_profiles()) into n;
  insert into f9_probe values ('13 fichas por persona', case when n = 0 then 'OK' else 'FALLO' end);
  reset role;
end $$;

do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000002"}', true);
  begin
    perform api.save_chat_history('proj_f9_probe', '[]'::jsonb);
    insert into f9_probe values ('11 ajeno no escribe historial', 'FALLO');
  exception when insufficient_privilege then
    insert into f9_probe values ('11 ajeno no escribe historial', 'OK');
  end;
  reset role;
end $$;

do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000002"}', true);
  begin
    perform api.list_user_profiles();
    insert into f9_probe values ('12 arquitecto no lee directorio', 'FALLO');
  exception when insufficient_privilege then
    insert into f9_probe values ('12 arquitecto no lee directorio', 'OK');
  end;
  reset role;
end $$;

select * from f9_probe order by caso;
rollback;
