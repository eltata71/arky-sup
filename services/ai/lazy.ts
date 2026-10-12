/**
 * The AI layer, on first use (12.7, R-09).
 *
 * A screen that names `services/ai` in a static import downloads the whole
 * layer — the engine, the providers, the Gemini SDK — when the *route* opens,
 * even if the person never asks the assistant anything. Here every service is
 * a proxy: calling a method imports the layer then, once, and forwards the
 * call. What a caller gets back is the same value as through the barrel, one
 * promise later.
 *
 * Only the synchronous values screens need (error classes, the cooldown, the
 * LMS guards, the context and prompt builders) are re-exported from their own
 * small files; none of them reaches the engine.
 */
import type * as AiBarrel from './index';

export {
  AIServiceError,
  C4SelfHealingError,
  classifyAIError,
} from './errors/aiServiceError';
export { getAiBlockingCooldownRemainingMs } from './callControl/aiCallControlService';
export { buildBasePrompt } from './prompts/projectPrompts';
export { assembleArtifactContext, bundleItems } from './prompts/artifactContext';
export { renderArtifactContextBundle } from './prompts/artifactContextRender';
export { buildBusinessMotivationBlock } from './prompts/diagramGenerationBrief';
export { captureArtifactContext } from './prompts/contextManifestCapture';
export {
  asCourseCategory,
  asCourseLevel,
  isQuizQuestion,
  isRelatedConcept,
} from './generation/learning/learningTypes';

type Barrel = typeof AiBarrel;

export type LazyService<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T[K];
};

let layer: Promise<Barrel> | null = null;
const loadAiLayer = (): Promise<Barrel> => {
  layer ??= import('./index').catch((error: unknown) => {
    layer = null;
    throw error;
  });
  return layer;
};

function lazyService<K extends keyof Barrel>(name: K): LazyService<Barrel[K]> {
  const calls = new Map<string | symbol, unknown>();
  return new Proxy({} as LazyService<Barrel[K]>, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      let call = calls.get(prop);
      if (!call) {
        call = async (...args: unknown[]) => {
          const service = (await loadAiLayer())[name] as unknown as Record<string | symbol, (...a: unknown[]) => unknown>;
          return service[prop](...args);
        };
        calls.set(prop, call);
      }
      return call;
    },
  });
}

/** Async on purpose: the instruction pulls the project prompt builders, which a route should not download until a turn is asked. */
export async function buildProjectChatInstruction(
    ...args: Parameters<typeof import('./generation/assistant/projectChatInstruction').buildProjectChatInstruction>
): Promise<string> {
    const { buildProjectChatInstruction: build } = await import('./generation/assistant/projectChatInstruction');
    return build(...args);
}
export const aiGateway = lazyService('aiGateway');
export const artifactGenerationService = lazyService('artifactGenerationService');
export const assistantService = lazyService('assistantService');
export const captureAssistantService = lazyService('captureAssistantService');
export const diagramEditService = lazyService('diagramEditService');
export const diagramGenerationService = lazyService('diagramGenerationService');
export const documentEditService = lazyService('documentEditService');
export const documentGenerationService = lazyService('documentGenerationService');
export const initiativeAssistantService = lazyService('initiativeAssistantService');
export const learningService = lazyService('learningService');
export const platformGuideService = lazyService('platformGuideService');
export const recommendationService = lazyService('recommendationService');

export const compactChatMessages = async (
  ...args: Parameters<Barrel['compactChatMessages']>
): Promise<Awaited<ReturnType<Barrel['compactChatMessages']>>> =>
  (await loadAiLayer()).compactChatMessages(...args);

export const sendGuidedProjectCreationMessage = async (
  ...args: Parameters<Barrel['sendGuidedProjectCreationMessage']>
): Promise<Awaited<ReturnType<Barrel['sendGuidedProjectCreationMessage']>>> =>
  (await loadAiLayer()).sendGuidedProjectCreationMessage(...args);
