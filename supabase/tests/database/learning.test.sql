begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'lms_courses', 'El corte de aprendizaje tiene tabla de cursos');
select has_table('api', 'lms_progress', 'El corte de aprendizaje tiene tabla de progreso');
select has_table('api', 'lms_context', 'El corte de aprendizaje tiene tabla de contexto');
select has_table('api', 'lms_notes', 'El corte de aprendizaje tiene tabla de notas');
select ok((select relrowsecurity from pg_class where oid = 'api.lms_courses'::regclass), 'Cursos tienen RLS');
select ok((select relrowsecurity from pg_class where oid = 'api.lms_progress'::regclass), 'Progreso tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'api.lms_context'::regclass), 'Contexto tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'api.lms_notes'::regclass), 'Notas tienen RLS');
select ok(not has_table_privilege('authenticated', 'api.lms_courses', 'INSERT'), 'El cliente no escribe cursos directos');
select ok(not has_table_privilege('authenticated', 'api.lms_progress', 'INSERT'), 'El cliente no escribe progreso directo');
select ok(not has_table_privilege('authenticated', 'api.lms_context', 'INSERT'), 'El cliente no escribe contexto directo');
select ok(not has_table_privilege('authenticated', 'api.lms_notes', 'INSERT'), 'El cliente no escribe notas directas');
select ok(has_function_privilege('authenticated', 'api.list_courses(boolean)', 'EXECUTE'), 'El cliente recibe listado de cursos');
select ok(has_function_privilege('authenticated', 'api.save_course(jsonb,bigint)', 'EXECUTE'), 'El cliente recibe guardado de curso');
select ok(has_function_privilege('authenticated', 'api.save_progress(jsonb)', 'EXECUTE'), 'El cliente recibe guardado de progreso');
select ok(has_function_privilege('authenticated', 'api.save_context(jsonb)', 'EXECUTE'), 'El cliente recibe guardado de contexto');
select ok(has_function_privilege('authenticated', 'api.list_notes()', 'EXECUTE'), 'El cliente recibe listado de notas');
select ok(has_function_privilege('authenticated', 'api.save_note(jsonb)', 'EXECUTE'), 'El cliente recibe guardado de nota');

insert into auth.users (id, email) values
  ('65000000-0000-4000-8000-000000000001', 'trainer@example.invalid'),
  ('65000000-0000-4000-8000-000000000002', 'viewer-one@example.invalid'),
  ('65000000-0000-4000-8000-000000000003', 'viewer-two@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('65000000-0000-4000-8000-000000000001', 'trainer', 'active'),
  ('65000000-0000-4000-8000-000000000002', 'viewer', 'active'),
  ('65000000-0000-4000-8000-000000000003', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('75000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', null),
  ('75000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000002', null),
  ('75000000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';
select is((select (api.save_course($json$
{
  "id": "crs_001", "title": "Curso de prueba", "description": "Desc",
  "icon": "GraduationCap", "category": "Architecture", "level": "Intermedio",
  "role": "Arquitecto de Soluciones", "modules": [], "userId": "forged-user"
}$json$::jsonb, 0)).revision), 1::bigint, 'El formador guarda un curso con revisión inicial');
select is((select api.list_courses(true) -> 0 -> 'data' ->> 'userId'),
  '65000000-0000-4000-8000-000000000001', 'El servidor normaliza el autor del curso a la sesión');
select throws_ok($$select api.save_course('{"id":"crs_001","title":"x","description":"x"}'::jsonb, 99)$$,
  'P0001', 'Conflicto de curso: recarga antes de guardar', 'Revisión obsoleta rechaza curso');
select throws_ok($$select api.save_course('{"id":"crs_secret","title":"x","description":"x","nested":{"apiKey":"never-send"}}'::jsonb, 0)$$,
  '22023', 'El curso no tiene una forma válida', 'La RPC rechaza secretos anidados');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.save_course('{"id":"crs_viewer","title":"x","description":"x"}'::jsonb, 0)$$,
  '42501', 'Permiso insuficiente: training:author', 'Un consumidor no publica cursos');
select throws_ok($$select api.list_courses(true)$$,
  '42501', 'Permiso insuficiente: training:analytics', 'Un consumidor no lee el catálogo transversal');
select lives_ok($$select api.save_progress('{"completedLessons":["lesson_1"],"currentLesson":"lesson_2","userId":"forged-user"}'::jsonb)$$,
  'El consumidor guarda su progreso');
select is((select api.load_progress() ->> 'currentLesson'), 'lesson_2', 'El consumidor lee su propio progreso');
select is((select api.load_progress() ? 'userId'), false, 'El servidor no persiste un userId inyectado en progreso');
select throws_ok($$select api.save_progress('{"nested":{"apiKey":"never-send"}}'::jsonb)$$,
  '22023', 'El progreso rechaza secretos anidados');
select lives_ok($$select api.save_context('{"industry":"Seguros","techStack":"React","currentProject":"ARKY"}'::jsonb)$$,
  'El consumidor guarda su contexto');
select is((select api.load_context() ->> 'industry'), 'Seguros', 'El consumidor lee su propio contexto');
select lives_ok($$select api.save_note('{"id":"note_001","courseId":"crs_001","lessonId":"lesson_1","tabId":"tab_1","content":"Nota","createdAt":0}'::jsonb)$$,
  'El consumidor guarda una nota');
select is((select api.list_notes() -> 0 -> 'data' ->> 'id'), 'note_001', 'El listado devuelve la nota propia');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000003"}';
select throws_ok($$select api.load_progress()$$,
  'P0002', 'El progreso no existe', 'Otro usuario no lee el progreso ajeno');
select is((select jsonb_array_length(api.list_notes())), 0::bigint, 'Otro usuario no lee notas ajenas');
select throws_ok($$select api.delete_note('note_001')$$,
  'P0002', 'La nota no existe o es ajena', 'Otro usuario no borra la nota ajena');
reset role;

select * from finish();
rollback;
