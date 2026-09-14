-- Sonda remota F5: parámetros globales de referencia.
-- La transacción revierte usuarios, sesiones y la prueba de concurrencia.
begin;

create temp table probe_results (case_name text, result text);

insert into auth.users (id, email) values
  ('67000000-0000-4000-8000-000000000001', 'parameters-admin@probe.invalid'),
  ('67000000-0000-4000-8000-000000000002', 'parameters-viewer@probe.invalid');
insert into api.user_profiles (id, role, status) values
  ('67000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('67000000-0000-4000-8000-000000000002', 'viewer', 'active');
insert into auth.sessions (id, user_id, not_after) values
  ('77000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000001', null),
  ('77000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000002', null);

do $$ declare before_revision bigint; after_revision bigint; loaded jsonb; message text; begin
  select revision into before_revision from api.platform_reference_parameters where key = 'global';
  before_revision := coalesce(before_revision, 0);
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
  select (api.save_platform_reference_parameters('{"globalContext":["probe"]}', before_revision)).revision into after_revision;
  select api.load_platform_reference_parameters() into loaded;
  reset role;
  insert into probe_results values ('admin-write-read', case when after_revision = before_revision + 1 and loaded -> 'globalContext' = '["probe"]'::jsonb then 'OK' else 'FAIL' end);
end $$;

do $$ declare message text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000002"}', true);
    perform api.load_platform_reference_parameters();
    reset role;
    message := 'FAIL: allowed';
  exception when others then
    reset role;
    message := case when sqlstate = '42501' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  insert into probe_results values ('viewer-denied', message);
end $$;

do $$ declare before_revision bigint; message text; begin
  select revision into before_revision from api.platform_reference_parameters where key = 'global';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
    perform api.save_platform_reference_parameters('{"nested":{"client_secret":"forbidden"}}', before_revision);
    reset role;
    message := 'FAIL: allowed';
  exception when others then
    reset role;
    message := case when sqlstate = '22023' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  insert into probe_results values ('secret-field-denied', message);
end $$;

do $$ declare before_revision bigint; message text; begin
  select revision into before_revision from api.platform_reference_parameters where key = 'global';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
    perform api.save_platform_reference_parameters(jsonb_build_object('globalContext', jsonb_build_array('AIza' || repeat('A', 35))), before_revision);
    reset role;
    message := 'FAIL: allowed';
  exception when others then
    reset role;
    message := case when sqlstate = '22023' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  insert into probe_results values ('secret-shape-denied', message);
end $$;

do $$ declare before_revision bigint; message text; begin
  select revision into before_revision from api.platform_reference_parameters where key = 'global';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
    perform api.save_platform_reference_parameters('{"globalContext":["Contact probe@example.invalid"]}', before_revision);
    reset role;
    message := 'FAIL: allowed';
  exception when others then
    reset role;
    message := case when sqlstate = '22023' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  insert into probe_results values ('pii-denied', message);
end $$;

do $$ declare message text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000002"}', true);
    perform count(*) from api.platform_reference_parameters;
    reset role;
    message := 'FAIL: direct-table-read';
  exception when others then
    reset role;
    message := case when sqlstate = '42501' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  insert into probe_results values ('direct-table-denied', message);
end $$;

do $$ declare message text; created_revision bigint; begin
  delete from api.platform_reference_parameters where key = 'global';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
    perform api.save_platform_reference_parameters('{"globalContext":["invalid-initial-revision"]}', 1);
    reset role;
    message := 'FAIL: stale-initial-allowed';
  exception when others then
    reset role;
    message := case when sqlstate = 'P0001' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
  select (api.save_platform_reference_parameters('{"globalContext":["valid-initial-revision"]}', 0)).revision into created_revision;
  reset role;
  insert into probe_results values ('initial-revision-guard', case when message = 'OK' and created_revision = 1 then 'OK' else 'FAIL' end);
end $$;

delete from auth.sessions where id = '77000000-0000-4000-8000-000000000001';
do $$ declare before_revision bigint; message text; begin
  select revision into before_revision from api.platform_reference_parameters where key = 'global';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}', true);
    perform api.save_platform_reference_parameters('{"globalContext":[]}', before_revision);
    reset role;
    message := 'FAIL: revoked-session-allowed';
  exception when others then
    reset role;
    message := case when sqlstate = '42501' then 'OK' else 'FAIL: ' || sqlstate end;
  end;
  insert into probe_results values ('revoked-session-denied', message);
end $$;

select case_name, result from probe_results order by case_name;
rollback;
