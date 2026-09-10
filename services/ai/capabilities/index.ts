/**
 * `services/ai/capabilities` — what a provider can and cannot do for a request.
 *
 * Use `negotiateOrThrow` before dispatching. Degradation is fine; degrading
 * without saying so is the defect this module exists to prevent, and degrading
 * a `required` capability is not degradation at all — it is answering a
 * different question from the one that was asked.
 */

export {
  assertRequiredCapabilities,
  gapsFor,
  negotiateAndReport,
  negotiateCapabilities,
  negotiateOrThrow,
  readCapabilities,
  reportCapabilityGaps,
  type CapabilityGap,
  type ProviderCapabilities,
} from './negotiate';

export {
  activeProviderCapabilities,
  canGenerateImages,
  canGenerateSpeech,
} from './activeCapabilities';
