begin;
create temp table storage_probe_results (case_name text, result text);

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
  id, bucket_id, name, owner, owner_id, metadata, version,
  is_delete_marker, is_versioned
) values (
  '93000000-0000-4000-8000-000000000001',
  'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '{"mimetype":"application/octet-stream","size":10,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
  'probe-version-1', false, false
);
insert into storage.objects (
  id, bucket_id, name, owner, owner_id, metadata, version,
  is_delete_marker, is_versioned
) values (
  '93000000-0000-4000-8000-000000000002',
  'artifact-files',
  '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-2/v1/93000000-0000-4000-8000-000000000002.bin',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  '{"mimetype":"application/octet-stream","size":10,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,
  'probe-version-2', false, false
);

-- Catalog and privilege invariants.
insert into storage_probe_results
select '01 buckets privados, limite y MIME por bucket', case when count(*) = 2
  and bool_and(not public and file_size_limit = 52428800)
  and (select allowed_mime_types @> array['application/octet-stream']::text[] and not (allowed_mime_types @> array['application/msword']::text[]) from storage.buckets where id = 'artifact-files')
  and (select allowed_mime_types @> array['application/msword']::text[] and not (allowed_mime_types @> array['application/octet-stream']::text[]) from storage.buckets where id = 'initiative-documents')
  then 'OK' else 'FALLO' end
from storage.buckets where id in ('artifact-files', 'initiative-documents');
insert into storage_probe_results
select '02 MIME específico por bucket', case when
  not private.storage_object_metadata_allowed('artifact-files', '{"mimetype":"application/msword","size":10}'::jsonb)
  and private.storage_object_metadata_allowed('artifact-files', '{"mimetype":"application/octet-stream","size":10}'::jsonb)
  and private.storage_object_metadata_allowed('initiative-documents', '{"mimetype":"application/msword","size":10}'::jsonb)
  and not private.storage_object_metadata_allowed('initiative-documents', '{"mimetype":"application/octet-stream","size":10}'::jsonb)
then 'OK' else 'FALLO' end;
insert into storage_probe_results
select '03 metadata fuerza RLS', case when relrowsecurity and relforcerowsecurity then 'OK' else 'FALLO' end
from pg_class where oid = 'api.file_objects'::regclass;
insert into storage_probe_results
select '03 grants directos gestionados por Storage', case when not has_table_privilege('authenticated', 'api.file_objects', 'INSERT')
  and has_table_privilege('authenticated', 'storage.objects', 'UPDATE')
  and has_table_privilege('authenticated', 'storage.objects', 'DELETE')
  then 'OK ACL administrada; RLS restringe mutaciones' else 'FALLO' end;
insert into storage_probe_results
select '04 políticas Storage reconocidas y con guardas', case when count(*) = 9 then 'OK' else 'FALLO políticas=' || count(*) end
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in (
    'storage_poc_select', 'storage_poc_insert', 'storage_poc_update', 'storage_poc_delete',
    'storage_poc_select_guard', 'storage_poc_insert_guard',
    'storage_poc_update_guard', 'storage_poc_delete_guard', 'storage_poc_anon_guard'
  );
insert into storage_probe_results
select '05 funciones SECURITY DEFINER fijan search_path vacio', case when count(*) = 12 then 'OK' else 'FALLO funciones=' || count(*) end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where ((n.nspname = 'private' and p.proname in (
    'storage_path_is_owned', 'storage_path_is_well_formed',
    'storage_path_matches_metadata', 'storage_path_matches_bucket', 'storage_bucket_permission', 'storage_object_metadata_allowed',
    'can_write_storage_object', 'can_read_storage_object', 'can_mutate_storage_object'
  )) or (n.nspname = 'api' and p.proname in (
    'register_file_object', 'mark_file_object_ready', 'mark_file_object_deleted'
  )))
  and p.prosecdef and p.proconfig = array['search_path=""'];
insert into storage_probe_results
select '06 anon sin política permisiva', case when not exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and 'anon' = any(roles)
    and policyname <> 'storage_poc_anon_guard'
) then 'OK' else 'FALLO' end;

