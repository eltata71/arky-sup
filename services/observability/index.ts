/**
 * Runtime observability: what the product noticed, and what it told the user.
 *
 * Cross-cutting infrastructure — every context reports through it and it knows
 * about none of them; its only dependency is `lib/errorMessage`. It sat as a
 * loose file at the root of `services/` along with eighteen others, which is
 * what made `services/persistence` and the root form a cycle the moment
 * persistence became a module. A module it always was; it just had no folder.
 */
export * from './browserFailureClassification';
export * from './observabilityService';
