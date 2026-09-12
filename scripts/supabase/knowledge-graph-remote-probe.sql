-- Sonda F5 corte 5 en PostgreSQL 17. Todos los datos se revierten.
begin;
create temp table graph_probe_results (caso text, resultado text);

insert into auth.users (id, email) values
  ('87000000-0000-4000-8000-000000000001', 'graph-architect@probe.invalid'),
  ('87000000-0000-4000-8000-000000000002', 'graph-viewer@probe.invalid');
insert into api.user_profiles (id, role, status) values
  ('87000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('87000000-0000-4000-8000-000000000002', 'viewer', 'active');
insert into auth.sessions (id, user_id, not_after) values
  ('88000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', null),
  ('88000000-0000-4000-8000-000000000002', '87000000-0000-4000-8000-000000000002', null);

do $$ declare revision bigint; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"87000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"88000000-0000-4000-8000-000000000001"}', true);
  select (api.save_knowledge_graph('proj_probe', $json$
  {
    "projectId": "proj_probe", "version": 1, "buildId": "build_probe",
    "lastBuiltAt": "2026-09-12T00:00:00.000Z",
    "entities": [
      {"id": "ake-system-core", "projectId": "proj_probe", "name": "Core", "normalizedName": "core",
       "type": "system", "aliases": [], "sourceRefs": [{"sourceType": "artifact-name", "sourceId": "art_1", "confidence": 0.9, "createdAt": "2026-09-12T00:00:00.000Z"}],
       "confidence": 0.9, "criticality": "high", "status": "active", "tags": [], "metadata": {},
       "createdAt": "2026-09-12T00:00:00.000Z", "updatedAt": "2026-09-12T00:00:00.000Z"}
    ],
    "relations": [],
    "quality": {"score": 80, "averageConfidence": 0.9, "artifactCoverage": 1, "consistencyIssueCount": 0, "traceabilityGapCount": 0, "summary": "OK"},
    "statistics": {"entityCount": 1, "relationCount": 0, "sourceArtifactCount": 1, "byEntityType": {"system": 1}, "byRelationType": {}, "lowConfidenceEntityCount": 0, "candidateDuplicateCount": 0, "orphanEntityCount": 0}
  }$json$::jsonb, 0)).revision into revision;
  reset role;
  insert into graph_probe_results values ('01 arquitecto guarda y lee su grafo',
    case when revision = 1
      and (api.load_knowledge_graph('proj_probe') ->> 'buildId') = 'build_probe' then 'OK' else 'FALLO' end);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"87000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"88000000-0000-4000-8000-000000000001"}', true);
    perform api.save_knowledge_graph('proj_probe',
      '{"projectId":"proj_probe","buildId":"b2","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 99);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = 'P0001' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into graph_probe_results values ('02 revisión obsoleta rechazada', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"87000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"88000000-0000-4000-8000-000000000002"}', true);
    perform api.load_knowledge_graph('proj_probe');
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = 'P0002' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into graph_probe_results values ('03 otro usuario no lee el grafo', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"87000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"88000000-0000-4000-8000-000000000001"}', true);
    perform api.save_knowledge_graph('proj_probe',
      '{"projectId":"proj_probe","buildId":"b3","lastBuiltAt":"x","entities":[{"id":"","name":"x","type":"system","sourceRefs":[]}],"relations":[],"quality":{},"statistics":{}}'::jsonb, 1);
    reset role; m := 'FALLO: permitido';
  exception when others then m := case when sqlstate = '22023' then 'OK: ' || sqlstate else 'FALLO: ' || sqlstate end; end;
  insert into graph_probe_results values ('04 entidad sin identidad rechazada', m);
end $$;

select caso, resultado from graph_probe_results order by caso;
rollback;