do $$
declare
  message text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
    insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, version, is_delete_marker, is_versioned)
    values (
      '93000000-0000-4000-8000-000000000003', 'artifact-files',
      '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-3/v1/93000000-0000-4000-8000-000000000003.doc',
      '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      '{"mimetype":"application/msword","size":10,"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb,
      'probe-version-3', false, false
    );
    reset role;
    message := 'FALLO insert MIME cruzado permitido';
  exception when others then
    reset role;
    message := case when sqlstate = '42501' then 'OK ' || sqlstate else 'FALLO ' || sqlstate || ': ' || sqlerrm end;
  end;
  insert into storage_probe_results values ('07 política INSERT aplica MIME del bucket', message);
end $$;

do $$
declare
  message text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  begin
    perform api.register_file_object(
      'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
      '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
      'application/json', 10, repeat('a', 64), 'supabase');
    reset role; message := 'FALLO MIME permitido';
  exception when others then
    reset role; message := case when sqlstate = 'P0002' then 'OK ' || sqlstate else 'FALLO ' || sqlstate end;
  end;
  insert into storage_probe_results values ('08 MIME físico discordante rechazado', message);

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  begin
    perform api.register_file_object(
      'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
      '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
      'application/octet-stream', 10, repeat('b', 64), 'supabase');
    reset role; message := 'FALLO SHA permitido';
  exception when others then
    reset role; message := case when sqlstate = 'P0002' then 'OK ' || sqlstate else 'FALLO ' || sqlstate end;
  end;
  insert into storage_probe_results values ('09 SHA-256 físico discordante rechazado', message);

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  begin
    perform api.register_file_object(
      'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-2/v1/93000000-0000-4000-8000-000000000002.bin',
      '93000000-0000-4000-8000-000000000002', 'artifact', 'project-1', 'artifact-2', 1,
      'application/octet-stream', 10, repeat('b', 64), 'supabase');
    reset role; message := 'FALLO propietario permitido';
  exception when others then
    reset role; message := case when sqlstate = 'P0002' then 'OK ' || sqlstate else 'FALLO ' || sqlstate end;
  end;
  insert into storage_probe_results values ('10 propietario físico discordante rechazado', message);
end $$;

-- Valid owner registration and state transition.
do $$
declare
  registered api.file_objects;
  ready api.file_objects;
  owner_visible integer;
  pending_visible integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  select * into registered from api.register_file_object(
    'artifact-files',
    '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
    '93000000-0000-4000-8000-000000000001',
    'artifact', 'project-1', 'artifact-1', 1,
    'application/octet-stream', 10, repeat('a', 64), 'supabase');
  select count(*) into pending_visible from storage.objects;
  begin
    perform api.mark_file_object_ready(registered.id);
    reset role;
    insert into storage_probe_results values ('07 propietario registra pendiente y no marca ready', 'FALLO permitido');
    return;
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  reset role;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001"}', true);
  reset request.jwt.claim.role;
  begin
    perform api.mark_file_object_ready(registered.id);
    reset role;
    insert into storage_probe_results values ('07 claim role ausente rechaza ready', 'FALLO permitido');
    return;
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  reset role;
  insert into storage_probe_results values ('07 claim role ausente rechaza ready', 'OK 42501');
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into ready from api.mark_file_object_ready(registered.id);
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  select count(*) into owner_visible from storage.objects;
  reset role;
  insert into storage_probe_results values ('07 cliente registra pendiente y backend marca ready', case when registered.state = 'pending' and ready.state = 'ready' and pending_visible = 0 and owner_visible = 1 then 'OK' else 'FALLO pending=' || pending_visible || ' ready=' || owner_visible end);
exception when others then
  reset role;
  insert into storage_probe_results values ('07 cliente registra pendiente y backend marca ready', 'FALLO ' || sqlstate || ': ' || sqlerrm);
end $$;

-- A malformed path must fail before any metadata write.
do $$ declare message text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
    perform api.register_file_object(
      'artifact-files', '91000000-0000-4000-8000-000000000001/artifact/project-1/artifact-1/not-a-version/93000000-0000-4000-8000-000000000001.bin',
      '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
      'application/octet-stream', 10, repeat('a', 64), 'supabase');
    reset role; message := 'FALLO permitido';
  exception when others then reset role; message := case when sqlstate = '22023' then 'OK ' || sqlstate else 'FALLO ' || sqlstate || ': ' || sqlerrm end; end;
  insert into storage_probe_results values ('08 ruta malformada rechazada', message);
end $$;

-- A path owned by another session must fail closed.
do $$ declare message text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
    perform api.register_file_object(
      'artifact-files', '91000000-0000-4000-8000-000000000002/artifact/project-1/artifact-1/v1/93000000-0000-4000-8000-000000000001.bin',
      '93000000-0000-4000-8000-000000000001', 'artifact', 'project-1', 'artifact-1', 1,
      'application/octet-stream', 10, repeat('a', 64), 'supabase');
    reset role; message := 'FALLO permitido';
  exception when others then reset role; message := case when sqlstate = '42501' then 'OK ' || sqlstate else 'FALLO ' || sqlstate || ': ' || sqlerrm end; end;
  insert into storage_probe_results values ('09 ruta de otro propietario rechazada', message);
end $$;

-- Ready objects are not mutable through the Storage table; the RPC is the
-- metadata deletion boundary and the physical upload/delete UAT stays in F7.
do $$
declare
  changed integer;
  deleted integer;
  changed_unregistered integer;
  deleted_unregistered integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  update storage.objects set metadata = metadata where id = '93000000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  begin
    delete from storage.objects where id = '93000000-0000-4000-8000-000000000001';
    get diagnostics deleted = row_count;
  exception when others then
    if sqlstate <> '42501' then raise; end if;
    deleted := 0;
  end;
  update storage.objects set metadata = metadata where id = '93000000-0000-4000-8000-000000000002';
  get diagnostics changed_unregistered = row_count;
  begin
    delete from storage.objects where id = '93000000-0000-4000-8000-000000000002';
    get diagnostics deleted_unregistered = row_count;
  exception when others then
    if sqlstate <> '42501' then raise; end if;
    deleted_unregistered := 0;
  end;
  reset role;
  insert into storage_probe_results values ('10 objetos ready, pending y no registrados no se mutan directamente', case when changed = 0 and deleted = 0 and changed_unregistered = 0 and deleted_unregistered = 0 then 'OK' else 'FALLO ready_update=' || changed || ' ready_delete=' || deleted || ' unregistered_update=' || changed_unregistered || ' unregistered_delete=' || deleted_unregistered end);
exception when others then
  reset role;
  insert into storage_probe_results values ('10 objeto ready no se muta directamente', 'FALLO ' || sqlstate || ': ' || sqlerrm);
end $$;

-- Viewer has no global read capability and cannot register an artifact.
do $$ declare message text; visible_count integer; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002"}', true);
    select count(*) into visible_count from storage.objects;
    if visible_count <> 0 then
      reset role;
      insert into storage_probe_results values ('11 viewer no tiene lectura global ni escritura', 'FALLO visibles=' || visible_count);
      return;
    end if;
    perform api.register_file_object(
      'artifact-files', '91000000-0000-4000-8000-000000000002/artifact/project-2/artifact-2/v1/93000000-0000-4000-8000-000000000002.bin',
      '93000000-0000-4000-8000-000000000002', 'artifact', 'project-2', 'artifact-2', 1,
      'application/octet-stream', 10, repeat('a', 64), 'supabase');
    reset role; message := 'FALLO registro permitido';
  exception when others then reset role; message := case when sqlstate = '42501' then 'OK ' || sqlstate else 'FALLO ' || sqlstate || ': ' || sqlerrm end; end;
  insert into storage_probe_results values ('11 viewer no tiene lectura global ni escritura', message);
end $$;

do $$
declare
  metadata_visible integer;
  objects_visible integer;
begin
  reset role;
  update api.user_profiles set role = 'admin'
  where id = '91000000-0000-4000-8000-000000000002';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002"}', true);
  select count(*) into metadata_visible
  from api.file_objects
  where owner_id = '91000000-0000-4000-8000-000000000001';
  select count(*) into objects_visible from storage.objects;
  reset role;
  insert into storage_probe_results values (
    '13 admin no lee metadata ni objetos de otro propietario',
    case when metadata_visible = 0 and objects_visible = 0 then 'OK' else 'FALLO metadata=' || metadata_visible || ' objetos=' || objects_visible end
  );
end $$;

do $$
declare
  metadata_visible integer;
  objects_visible integer;
begin
  reset role;
  update api.user_profiles set status = 'disabled'
  where id = '91000000-0000-4000-8000-000000000001';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}', true);
  select count(*) into metadata_visible from api.file_objects;
  select count(*) into objects_visible from storage.objects;
  reset role;
  insert into storage_probe_results values (
    '14 cuenta deshabilitada no lee metadata ni objetos',
    case when metadata_visible = 0 and objects_visible = 0 then 'OK' else 'FALLO metadata=' || metadata_visible || ' objetos=' || objects_visible end
  );
end $$;

-- Anonymous access is denied by the restrictive RLS guard, even though the
-- managed Storage owner keeps table grants for the Storage service.
do $$ declare message text; visible_count integer; begin
  begin
    set local role anon;
    select count(*) into visible_count from storage.objects;
    reset role;
    message := case when visible_count = 0 then 'OK filas=0' else 'FALLO filas=' || visible_count end;
  exception when others then
    reset role;
    message := 'FALLO ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into storage_probe_results values ('12 anon no accede a Storage', message);
end $$;

select case when count(*) filter (where result like 'OK%') = count(*) then 'ALL_OK' else 'HAS_FAILURE' end as overall,
       count(*) as cases,
       count(*) filter (where result like 'OK%') as ok_cases
from storage_probe_results;
select case_name, result from storage_probe_results order by case_name;
do $$
declare failures text;
begin
  select string_agg(case_name || ': ' || result, '; ' order by case_name)
    into failures
  from storage_probe_results
  where result not like 'OK%';
  if failures is not null then
    raise exception 'Storage probe failed: %', failures using errcode = 'P0001';
  end if;
end $$;
rollback;
