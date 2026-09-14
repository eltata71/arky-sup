import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260913232706_platform_reference_pii_and_initial_revision_guard.sql', import.meta.url),
  'utf8',
);

describe('F5 platform reference PII and initial revision repair', () => {
  it('adds a recursive PII guard to the stored data and save RPC', () => {
    expect(migration).toContain('create or replace function private.contains_platform_pii(p_value jsonb)');
    expect(migration).toContain('add constraint platform_reference_parameters_no_pii');
    expect(migration).toContain('not private.contains_platform_pii(data)');
    expect(migration).toContain('private.contains_platform_pii(p_data)');
  });

  it('requires expected revision zero when the singleton does not exist', () => {
    expect(migration).toContain("p_expected_revision is distinct from 0");
    expect(migration).toContain("Conflicto de parámetros globales: recarga antes de guardar");
  });
});
