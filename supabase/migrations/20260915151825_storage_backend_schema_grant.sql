-- The trusted backend RPC is not part of the client API, but service_role
-- still needs schema USAGE to invoke it through PostgREST.
begin;
grant usage on schema api to service_role;
commit;
