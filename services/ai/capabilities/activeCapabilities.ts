/**
 * activeCapabilities — what the currently configured provider can do.
 *
 * A thin, synchronous read the UI can make while rendering. It builds the
 * provider from the factory rather than guessing from `aiConfig.provider`,
 * so the answer comes from the implementation that would actually serve the
 * request.
 *
 * Falls back to "text only" when the provider cannot be constructed at all
 * (an unregistered id, a missing key). Reporting less than the truth disables
 * a control that might have worked; reporting more offers one that certainly
 * will not, and only the second produces an error the user has to interpret.
 */

import type { Settings } from '../../../types';
import { resolveProviderId } from '../catalog';
import { NO_CAPABILITIES } from '../core/AICapabilities';
import { aiProviderFactory } from '../providers/AIProviderFactory';
import { readCapabilities, type ProviderCapabilities } from './negotiate';

const TEXT_ONLY = (provider: ProviderCapabilities['provider']): ProviderCapabilities => ({
  provider,
  ...NO_CAPABILITIES,
});

/** Capabilities of the provider these settings select. */
export function activeProviderCapabilities(settings?: Settings): ProviderCapabilities {
  const providerId = resolveProviderId(settings);
  if (!settings) return TEXT_ONLY(providerId);
  try {
    return readCapabilities(aiProviderFactory.create({ settings, provider: providerId }));
  } catch {
    return TEXT_ONLY(providerId);
  }
}

/** True when the active provider can generate images. */
export const canGenerateImages = (settings?: Settings): boolean =>
  activeProviderCapabilities(settings).images;

/** True when the active provider can generate speech. */
export const canGenerateSpeech = (settings?: Settings): boolean =>
  activeProviderCapabilities(settings).audio;
