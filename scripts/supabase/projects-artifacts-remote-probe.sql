-- Sonda F5.5 en PostgreSQL 17. Todos los datos se revierten.
begin;
create temp table project_probe_results (caso text, resultado text);

insert into auth.users (id, email) values
  ('83000000-0000-4000-8000-000000000001', 'project-architect@probe.invalid'),
  ('83000000-0000-4000-8000-000000000002', 'project-viewer@probe.invalid');
insert into api.user_profiles (id, role, status) values
  ('83000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('83000000-0000-4000-8000-000000000002', 'viewer', 'active');
insert into auth.sessions (id, user_id, not_after) values
  ('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', null),
  ('84000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', null);

-- La iniciativa padre se crea con la misma identidad que el proyecto.
do $$ declare revision bigint; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
  select (api.save_business_initiative($json${
    "id":"init_project_remote_probe", "schemaVersion":1, "code":"NEG-2026-830",
    "title":"Padre de proyecto", "need":"Verificar agregado compuesto", "driver":"",
    "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
    "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
    "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
    "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
    "userId":"83000000-0000-4000-8000-000000000001",
    "createdAt":"2026-09-12T00:00:00.000Z", "updatedAt":"2026-09-12T00:00:00.000Z"
  }$json$::jsonb, 0)).revision into revision;
  reset role;
  insert into project_probe_results values ('01 iniciativa padre creada', case when revision = 1 then 'OK' else 'FALLO' end);
end $$;

do $$ declare aggregate jsonb; revision bigint; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
  select (api.save_project_aggregate($json${
    "id":"proj_remote_probe", "name":"Atención digital", "description":"", "projectContext":[],
    "initiativeIds":["init_project_remote_probe"], "linkedBusinessProjects":["NEG-2026-830"],
    "userId":"83000000-0000-4000-8000-000000000001",
    "createdAt":"2026-09-12T00:00:00.000Z", "updatedAt":"2026-09-12T00:00:00.000Z"
  }$json$::jsonb, $json$[
    {"id":"art_remote_probe", "name":"Diagrama", "type":"mermaid-graph", "versionGroupId":"vg_remote", "version":1, "createdAt":"2026-09-12T00:00:00.000Z", "phase":"design", "architecturalView":"Vista Lógica y de Diseño", "content":"graph TD; A-->B", "objective":"Explicar la relación", "keyConcepts":[{"term":"A","definition":"Origen"}], "representation":"diagram"}
  ]$json$::jsonb, 0)).revision into revision;
  select api.load_project_aggregate('proj_remote_probe') into aggregate;
  reset role;
  insert into project_probe_results values ('02 arquitecto guarda e hidrata el agregado',
    case when revision = 1 and jsonb_array_length(aggregate -> 'artifacts') = 1
      and jsonb_array_length(aggregate -> 'artifactIndex') = 1 then 'OK' else 'FALLO' end);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_probe","name":"Atención digital","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      '[]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = 'P0001' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('03 revisión obsoleta rechazada', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000002"}', true);
    perform api.load_project_aggregate('proj_remote_probe');
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '42501' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('04 otro usuario no lee el agregado', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_secret","name":"Secreto","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001","nested":{"apiKey":"[REDACTED]"}}'::jsonb,
      '[]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('05 secreto anidado rechazado', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_duplicates","name":"Duplicados","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      '[
        {"id":"art_duplicate","name":"Uno","type":"mermaid-graph","versionGroupId":"vg_one","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"graph TD; A-->B","objective":"Uno","keyConcepts":[{"term":"A","definition":"Uno"}],"representation":"diagram"},
        {"id":"art_duplicate","name":"Dos","type":"mermaid-graph","versionGroupId":"vg_two","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"graph TD; A-->C","objective":"Dos","keyConcepts":[{"term":"A","definition":"Dos"}],"representation":"diagram"}
      ]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('06 artefactos duplicados rechazados', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_incomplete","name":"Incompleto","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      '[{"id":"art_incomplete","name":"Incompleto","type":"mermaid-graph","versionGroupId":"vg_incomplete","version":1}]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('07 contrato de artefacto incompleto rechazado', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_unknown_type","name":"Tipo inválido","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      '[{"id":"art_unknown_type","name":"Inválido","type":"unknown-artifact","versionGroupId":"vg_invalid","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('08 tipo fuera del contrato rechazado', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_unknown_view","name":"Vista inválida","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      '[{"id":"art_unknown_view","name":"Inválido","type":"mermaid-graph","versionGroupId":"vg_invalid","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"logical","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('09 vista fuera del contrato rechazada', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"84000000-0000-4000-8000-000000000001"}', true);
    perform api.save_project_aggregate(
      '{"id":"proj_remote_invalid_version","name":"Versión inválida","initiativeIds":["init_project_remote_probe"],"userId":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      '[{"id":"art_invalid_version","name":"Inválido","type":"mermaid-graph","versionGroupId":"vg_invalid","version":0,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}]'::jsonb, 0);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into project_probe_results values ('10 versión no positiva rechazada', m);
end $$;

select caso, resultado from project_probe_results order by caso;
rollback;
