-- F5 reparación aditiva: el guard de secretos debe admitir todo escalar JSON.
-- La versión inicial no tenía rama ELSE y fallaba sobre booleanos/números.
begin;

create or replace function private.contains_platform_secret(p_value jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  entry record;
  text_value text;
  normalized_key text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      for entry in select key, value from jsonb_each(p_value) loop
        normalized_key := lower(replace(replace(entry.key, '_', ''), '-', ''));
        if normalized_key in ('apikey', 'clientsecret', 'secret', 'token', 'credential', 'password')
          or private.contains_platform_secret(entry.value) then
          return true;
        end if;
      end loop;
    when 'array' then
      for entry in select value from jsonb_array_elements(p_value) loop
        if private.contains_platform_secret(entry.value) then
          return true;
        end if;
      end loop;
    when 'string' then
      text_value := p_value #>> '{}';
      return text_value ~ 'AIza[0-9A-Za-z_-]{35}'
        or text_value ~ 'sk-or-v1-[0-9a-f]{64}'
        or text_value ~ 'sk-ant-[A-Za-z0-9_-]{24,}'
        or text_value ~ 'sk-[A-Za-z0-9]{32,}'
        or text_value ~ '-----BEGIN [A-Z ]*PRIVATE KEY-----';
    else
      return false;
  end case;
  return false;
end;
$$;

revoke all on function private.contains_platform_secret(jsonb) from public, anon, authenticated, service_role;
commit;
