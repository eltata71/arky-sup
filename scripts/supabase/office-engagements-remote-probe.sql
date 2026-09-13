-- Sonda F5 corte 4 en PostgreSQL 17. Todos los datos se revierten.
begin;
create temp table office_probe_results (caso text, resultado text);

insert into auth.users (id, email) values
  ('85000000-0000-4000-8000-000000000001', 'office-architect@probe.invalid'),
  ('85000000-0000-4000-8000-000000000003', 'office-admin@probe.invalid');
insert into api.user_profiles (id, role, status) values
  ('85000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('85000000-0000-4000-8000-000000000003', 'admin', 'active');
insert into auth.sessions (id, user_id, not_after) values
  ('86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', null),
  ('86000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000003', null);

do $$ declare revision bigint; count_loaded bigint; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"86000000-0000-4000-8000-000000000001"}', true);
  select (api.save_engagement('proj_probe', $json$
  {
    "id": "eng_probe", "projectId": "proj_probe", "schemaVersion": 1,
    "title": "Encargo sonda", "brief": "Brief de la sonda",
    "initiativeIds": [], "businessProjectIds": [],
    "status": "awaiting-arb", "priority": "medium",
    "charter": {"kind": "new-solution", "objectives": [], "scope": [], "outOfScope": [], "constraints": [],
      "regulatoryDrivers": [], "deliverables": [], "participantIds": [], "coordinatorId": "lucia",
      "consolidatorId": "alejandro", "provenance": "deterministic", "proposedAt": "2026-09-12T00:00:00.000Z"},
    "tasks": [], "arbDecisions": [], "budget": {"maxAiCalls": 40, "consumedAiCalls": 0},
    "auditTrail": [], "createdBy": {"id": "85000000-0000-4000-8000-000000000001", "name": "Arquitecto", "role": "architect"},
    "createdAt": "2026-09-12T00:00:00.000Z", "updatedAt": "2026-09-12T00:00:00.000Z"
  }$json$::jsonb, 0)).revision into revision;
  select jsonb_array_length(api.load_engagements('proj_probe')) into count_loaded;
  reset role;
  insert into office_probe_results values ('01 arquitecto guarda y lista su encargo',
    case when revision = 1 and count_loaded = 1 then 'OK' else 'FALLO' end);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"86000000-0000-4000-8000-000000000003"}', true);
    perform api.record_arb_decision(
      '{"id":"arb_probe","engagementId":"eng_probe","verdict":"approved","rationale":"Aprobado","actor":{"id":"85000000-0000-4000-8000-000000000003","name":"Admin","role":"admin"},"gateStatusAtDecision":"pass","previousStatus":"awaiting-arb","decidedAt":"2026-09-12T00:00:00.000Z"}'::jsonb);
    reset role; m := 'OK';
  exception when others then m := 'FALLO: ' || sqlstate; end;
  insert into office_probe_results values ('02 admin firma decisión sobre encargo ajeno', m);
end $$;

do $$ declare forged text; total bigint; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"86000000-0000-4000-8000-000000000001"}', true);
    perform api.record_arb_decision(
      '{"id":"arb_forge_probe","engagementId":"eng_probe","verdict":"approved","rationale":"x","actor":{"id":"85000000-0000-4000-8000-000000000001","name":"Impostor","role":"admin"},"gateStatusAtDecision":"pass","previousStatus":"awaiting-arb","decidedAt":"2026-09-12T00:00:00.000Z"}'::jsonb);
    reset role; forged := 'FALLO: permitido';
  exception when others then forged := case when sqlstate = '42501' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  select count(*) into total from api.office_arb_decisions;
  insert into office_probe_results values ('03 autor no firma la decisión', forged || ' / registros=' || total);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"86000000-0000-4000-8000-000000000001"}', true);
    perform api.save_engagement('proj_probe',
      '{"id":"eng_probe","projectId":"proj_probe","title":"x","brief":"x","status":"intake","charter":{"k":1},"tasks":[],"auditTrail":[],"budget":{"maxAiCalls":1,"consumedAiCalls":0}}'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = 'P0001' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into office_probe_results values ('04 revisión obsoleta rechazada', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"86000000-0000-4000-8000-000000000001"}', true);
    perform api.save_engagement('proj_probe',
      '{"id":"eng_probe","projectId":"proj_probe","title":"x","brief":"x","status":"delivered","charter":{"k":1},"tasks":[],"auditTrail":[],"budget":{"maxAiCalls":1,"consumedAiCalls":0}}'::jsonb, 1);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '42501' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into office_probe_results values ('05 entregado sin arb:decide rechazado', m);
end $$;

select caso, resultado from office_probe_results order by caso;
rollback;