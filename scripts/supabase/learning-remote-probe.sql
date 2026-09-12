-- Sonda remota F5.6 LMS. Los fixtures se revierten al final.
begin;
create temp table learning_probe_results (caso text primary key, resultado text not null);

insert into auth.users (id, email) values
  ('66000000-0000-4000-8000-000000000001', 'lms-trainer@probe.invalid'),
  ('66000000-0000-4000-8000-000000000002', 'lms-viewer-one@probe.invalid'),
  ('66000000-0000-4000-8000-000000000003', 'lms-viewer-two@probe.invalid');
insert into api.user_profiles (id, role, status) values
  ('66000000-0000-4000-8000-000000000001', 'trainer', 'active'),
  ('66000000-0000-4000-8000-000000000002', 'viewer', 'active'),
  ('66000000-0000-4000-8000-000000000003', 'viewer', 'active');
insert into auth.sessions (id, user_id, not_after) values
  ('76000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001', null),
  ('76000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-000000000002', null),
  ('76000000-0000-4000-8000-000000000003', '66000000-0000-4000-8000-000000000003', null);

-- El formador crea y lee el catálogo transversal; el servidor sobreescribe el userId inyectado.
do $$ declare saved_revision bigint; courses jsonb; owner_id text; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000001"}', true);
  select (api.save_course($json${"id":"lms_course_probe","title":"LMS remoto","description":"Sonda transaccional","icon":"GraduationCap","category":"Architecture","level":"Intermedio","role":"Arquitecto","modules":[],"userId":"forged-user"}$json$::jsonb, 0)).revision into saved_revision;
  select api.list_courses(true) into courses;
  select item -> 'data' ->> 'userId' into owner_id
  from jsonb_array_elements(courses) as item
  where item -> 'data' ->> 'id' = 'lms_course_probe';
  reset role;
  insert into learning_probe_results values ('01 formador guarda y lista catálogo', case when saved_revision = 1 and owner_id is not null then 'OK' else 'FALLO' end);
  insert into learning_probe_results values ('02 servidor normaliza autor', case when owner_id = '66000000-0000-4000-8000-000000000001' then 'OK' else 'FALLO' end);
end $$;

-- La revisión antigua se rechaza en vez de pisar el curso.
do $$ declare state text := 'FALLO: permitido'; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000001"}', true);
    perform api.save_course('{"id":"lms_course_probe","title":"Revisión antigua","description":"x"}'::jsonb, 0);
    reset role;
  exception when others then
    state := case when sqlstate = 'P0001' then 'OK' else 'FALLO: ' || sqlstate end;
  end;
  insert into learning_probe_results values ('03 revisión obsoleta rechazada', state);
end $$;

-- El consumidor no administra el catálogo, pero conserva su propio progreso, contexto y notas.
do $$ declare state text := 'FALLO: permitido'; progress jsonb; context jsonb; notes jsonb; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}', true);
    perform api.save_course('{"id":"lms_viewer_course","title":"No autorizado","description":"x"}'::jsonb, 0);
    reset role;
  exception when others then
    state := case when sqlstate = '42501' then 'OK' else 'FALLO: ' || sqlstate end;
  end;
  insert into learning_probe_results values ('04 consumidor no publica cursos', state);

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}', true);
    perform api.list_courses(true);
    state := 'FALLO: permitido';
    reset role;
  exception when others then
    state := case when sqlstate = '42501' then 'OK' else 'FALLO: ' || sqlstate end;
  end;
  insert into learning_probe_results values ('05 consumidor no lista catálogo transversal', state);

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}', true);
  perform api.save_progress('{"completedLessons":["lesson_1"],"currentLesson":"lesson_2","userId":"forged-user"}'::jsonb);
  perform api.save_context('{"industry":"Seguros","techStack":"React","currentProject":"ARKY"}'::jsonb);
  perform api.save_note('{"id":"lms_note_probe","courseId":"lms_course_probe","lessonId":"lesson_1","tabId":"tab_1","content":"Nota privada","createdAt":0}'::jsonb);
  select api.load_progress(), api.load_context(), api.list_notes() into progress, context, notes;
  reset role;
  insert into learning_probe_results values ('06 consumidor guarda y recupera progreso', case when progress ->> 'currentLesson' = 'lesson_2' and not (progress ? 'userId') then 'OK' else 'FALLO' end);
  insert into learning_probe_results values ('07 consumidor guarda y recupera contexto', case when context ->> 'industry' = 'Seguros' then 'OK' else 'FALLO' end);
  insert into learning_probe_results values ('08 consumidor guarda y recupera nota propia', case when notes -> 0 -> 'data' ->> 'id' = 'lms_note_probe' then 'OK' else 'FALLO' end);
end $$;

-- Otro consumidor no puede obtener ni eliminar el estado del primero.
do $$ declare state text := 'FALLO: permitido'; notes jsonb; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000003"}', true);
  select api.list_notes() into notes;
  reset role;
  insert into learning_probe_results values ('09 otro consumidor no lee notas ajenas', case when jsonb_array_length(notes) = 0 then 'OK' else 'FALLO' end);

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000003"}', true);
    perform api.delete_note('lms_note_probe');
    reset role;
  exception when others then
    state := case when sqlstate = 'P0002' then 'OK' else 'FALLO: ' || sqlstate end;
  end;
  insert into learning_probe_results values ('10 otro consumidor no borra nota ajena', state);
end $$;

-- Los secretos anidados son un contrato de rechazo, no un filtro superficial.
do $$ declare state text := 'FALLO: permitido'; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}', true);
    perform api.save_progress('{"nested":{"apiKey":"never-send"}}'::jsonb);
    reset role;
  exception when others then
    state := case when sqlstate = '22023' then 'OK' else 'FALLO: ' || sqlstate end;
  end;
  insert into learning_probe_results values ('11 secretos anidados rechazados', state);
end $$;

select caso, resultado from learning_probe_results order by caso;
do $$ begin
  if exists (select 1 from learning_probe_results where resultado <> 'OK') then
    raise exception 'La sonda LMS contiene casos fallidos';
  end if;
end $$;
rollback;
