begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'architecture_knowledge_graphs', 'El corte del grafo tiene su tabla');
select ok((select relrowsecurity from pg_class where oid = 'api.architecture_knowledge_graphs'::regclass),
  'El grafo tiene RLS');
select ok(not has_table_privilege('authenticated', 'api.architecture_knowledge_graphs', 'INSERT'),
  'El cliente no escribe grafo directo');
select ok(has_function_privilege('authenticated', 'api.save_knowledge_graph(text,jsonb,bigint)', 'EXECUTE'),
  'El cliente recibe una RPC de guardado del grafo');
select ok(has_function_privilege('authenticated', 'api.load_knowledge_graph(text)', 'EXECUTE'),
  'El cliente recibe una RPC de lectura del grafo');

insert into auth.users (id, email) values
  ('64000000-0000-4000-8000-000000000001', 'graph-owner@example.invalid'),
  ('64000000-0000-4000-8000-000000000002', 'graph-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('64000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('64000000-0000-4000-8000-000000000002', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('74000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', null),
  ('74000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';
select is((select (api.save_knowledge_graph('proj_legacy_001', $json$
{
  "projectId": "proj_legacy_001", "version": 1, "buildId": "build_001",
  "lastBuiltAt": "2026-09-12T00:00:00.000Z",
  "entities": [
    {"id": "ake-system-core", "projectId": "proj_legacy_001", "name": "Core", "normalizedName": "core",
     "type": "system", "aliases": [], "sourceRefs": [{"sourceType": "artifact-name", "sourceId": "art_1", "confidence": 0.9, "createdAt": "2026-09-12T00:00:00.000Z"}],
     "confidence": 0.9, "criticality": "high", "status": "active", "tags": [], "metadata": {},
     "createdAt": "2026-09-12T00:00:00.000Z", "updatedAt": "2026-09-12T00:00:00.000Z"}
  ],
  "relations": [],
  "quality": {"score": 80, "averageConfidence": 0.9, "artifactCoverage": 1, "consistencyIssueCount": 0, "traceabilityGapCount": 0, "summary": "OK"},
  "statistics": {"entityCount": 1, "relationCount": 0, "sourceArtifactCount": 1, "byEntityType": {"system": 1}, "byRelationType": {}, "lowConfidenceEntityCount": 0, "candidateDuplicateCount": 0, "orphanEntityCount": 0}
}$json$::jsonb, 0)).revision), 1::bigint,
  'El arquitecto guarda un grafo con proyecto textual no migrado');
select is((select api.load_knowledge_graph('proj_legacy_001') ->> 'buildId'), 'build_001',
  'La lectura hidrata el grafo propio');
select throws_ok($$select api.save_knowledge_graph(
  'proj_legacy_001', '{"projectId":"proj_other","buildId":"b","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 1)$$,
  '22023', 'El grafo no tiene una forma válida',
  'El projectId del grafo debe coincidir con el proyecto destino');
select throws_ok($$select api.save_knowledge_graph(
  'proj_legacy_001', '{"projectId":"proj_legacy_001","buildId":"b2","lastBuiltAt":"x","entities":[{"id":"","name":"x","type":"system","sourceRefs":[]}],"relations":[],"quality":{},"statistics":{}}'::jsonb, 1)$$,
  '22023', 'Una entidad del grafo no tiene una forma válida',
  'La RPC rechaza una entidad sin identidad');
select throws_ok($$select api.save_knowledge_graph(
  'proj_legacy_001', '{"projectId":"proj_legacy_001","buildId":"b3","lastBuiltAt":"x","entities":[],"relations":[{"id":"akr-1","sourceEntityId":"a","targetEntityId":"","type":"uses","sourceRefs":[]}],"quality":{},"statistics":{}}'::jsonb, 1)$$,
  '22023', 'Una relación del grafo no tiene una forma válida',
  'La RPC rechaza una relación con extremo vacío');
select throws_ok($$select api.save_knowledge_graph(
  'proj_legacy_001', '{"projectId":"proj_legacy_001","buildId":"b4","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{},"nested":{"apiKey":"[REDACTED]"}}'::jsonb, 1)$$,
  '22023', 'El grafo no puede contener apiKey',
  'La RPC rechaza secretos anidados en el grafo');
select throws_ok($$select api.save_knowledge_graph(
  'proj_legacy_001', '{"projectId":"proj_legacy_001","buildId":"b5","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 99)$$,
  'P0001', 'Conflicto de grafo: recarga antes de guardar',
  'Una revisión obsoleta no sobrescribe el grafo');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.load_knowledge_graph('proj_legacy_001')$$,
  'P0002', 'El grafo no existe',
  'Otro usuario no lee el grafo ajeno');
reset role;

select * from finish();
rollback;