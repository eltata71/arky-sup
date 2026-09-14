import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260913223956_platform_reference_parameters.sql', import.meta.url),
  'utf8',
);

describe('F5 platform reference parameters migration', () => {
  it('creates a singleton parameter store protected by admin RPCs', () => {
    expect(migration).toContain('create table api.platform_reference_parameters');
    expect(migration).toContain("check (key = 'global')");
    expect(migration).toContain('alter table api.platform_reference_parameters enable row level security');
    expect(migration).toContain('create function api.load_platform_reference_parameters()');
    expect(migration).toContain('create function api.save_platform_reference_parameters(');
    expect(migration).toContain("private.has_permission('users:read')");
    expect(migration).toContain('create function private.contains_platform_secret(p_value jsonb)');
    expect(migration).toContain('not private.contains_platform_secret(data)');
    expect(migration).toContain('private.contains_platform_secret(p_data)');
    expect(migration).toContain('grant execute on function api.load_platform_reference_parameters() to authenticated');
    expect(migration).toContain('grant execute on function api.save_platform_reference_parameters(jsonb, bigint) to authenticated');
  });
});
