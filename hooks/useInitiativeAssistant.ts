/**
 * The two assistants the initiatives board offers (F5-02): the one that drafts
 * an initiative during intake — one agent, one call — and the Office team
 * summoned from a card, framed by the initiative's scope.
 *
 * Two different patterns from two modules (`services/ai` and
 * `services/architectureOffice`), which is why a screen that offered both had
 * to import both. They meet here instead.
 */
import { useCallback } from 'react';
import type { Settings } from '../types';
import type { BusinessInitiative } from '../services/businessInitiatives';
import { initiativeAssistantService, type InitiativeDraft } from '../services/ai';
import { briefInitiative, buildInitiativeScope, type CoordinationScope } from '../services/architectureOffice';

export interface InitiativeAssistant {
  /** Drafts objectives, outcomes, KPIs and risks from a title and a need. */
  draft(input: { title: string; need: string }): Promise<{ draft?: InitiativeDraft; reason?: string }>;
  /**
   * What the Office is told when the team is summoned from a card. The room
   * builds a richer briefing; the essentials frame the request here.
   */
  scopeFor(initiative: BusinessInitiative): CoordinationScope;
}

export const useInitiativeAssistant = (settings: Settings): InitiativeAssistant => {
  const draft = useCallback(
    (input: { title: string; need: string }) =>
      initiativeAssistantService
        .draftInitiative(input, settings)
        .then((result) => ({ draft: result.draft, reason: result.reason })),
    [settings],
  );
  const scopeFor = useCallback(
    (initiative: BusinessInitiative) => buildInitiativeScope(initiative, briefInitiative(initiative)),
    [],
  );
  return { draft, scopeFor };
};
