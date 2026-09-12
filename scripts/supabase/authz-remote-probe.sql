-- Sonda funcional de autorización sobre el proyecto real (PostgreSQL 17).
-- Todo ocurre dentro de una transacción que se revierte: no deja usuarios,
-- perfiles ni auditoría. Cada caso registra su resultado en una tabla temporal
-- para poder leer el veredicto completo de una vez.
begin;

create temp table probe_results (caso text, resultado text);

insert into auth.users (id, email) values
  ('40000000-0000-4000-8000-000000000001', 'super@probe.invalid'),
  ('40000000-0000-4000-8000-000000000002', 'admin@probe.invalid'),
  ('40000000-0000-4000-8000-000000000003', 'arch@probe.invalid'),
  ('40000000-0000-4000-8000-000000000004', 'viewer@probe.invalid'),
  ('40000000-0000-4000-8000-000000000005', 'disabled@probe.invalid');

insert into api.user_profiles (id, role, status) values
  ('40000000-0000-4000-8000-000000000001', 'superadmin', 'active'),
  ('40000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('40000000-0000-4000-8000-000000000003', 'architect', 'active'),
  ('40000000-0000-4000-8000-000000000004', 'viewer', 'active'),
  ('40000000-0000-4000-8000-000000000005', 'admin', 'disabled');

-- Caso 1: cuenta sin perfil falla cerrado.
do $$ declare r boolean; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
  select exists (select 1 from api.current_permissions()) into r;
  reset role;
  insert into probe_results values ('01 sin perfil: cero permisos', case when r is false then 'OK' else 'FALLO' end);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000003', 'viewer');
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('02 sin perfil: no cambia roles', m);
end $$;

-- Caso 3: el observador solo se ve a sí mismo.
do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  select count(*) into n from api.user_profiles;
  reset role;
  insert into probe_results values ('03 viewer ve solo su perfil', case when n = 1 then 'OK' else 'FALLO: ve ' || n end);
end $$;

do $$ declare r boolean; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  select 'portfolio:read' in (select * from api.current_permissions()) into r;
  reset role;
  insert into probe_results values ('04 viewer lee el portafolio', case when r then 'OK' else 'FALLO' end);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000003', 'reviewer');
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('05 viewer no cambia roles', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
    insert into api.user_profiles (id, role) values ('40000000-0000-4000-8000-0000000000ee', 'superadmin');
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('06 viewer no se auto-provisiona', m);
end $$;

-- Caso 7: la cuenta deshabilitada pierde todo.
do $$ declare n int; r boolean; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
  select count(*) into n from api.user_profiles;
  select exists (select 1 from api.current_permissions()) into r;
  reset role;
  insert into probe_results values ('07 deshabilitado: sin filas ni permisos',
    case when n = 0 and r is false then 'OK' else 'FALLO: ' || n || '/' || r end);
end $$;

-- Caso 8: el administrador ve el directorio y cambia roles no privilegiados.
do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  select count(*) into n from api.user_profiles;
  reset role;
  insert into probe_results values ('08 admin ve el directorio', case when n = 5 then 'OK' else 'FALLO: ve ' || n end);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000003', 'reviewer');
    reset role;
    m := 'OK';
  exception when others then m := 'FALLO: ' || sqlstate; end;
  insert into probe_results values ('09 admin cambia rol no privilegiado', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000003', 'admin');
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('10 admin NO concede admin', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000002', 'viewer');
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('11 nadie cambia su propio rol', m);
end $$;

-- Caso 12: el superadministrador sí concede roles administrativos.
do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000003', 'admin');
    reset role;
    m := 'OK';
  exception when others then m := 'FALLO: ' || sqlstate; end;
  insert into probe_results values ('12 superadmin concede admin', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    update api.user_profiles set role = 'viewer' where id = '40000000-0000-4000-8000-000000000003';
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('13 ni superadmin cambia rol por UPDATE', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    update api.user_profiles set display_name = 'Probe' where id = '40000000-0000-4000-8000-000000000001';
    reset role;
    m := 'OK';
  exception when others then m := 'FALLO: ' || sqlstate; end;
  insert into probe_results values ('14 cada quien edita su nombre', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    delete from api.user_profiles where id = '40000000-0000-4000-8000-000000000003';
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('15 el borrado directo está cerrado', m);
end $$;

do $$ declare m text; begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    perform api.set_user_role('40000000-0000-4000-8000-000000000004', 'orquestador');
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('16 rol inventado rechazado', m);
end $$;

-- Caso 17: anónimo no toca nada.
do $$ declare m text; begin
  begin
    set local role anon;
    perform count(*) from api.user_profiles;
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('17 anónimo no lee perfiles', m);
end $$;

do $$ declare m text; begin
  begin
    set local role anon;
    perform count(*) from api.current_permissions();
    reset role;
    m := 'FALLO: permitido';
  exception when others then m := 'OK: ' || sqlstate; end;
  insert into probe_results values ('18 anónimo no lee permisos', m);
end $$;

-- Caso 19: la auditoría registró exactamente los cambios permitidos.
do $$ declare n int; begin
  select count(*) into n from private.authorization_audit;
  insert into probe_results values ('19 auditoría con 2 entradas', case when n = 2 then 'OK' else 'FALLO: ' || n end);
end $$;

select caso, resultado from probe_results order by caso;
rollback;
