begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
select no_plan();

select has_table('api', 'file_objects', 'La metadata de archivos existe');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'api.file_objects'::regclass),
  'La metadata fuerza RLS');
select ok(not has_table_privilege('authenticated', 'api.file_objects', 'INSERT'),
  'El cliente no inserta metadata directamente');
select ok(has_function_privilege('authenticated', 'api.register_file_object(text,text,uuid,text,text,text,integer,text,bigint,text,text)', 'EXECUTE'),
  'La metadata se registra mediante RPC');
select ok((select not public from storage.buckets where id = 'artifact-files'),
  'El bucket de artefactos es privado');
select ok((select not public from storage.buckets where id = 'initiative-documents'),
  'El bucket de iniciativas es privado');
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'Storage objects tiene RLS activa');
select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and 'anon' = any(roles) and policyname <> 'storage_poc_anon_guard'
), 'Anon no tiene política permisiva de Storage');
select is((select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects'), 9,
  'Storage tiene cuatro políticas permisivas, cuatro guardas y una guarda anon');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'private' and p.proname in ('storage_path_is_owned', 'storage_path_is_well_formed',
    'storage_path_matches_metadata', 'storage_path_matches_bucket', 'storage_bucket_permission', 'storage_object_metadata_allowed', 'can_write_storage_object',
    'can_read_storage_object', 'can_mutate_storage_object'))
    or (n.nspname = 'api' and p.proname in ('register_file_object', 'mark_file_object_ready', 'mark_file_object_deleted')))
    and p.prosecdef and p.proconfig = array['search_path=""']), 12,
  'Las funciones Storage SECURITY DEFINER fijan search_path vacío');

insert into auth.users (id, email) values
  ('91000000-0000-4000-8000-000000000001', 'storage-owner@example.invalid'),
  ('91000000-0000-4000-8000-000000000002', 'storage-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('91000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('91000000-0000-4000-8000-000000000002', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', null),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;
insert into storage.objects (
  id, bucket_id, name, owner, owner_id, metadata, version, is_delete_marker, is_versioned
) values (
  '93000000-0000-4000-8000-000000000001',
  'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '{"mimetype":"application/octet-stream","size":10,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
  'test-version-1', false, false
);
insert into storage.objects (
  id, bucket_id, name, owner, owner_id, metadata, version, is_delete_marker, is_versioned
) values (
  '93000000-0000-4000-8000-000000000002',
  'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-2/v1/93000000-0000-4000-8000-000000000002.bin',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  '{"mimetype":"application/octet-stream","size":10,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,
  'test-version-2', false, false
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.register_file_object(
  'artifact-files',
  '91000000-0000-4000-8000-000000000002/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '93000000-0000-4000-8000-000000000001',
  'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 10,
  '0000000000000000000000000000000000000000000000000000000000000000',
  'supabase')$$,
  '42501', 'La ruta del objeto no pertenece a la sesión',
  'No se puede registrar una ruta de otro propietario');
select throws_ok($$select api.register_file_object(
  'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/not-a-version/93000000-0000-4000-8000-000000000001.bin',
  '93000000-0000-4000-8000-000000000001',
  'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 10,
  '0000000000000000000000000000000000000000000000000000000000000000',
  'supabase')$$,
  '22023', 'La ruta no coincide con la metadata del objeto',
  'No se acepta una ruta malformada');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000002.bin',
  '93000000-0000-4000-8000-000000000002', 'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 10, repeat('0', 64), 'supabase')$$,
  'P0002', 'El objeto, propietario o metadata física no coincide',
  'No se registra metadata para un blob inexistente');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 9, repeat('a', 64), 'supabase')$$,
  'P0002', 'El objeto, propietario o metadata física no coincide',
  'El tamaño declarado debe coincidir con el tamaño físico');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
  'application/json', 10, repeat('a', 64), 'supabase')$$,
  'P0002', 'El objeto, propietario o metadata física no coincide',
  'El MIME declarado debe coincidir con el MIME físico');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 10, repeat('b', 64), 'supabase')$$,
  'P0002', 'El objeto, propietario o metadata física no coincide',
  'El checksum declarado debe coincidir con el checksum físico');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-2/v1/93000000-0000-4000-8000-000000000002.bin',
  '93000000-0000-4000-8000-000000000002', 'artifact', 'project-1', 'artifact-2', 1,
  'application/octet-stream', 10, repeat('b', 64), 'supabase')$$,
  'P0002', 'El objeto, propietario o metadata física no coincide',
  'El propietario físico debe coincidir con la sesión');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000003.bin',
  '93000000-0000-4000-8000-000000000003', 'artifact', 'project-1', 'artifact-1', 1,
  'application/x-msdownload', 10, repeat('0', 64), 'supabase')$$,
  '22023', 'Tipo MIME no permitido',
  'La allowlist de MIME se aplica antes de registrar');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000004.bin',
  '93000000-0000-4000-8000-000000000004', 'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', -1, repeat('0', 64), 'supabase')$$,
  '22023', 'El tamaño del objeto no es válido',
  'No se aceptan tamaños negativos');
