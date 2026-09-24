/**
 * The initiatives an attention is linked to, as the picker edits them (F5-02).
 *
 * `OfficeCapabilitiesPanel` wrote this rule inside a `useMemo` — «doing it here
 * too keeps the picker showing what the rest of the app already believes» —
 * which is exactly how a second definition of the portfolio's one resolution
 * rule starts: ids win, and a legacy `NEG-YYYY-NNN` code is honoured only while
 * no id exists. It lives here, beside `codesForInitiativeIds`, so the panel and
 * the resolver cannot drift apart.
 */
import { isInitiativeCode } from '../../lib/eaTerminology';
import type { BusinessInitiative } from '../businessInitiatives/domain';
import { codesForInitiativeIds } from './portfolioResolver';

/** What the picker needs from an attention: its two halves of the relation. */
export interface AttentionInitiativeLinkSource {
  readonly initiativeIds?: readonly string[];
  readonly linkedBusinessProjects?: readonly string[];
}

/** Both halves of the relation, always written together. */
export interface InitiativeLinks {
  readonly initiativeIds: string[];
  readonly codes: string[];
}

export interface AttentionInitiativeLinkState {
  /** The ids the picker shows as selected. */
  readonly linkedIds: string[];
  /** Well-formed codes that match no initiative: reported, never dropped. */
  readonly unresolvedCodes: string[];
}

export const resolveAttentionInitiativeLinks = (
  attention: AttentionInitiativeLinkSource,
  initiatives: readonly BusinessInitiative[],
): AttentionInitiativeLinkState => {
  const codes = attention.linkedBusinessProjects ?? [];
  const stored = attention.initiativeIds ?? [];
  const byCode = new Map<string, string>(
    initiatives.filter((item) => item.code).map((item) => [item.code, item.id]),
  );
  const linkedIds = stored.length > 0
    ? [...stored]
    : codes.map((code) => byCode.get(code)).filter((id): id is string => Boolean(id));
  const unresolvedCodes = codes.filter((code) => isInitiativeCode(code) && !byCode.has(code));
  return { linkedIds, unresolvedCodes };
};

/** The links for a new selection: the ids, and the code mirror derived from them. */
export const initiativeLinksFor = (
  initiativeIds: readonly string[],
  initiatives: readonly BusinessInitiative[],
): InitiativeLinks => ({
  initiativeIds: [...initiativeIds],
  codes: codesForInitiativeIds(initiativeIds, initiatives),
});

/** Drops one unresolved code, keeping the ids the picker shows. */
export const withoutInitiativeCode = (
  attention: AttentionInitiativeLinkSource,
  linkedIds: readonly string[],
  code: string,
): InitiativeLinks => ({
  initiativeIds: [...linkedIds],
  codes: (attention.linkedBusinessProjects ?? []).filter((current) => current !== code),
});
