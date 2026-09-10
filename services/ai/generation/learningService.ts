/**
 * learningService — domain entry point for the Training Center (LMS).
 *
 * Course authoring, lesson delivery, role diagnostics and the diagram
 * challenges. Kept separate from `assistantService` because the LMS has its own
 * tutor persona and its own quality expectations, and mixing the two surfaces
 * would make that distinction invisible at the call site.
 *
 * The LMS capability no longer lives in the legacy engine: it was the first
 * vertical of the strangler migration and now sits in `./learning`. The façade
 * did not change shape when that happened, which is the point of having one —
 * every call site kept working while 451 lines moved out of a 6.700-line file.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import * as learning from './learning';
import type { ChallengeEvaluation } from './learning/learningTypes';
import type { Settings } from '../../../types';
import { geminiService } from '../../geminiService';

export const learningService = {
  /** Tutor turn inside a lesson. */
  get chatWithLesson() {
    return learning.chatWithLesson;
  },
  /** Generate a full course syllabus. */
  get generateCourseSyllabus() {
    return learning.generateCourseSyllabus;
  },
  /** Generate the content of one lesson tab. */
  get generateLessonTabContent() {
    return learning.generateLessonTabContent;
  },
  /** Generate long-form masterclass content. */
  get generateMasterclassContent() {
    return learning.generateMasterclassContent;
  },
  /** Generate a masterclass for a whole category. */
  get generateCategoryMasterclass() {
    return learning.generateCategoryMasterclass;
  },
  /** Generate the catalog of learning roles. */
  get generateRoleCatalog() {
    return learning.generateRoleCatalog;
  },
  /** Generate a diagnostic for a chosen role. */
  get generateRoleDiagnostic() {
    return learning.generateRoleDiagnostic;
  },
  /** Generate dynamic topics for a learning path. */
  get generateDynamicTopics() {
    return learning.generateDynamicTopics;
  },
  /** Generate a diagram challenge. */
  get generateDiagramChallenge() {
    return learning.generateDiagramChallenge;
  },
  /** Evaluate a submitted diagram challenge. */
  get evaluateDiagramChallenge() {
    return learning.evaluateDiagramChallenge;
  },
  /**
   * Evaluate a submitted generic challenge.
   *
   * Still served by the legacy engine, and the only member whose type is
   * declared here rather than inherited: the engine's method returns
   * `Promise<any>`, and letting that reach the caller would put the looseness
   * in a screen instead of in the module that owns it.
   */
  get evaluateChallenge(): (
    challenge: string,
    responseText: string,
    settings: Settings,
  ) => Promise<ChallengeEvaluation> {
    return geminiService.evaluateChallenge.bind(geminiService);
  },
} as const;

export type LearningService = typeof learningService;
