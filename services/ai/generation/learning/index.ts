/**
 * `learning/` — the LMS capability, outside the legacy monolith.
 *
 * The first vertical of the strangler migration. `learningService` is the
 * façade callers use; these modules are its implementation.
 */

export * from './learningTypes';
export * from './courseAuthoring';
export * from './lessonDelivery';
export * from './diagramChallenge';
