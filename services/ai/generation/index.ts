/**
 * `services/ai/generation` — domain-level AI generation façades.
 *
 * These services separate *what to generate* (domain) from *how to talk to a
 * provider* (the `core` + `providers` layers). They are the canonical import
 * surface for the UI and other services.
 */

export { artifactGenerationService } from './artifactGenerationService';
export type { ArtifactGenerationService } from './artifactGenerationService';
export type {
  ArtifactContentGenerationOptions,
  ArtifactGenerationSupport,
  ControlledGenerationContext,
} from './artifacts/artifactGenerationSupport';
export { documentGenerationService } from './documentGenerationService';
export type { DocumentGenerationService } from './documentGenerationService';
export { diagramGenerationService } from './diagramGenerationService';
export type { DiagramGenerationService } from './diagramGenerationService';
export { assistantService } from './assistantService';
export type {
  AgentFunctionCall,
  AgentModelTurn,
  AgentTurnRequest,
  AgentTurnResult,
  AssistantService,
  ProjectChatReplyRequest,
  ProjectChatTurn,
} from './assistantService';
export { learningService } from './learningService';
export type { LearningService } from './learningService';
// The shapes the LMS generators return, and the two coercions that turn a
// model's free text into the domain's unions. The screens that build a
// `Course` out of a proposal need both.
export {
  asCourseCategory,
  asCourseLevel,
  isQuizQuestion,
  isRelatedConcept,
} from './learning/learningTypes';
export type {
  ChallengeEvaluation,
  GeneratedCourse,
  GeneratedLesson,
  GeneratedModule,
  GeneratedTopic,
  QuizQuestion,
  RelatedConcept,
  TopicFilters,
} from './learning/learningTypes';
export { aiGateway } from './aiGateway';
export type { AIGateway } from './aiGateway';
export { recommendationService } from './recommendationService';
export type { RecommendationService } from './recommendationService';
export { captureAssistantService } from './capture/captureAssistantService';
export { diagramEditService, MAX_PATCH_OPERATIONS } from './diagramEdit/diagramEditService';
export type { DiagramEditRequest, DiagramEditResult, DiagramEditService } from './diagramEdit/diagramEditService';
export type { CaptureAssistantService } from './capture/captureAssistantService';
export { platformGuideService } from './platformGuide/platformGuideService';
export type { PlatformGuideService } from './platformGuide/platformGuideService';
export { initiativeAssistantService } from './initiativeAssistantService';
export type {
  InitiativeAssistantService,
  InitiativeDraft,
  InitiativeDraftResult,
} from './initiativeAssistantService';
export { listModelsForProvider, type AIModelOption, type ListModelsOptions } from './providerModelDirectory';
