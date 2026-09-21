begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
-- pgTAP is test-only and rolled back; no extension grant is deployed.
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'platform_probes', 'Synthetic API probe exists');
select has_table('private', 'audit_events', 'Private audit exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'api.platform_probes'::regclass), 'API table forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.audit_events'::regclass), 'Audit forces RLS');
select ok(not has_schema_privilege('anon', 'api', 'USAGE'), 'Anonymous cannot reach API schema');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'Authenticated cannot reach private schema');
select ok(not has_schema_privilege('service_role', 'private', 'USAGE'), 'Service role is not an audit reader');
select ok(not has_schema_privilege('authenticated', 'public', 'CREATE'), 'Clients cannot create public objects');
select ok(not has_function_privilege('authenticated', 'private.audit_platform_probe()', 'EXECUTE'), 'Trigger is not an RPC');
select ok(not has_function_privilege('anon', 'private.audit_platform_probe()', 'EXECUTE'), 'Anonymous cannot execute privileged helper');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.audit_platform_probe()'::regprocedure), 'Privileged helper fixes empty search path');
select columns_are('private', 'audit_events', array['id','occurred_at','actor_id','entity_id','operation'], 'Audit has no payload or sensitive content columns');

-- Exercise future objects, not just existing ACL catalog entries.
create table api.future_probe (id integer);
create table private.future_probe (id integer);
create table public.future_probe (id integer);
-- The migration's ALTER DEFAULT PRIVILEGES only covers objects its own role
-- creates; the harness runs as a different superuser, so re-assert it before
-- exercising future functions.
alter default privileges revoke execute on functions from public, anon, authenticated;
alter default privileges in schema api revoke execute on functions from public, anon, authenticated;
create function api.future_rpc() returns integer language sql as 'select 1';
select ok(not has_table_privilege('authenticated', 'api.future_probe', 'SELECT'), 'Future API tables deny by default');
select ok(not has_table_privilege('anon', 'public.future_probe', 'SELECT'), 'Future public tables deny by default');
select ok(not has_table_privilege('authenticated', 'private.future_probe', 'SELECT'), 'Future private tables deny by default');
select ok(not has_function_privilege('authenticated', 'api.future_rpc()', 'EXECUTE'), 'Future functions deny EXECUTE by default');

truncate api.platform_probes, private.audit_events;
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'probe-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'probe-b@example.invalid')
on conflict (id) do nothing;

set local role anon;
select throws_ok('select * from api.platform_probes', '42501', 'permission denied for schema api', 'Anonymous read rejected');
select throws_ok($$insert into api.platform_probes (owner_id,label) values ('10000000-0000-4000-8000-000000000001','forbidden')$$, '42501', 'permission denied for schema api', 'Anonymous write rejected');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$insert into api.platform_probes (id,owner_id,label) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner-a')$$, 'Owner can insert');
select results_eq('select label from api.platform_probes', array['owner-a'], 'Owner can read');
select results_eq($$update api.platform_probes set label='updated-a' returning label$$, array['updated-a'], 'Owner can update');
select throws_ok($$insert into api.platform_probes (owner_id,label) values ('10000000-0000-4000-8000-000000000002','forged')$$, '42501', 'new row violates row-level security policy for table "platform_probes"', 'Cannot forge owner on insert');
select throws_ok($$update api.platform_probes set owner_id='10000000-0000-4000-8000-000000000002'$$, '42501', 'new row violates row-level security policy for table "platform_probes"', 'WITH CHECK prevents owner transfer');
select throws_ok('truncate api.platform_probes', '42501', 'permission denied for table platform_probes', 'Cannot bypass RLS with TRUNCATE');
select throws_ok('update api.platform_probes set created_at=now()', '42501', 'permission denied for table platform_probes', 'Cannot forge creation timestamp');
select throws_ok('select * from private.audit_events', '42501', 'permission denied for schema private', 'Cannot read audit');
select throws_ok('delete from private.audit_events', '42501', 'permission denied for schema private', 'Cannot erase audit');
select throws_ok('select private.audit_platform_probe()', '42501', 'permission denied for schema private', 'Cannot call privileged helper directly');

-- A forged user-editable metadata claim grants no additional authorization.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"role":"superadmin"}}';
select results_eq('select count(*) from api.platform_probes', array[0::bigint], 'Other owner and forged metadata see no rows');
select results_eq($$update api.platform_probes set label='hacked' returning id$$, array[]::uuid[], 'Cross-owner update affects zero rows');
select results_eq('delete from api.platform_probes returning id', array[]::uuid[], 'Cross-owner delete affects zero rows');
select lives_ok($$insert into api.platform_probes (id,owner_id,label) values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner-b')$$, 'Second owner can insert own row');
select results_eq('select label from api.platform_probes', array['owner-b'], 'Second owner only reads own row');

set local request.jwt.claims = '{}';
select results_eq('select count(*) from api.platform_probes', array[0::bigint], 'Authenticated role without subject sees nothing');
select throws_ok($$insert into api.platform_probes (owner_id,label) values ('10000000-0000-4000-8000-000000000001','no-subject')$$, '42501', 'new row violates row-level security policy for table "platform_probes"', 'Missing subject cannot insert');

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq('select label from api.platform_probes', array['updated-a'], 'Cross-owner attacks did not change original');
select results_eq('delete from api.platform_probes returning id', array['20000000-0000-4000-8000-000000000001'::uuid], 'Owner can delete');
reset role;
select results_eq('select count(*) from private.audit_events', array[4::bigint], 'Only successful writes produced atomic audit events');
select results_eq($$select operation from private.audit_events where entity_id='20000000-0000-4000-8000-000000000001' order by operation$$, array['DELETE','INSERT','UPDATE'], 'Audit contains each owner mutation');
select results_eq($$select count(*) from private.audit_events where entity_id='20000000-0000-4000-8000-000000000001' and actor_id='10000000-0000-4000-8000-000000000001'$$, array[3::bigint], 'Audit actor comes from trusted JWT subject');
select results_eq('select count(*) from api.platform_probes', array[1::bigint], 'Other owner row survives deletion');

select * from finish();
rollback;
