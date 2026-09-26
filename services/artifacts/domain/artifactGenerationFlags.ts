const isEnabled = (value: unknown, defaultValue: boolean): boolean => {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return defaultValue;
};

export interface ArtifactGenerationFeatureFlags {
  structuredBrief: boolean;
  aiBriefExtraction: boolean;
  top3Recommendations: boolean;
}

export const getArtifactGenerationFeatureFlags = (): ArtifactGenerationFeatureFlags => ({
  structuredBrief: isEnabled(import.meta.env?.VITE_STRUCTURED_ARTIFACT_BRIEF_ENABLED, true),
  aiBriefExtraction: isEnabled(import.meta.env?.VITE_AI_BRIEF_EXTRACTION_ENABLED, false),
  top3Recommendations: isEnabled(import.meta.env?.VITE_TOP3_ARTIFACT_RECOMMENDATIONS_ENABLED, true),
});

export const __test__parseArtifactGenerationFlag = isEnabled;
