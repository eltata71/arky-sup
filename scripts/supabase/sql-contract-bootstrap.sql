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
-- Harness-only minimal Storage surface so Storage migrations apply on vanilla
-- PostgreSQL. This is NOT the Supabase Storage platform (no API, no Auth
-- integration, no background workers): only the columns our migrations and
-- contracts touch (buckets id/name/public/file_size_limit/allowed_mime_types;
-- objects id/bucket_id/name/owner/owner_id/metadata/version/is_delete_marker/
-- is_versioned), with RLS enabled and no policies. Platform truth (verified
-- against the linked project catalog): storage.objects.owner is uuid and
-- owner_id is text. Migrations add the PoC policies. Never apply this stub
-- to Supabase or an existing database.
create schema storage authorization postgres;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit integer,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id) on delete restrict,
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb,
  version text,
  is_delete_marker boolean not null default false,
  is_versioned boolean not null default false
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
-- Platform truth: the managed Storage schema is usable by clients (policies
-- and RLS decide rows, not schema reachability).
grant usage on schema storage to anon, authenticated, service_role;
