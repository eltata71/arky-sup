-- F6-10 · El despliegue comprueba que producción tiene el esquema del commit.
--
-- `ci.yml` publica la aplicación y no el esquema: las migraciones se aplican a
-- mano, con aprobación (docs/operacion/runbook-migraciones.md). Una que llegó
-- tarde rompió producción una vez (F4-06). Decisión del propietario,
-- 2026-09-26, opción B: el despliegue pregunta, antes de construir, si cada
-- migración del repositorio está aplicada, y se detiene si falta alguna.
--
-- La pregunta la hace sin credenciales, con la clave publicable. Por eso la
-- función vive en un esquema propio, `deploy_status`, que contiene **sólo**
-- ella: `api` y `public` siguen cerrados a anónimos, como afirman
-- `platform_foundation` e `identity_authorization`. Lo que revela es un sí o
-- un no sobre una versión que quien pregunta ya conoce, porque las versiones
-- están en el repositorio. Nunca la lista ni el esquema.
--
-- Reversión:
--   drop schema deploy_status cascade;
--   alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api';
--   notify pgrst, 'reload config';
begin;

create schema deploy_status;
comment on schema deploy_status is
  'Sólo la sonda del despliegue: ¿está aplicada esta migración? Nada más vive aquí (F6-10).';

create function deploy_status.migration_applied(p_version text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_version is null or p_version !~ '^[0-9]{14}$' then
    raise exception 'La versión de migración son 14 dígitos' using errcode = '22023';
  end if;
  return exists (
    select 1 from supabase_migrations.schema_migrations where version = p_version
  );
end;
$$;
comment on function deploy_status.migration_applied(text) is
  'Sí o no: ¿está aplicada la migración con esta versión? La llama el despliegue antes de publicar (F6-10).';

revoke all on schema deploy_status from public, anon, authenticated, service_role;
revoke all on function deploy_status.migration_applied(text) from public, anon, authenticated, service_role;
grant usage on schema deploy_status to anon, authenticated;
grant execute on function deploy_status.migration_applied(text) to anon, authenticated;

-- PostgREST sólo sirve los esquemas de esta lista. Es el mismo mecanismo que
-- `20260919045700_data_api_exposed_schemas`; cambiar «Exposed schemas» desde el
-- panel reescribe esta configuración (CLAUDE.md, *Desplegar el esquema*).
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api, deploy_status';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
