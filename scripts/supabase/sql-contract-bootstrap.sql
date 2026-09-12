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
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