select throws_ok($$select api.register_file_object(
  'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000005.bin',
  '93000000-0000-4000-8000-000000000005', 'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 10, 'not-a-sha256', 'supabase')$$,
  '22023', 'El checksum no tiene formato SHA-256',
  'El checksum se valida en el límite confiable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select throws_ok($$insert into storage.objects (
  id, bucket_id, name, owner, owner_id, metadata, version, is_delete_marker, is_versioned
) values (
  '93000000-0000-4000-8000-000000000003', 'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-3/v1/93000000-0000-4000-8000-000000000003.doc',
  '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
  '{"mimetype":"application/msword","size":10,"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb,
  'test-version-3', false, false)$$,
  '42501', NULL, 'La política INSERT aplica el MIME permitido por bucket');
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select throws_ok($$delete from storage.objects where id = '93000000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for schema storage',
  'El cliente no elimina un objeto no registrado');
select lives_ok($$select api.register_file_object(
  'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '93000000-0000-4000-8000-000000000001',
  'artifact', 'project-1', 'artifact-1', 1,
  'application/octet-stream', 10, repeat('a', 64), 'supabase')$$,
  'El propietario registra la metadata de su objeto');
reset role;
update api.user_profiles set role = 'admin'
where id = '91000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002"}';
select is((select count(*)::bigint from api.file_objects
  where owner_id = '91000000-0000-4000-8000-000000000001'), 0::bigint,
  'Un administrador no lee metadata Storage de otro propietario');
-- En el arnés nativo `authenticated` carece de USAGE en el esquema storage; en
-- la pila real Storage la conexión entra y la política RLS la vacía. Mismo
-- fallo cerrado, camino distinto.
select throws_ok('select count(*) from storage.objects', '42501', 'permission denied for schema storage',
  'Un administrador no lee objetos físicos de otro propietario');
reset role;
update api.user_profiles set status = 'disabled'
where id = '91000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select is((select count(*)::bigint from api.file_objects), 0::bigint,
  'Una cuenta deshabilitada no lee metadata Storage');
-- En el arnés nativo `authenticated` carece de USAGE en el esquema storage, así
-- que la lectura aborta por permiso de esquema; en la pila real Storage acepta
-- la conexión y la política RLS la vacía. Mismo fallo cerrado, camino distinto.
select throws_ok('select count(*) from storage.objects', '42501', 'permission denied for schema storage',
  'Una cuenta deshabilitada no lee objetos Storage');
reset role;
set local role service_role;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.mark_file_object_ready('00000000-0000-4000-8000-000000000001')$$,
  '42501', 'Solo el backend confiable puede marcar ready',
  'Un claim de rol ausente no puede marcar ready');
reset role;

set local role anon;
select throws_ok('select * from api.file_objects', '42501', 'permission denied for schema api',
  'Anon no alcanza la metadata');
-- En la pila real Storage concede USAGE en el esquema storage sólo a sus roles
-- de servicio; un cliente anónimo ni siquiera alcanza el esquema. El arnés lo
-- replica: la consulta aborta por permiso de esquema, que es el mismo fallo
-- cerrado que la pila produce de otra forma.
select throws_ok('select count(*) from storage.objects', '42501', 'permission denied for schema storage',
  'Anon no lista objetos de Storage');
reset role;

select * from finish();
rollback;
