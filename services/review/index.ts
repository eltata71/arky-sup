/**
 * Artifact review persistence — public barrel + default wiring.
 *
 * Provides the repository contracts and the local / remote / hybrid
 * implementations, plus `createDefaultReviewRepository` which assembles the
 * hybrid repository used by `artifactReviewService`.
 */

export * from './types';
// H04 (deuda residual R-10): los repositorios local, remoto e híbrido no se
// publican; fuera del módulo sólo se usa el servicio y la fábrica por defecto.

export { createDefaultReviewRepository } from './defaultReviewRepository';
export * from './reviewTransitions';
export * from './ReviewTypes';
export { artifactReviewService } from './artifactReviewService';
