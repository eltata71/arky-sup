import { describe, expect, it } from 'vitest';
import { isSupabasePilotEmail, parseSupabasePilotEmails } from '../../../services/identity/pilotRouting';
import { shouldUseSupabaseLearningBackend } from '../../../services/learning/pilotLearningService';

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

  it('routes LMS with the same normalized cohort as identity', () => {
    expect(shouldUseSupabaseLearningBackend(
      ' PILOT@example.com ',
      { VITE_BACKEND_LEARNING: 'supabase', VITE_SUPABASE_PILOT_EMAILS: ' Pilot@Example.com ' },
    )).toBe(true);
  });
});
