import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260920224928_phase_2_governance_guards.sql'),
  'utf8',
).toLowerCase();
const canonicalDecisionMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260921060000_canonicalize_arb_decision_evidence.sql'),
  'utf8',
).toLowerCase();

describe('cierre técnico de la fase 2', () => {
  it('F2-02 hace explícita la matriz y reserva delivered a decide_engagement', () => {
    expect(migration).toContain('create or replace function private.office_engagement_transition_allowed');
    expect(migration).toContain("next_status = 'delivered'");
    expect(migration).toContain('use api.decide_engagement');
    expect(migration).toContain('private.office_engagement_transition_allowed(previous_status, next_status)');
  });

  it('F2-03 ofrece una bandeja ARB ajena y prohíbe la autoaprobación', () => {
    expect(migration).toContain('create or replace function api.load_arb_engagements()');
    expect(migration).toContain('e.owner_id <> actor');
    expect(migration).toContain('current_row.owner_id = actor');
    expect(migration).toContain('el autor no puede decidir su propio encargo');
  });

  it('F2-03 canoniza la evidencia ARB en el servidor', () => {
    expect(canonicalDecisionMigration).toContain("select coalesce(display_name, actor::text), role");
    expect(canonicalDecisionMigration).toContain("gate_status := coalesce(current_row.data #>> '{gateassessment,overallstatus}', 'conditional')");
    expect(canonicalDecisionMigration).toContain("'previousstatus', previous_status");
    expect(canonicalDecisionMigration).toContain("'decidedat', now()");
    expect(canonicalDecisionMigration).toContain("verdict = 'approved' and gate_status = 'blocked'");
    expect(canonicalDecisionMigration).toContain('exact already-persisted aggregate is returned');
    expect(canonicalDecisionMigration).toContain('canonical_decision');
    expect(canonicalDecisionMigration).not.toContain('current_row.owner_id, p_decision, current_row.revision');
    expect(canonicalDecisionMigration).not.toContain("jsonb_set(next_data, '{audittrail}'");
  });

  it('F2-09 retira las cuatro concesiones sin consumidor', () => {
    for (const signature of [
      'api.record_arb_decision(jsonb)',
      'api.load_platform_reference_parameters()',
      'api.save_platform_reference_parameters(jsonb, bigint)',
      'api.mark_file_object_deleted(uuid)',
    ]) {
      expect(migration).toContain(`revoke all on function ${signature}`);
    }
  });
});
