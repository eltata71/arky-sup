/**
 * The picker's side of the portfolio's one resolution rule (F5-02): it left
 * `OfficeCapabilitiesPanel` for `services/portfolioGraph`.
 */
import { describe, expect, it } from 'vitest';
import {
  initiativeLinksFor,
  resolveAttentionInitiativeLinks,
  withoutInitiativeCode,
} from '../../services/portfolioGraph';
import { buildInitiative } from '../../services/businessInitiatives';

const NOW = '2026-09-24T12:00:00.000Z';
const alpha = { ...buildInitiative({ title: 'Alta digital', need: 'Necesidad', code: 'NEG-2026-001' }, 'u', [], NOW), id: 'ini-a' };
const beta = { ...buildInitiative({ title: 'Reclamos', need: 'Necesidad', code: 'NEG-2026-002' }, 'u', [], NOW), id: 'ini-b' };
const initiatives = [alpha, beta];

describe('resolveAttentionInitiativeLinks', () => {
  it('ids win: the code mirror is not consulted when an id exists', () => {
    const state = resolveAttentionInitiativeLinks(
      { initiativeIds: ['ini-b'], linkedBusinessProjects: ['NEG-2026-001'] },
      initiatives,
    );
    expect(state.linkedIds).toEqual(['ini-b']);
  });

  it('a legacy record with only codes is migrated to ids in memory', () => {
    const state = resolveAttentionInitiativeLinks({ linkedBusinessProjects: ['NEG-2026-002'] }, initiatives);
    expect(state.linkedIds).toEqual(['ini-b']);
  });

  it('a well-formed code that matches nothing is reported, never dropped', () => {
    const state = resolveAttentionInitiativeLinks(
      { linkedBusinessProjects: ['NEG-2026-001', 'NEG-2026-099', 'texto libre'] },
      initiatives,
    );
    expect(state.linkedIds).toEqual(['ini-a']);
    expect(state.unresolvedCodes).toEqual(['NEG-2026-099']);
  });
});

describe('the two edits move ids and codes together', () => {
  it('a new selection derives its code mirror from the ids', () => {
    expect(initiativeLinksFor(['ini-a', 'ini-b'], initiatives)).toEqual({
      initiativeIds: ['ini-a', 'ini-b'],
      codes: ['NEG-2026-001', 'NEG-2026-002'],
    });
  });

  it('dropping an unresolved code keeps the selection', () => {
    expect(withoutInitiativeCode({ linkedBusinessProjects: ['NEG-2026-001', 'NEG-2026-099'] }, ['ini-a'], 'NEG-2026-099'))
      .toEqual({ initiativeIds: ['ini-a'], codes: ['NEG-2026-001'] });
  });
});
