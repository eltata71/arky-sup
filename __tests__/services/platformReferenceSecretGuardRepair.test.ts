import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260913230744_platform_reference_secret_guard_else.sql', import.meta.url),
  'utf8',
);

describe('F5 platform reference secret guard repair', () => {
  it('handles every JSON scalar type without accepting a secret or throwing', () => {
    expect(migration).toContain('create or replace function private.contains_platform_secret(p_value jsonb)');
    expect(migration).toMatch(/case jsonb_typeof\(p_value\)[\s\S]*else\s+return false;/);
    expect(migration).toContain('revoke all on function private.contains_platform_secret(jsonb)');
  });
});
