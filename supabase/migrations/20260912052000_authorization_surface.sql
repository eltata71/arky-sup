-- F4.2 (continuación) — superficie de lectura de permisos y RLS de la matriz.
--
-- Dos correcciones que la verificación sobre PostgreSQL 17 real puso en
-- evidencia:
--
-- 1. `private.role_permissions` quedó sin RLS en la migración anterior. No es
--    alcanzable por clientes (sin USAGE ni grants), pero el resto de tablas
--    privadas sí lo activan y una tabla sin RLS es un grant equivocado de
--    distancia. Se activa con FORCE: el helper la lee como propietario con
--    BYPASSRLS, así que no se bloquea a sí mismo.
-- 2. Un cliente NO puede llamar `private.has_permission(...)`: no tiene USAGE
--    sobre el esquema `private`, y eso es deliberado (una política sí puede
--    invocarlo, porque su expresión está ya resuelta). Consecuencia práctica:
--    la interfaz no tenía forma de conocer sus permisos efectivos desde el
--    servidor. `api.current_permissions()` cierra ese hueco sin abrir el
--    esquema privado: devuelve únicamente los permisos del propio llamante.
begin;

alter table private.role_permissions enable row level security;
alter table private.role_permissions force row level security;

create function api.current_permissions() returns setof text
language sql stable security definer set search_path = '' as $$
  select rp.permission
  from private.role_permissions rp
  where rp.role = private.current_role()
$$;
comment on function api.current_permissions() is
  'Permisos efectivos del llamante, resueltos en el servidor. Nunca revela los de otro usuario ni los de una cuenta deshabilitada.';

-- La firma por defecto ya los revoca; se declara explícito para que la
-- superficie quede escrita y no inferida.
revoke all on function api.current_permissions() from public, anon, service_role;
grant execute on function api.current_permissions() to authenticated;

notify pgrst, 'reload schema';
commit;
