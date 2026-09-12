-- ONLY for the disposable vanilla-Postgres SQL contract harness.
-- These are minimal SQL fixtures for the Auth-facing FK/JWT contract, NOT
-- Supabase Auth, PostgREST, Storage, a managed migration, or an Auth E2E test.
-- Never apply this file to Supabase or an existing database.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create table auth.users (id uuid primary key, email text);
-- Stub de sesiones: el contrato que usa la guarda F4.6 (id, user_id, not_after).
-- En Supabase real la revocación BORRA la fila; no hay columna `revoked`.
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
