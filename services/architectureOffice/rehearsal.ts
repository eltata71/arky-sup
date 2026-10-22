/**
 * El ensayo de la ficha — a small door (16.6).
 *
 * `AgentRehearsalSection` loads the service with `import()` so `/agents` does
 * not download the AI layer until someone asks to see the prompt or rehearse;
 * the types and the pure sample questions are all it needs eagerly.
 */
export { sampleQuestionsFor, createDraftAgentRehearsal } from './application/draftAgentRehearsal';
export type {
  DraftAgentProfileState,
  DraftAgentRehearsalService,
  EffectiveInstructionPreview,
  RehearsalResult,
  RehearsalSampleQuestion,
} from './application/draftAgentRehearsal';
