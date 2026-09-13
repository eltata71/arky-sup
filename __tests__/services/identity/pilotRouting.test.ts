import { describe, expect, it } from 'vitest';
import { isSupabasePilotEmail, parseSupabasePilotEmails } from '../../../services/identity/pilotRouting';

describe('Supabase pilot routing', () => {
  it('normalizes the explicit cohort without accepting blanks or duplicates', () => {
    expect(parseSupabasePilotEmails(' tataarky@gmail.com, TATAARKY@gmail.com, , piloto@example.com ')).toEqual([
      'tataarky@gmail.com',
      'piloto@example.com',
    ]);
  });

  it('routes only the listed address to Supabase', () => {
    const cohort = parseSupabasePilotEmails('tataarky@gmail.com');
    expect(isSupabasePilotEmail(' TATAARKY@gmail.com ', cohort)).toBe(true);
    expect(isSupabasePilotEmail('other@example.com', cohort)).toBe(false);
    expect(isSupabasePilotEmail(null, cohort)).toBe(false);
  });
});
