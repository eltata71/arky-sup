/** The model id a tier resolves to for these settings; loads the catalog on demand. */
export async function resolveTierModelId(
  tier: import('../../../lib/ai/modelCatalog').ModelTier,
  settings: import('../../../types').Settings,
): Promise<string> {
  const { resolveModelForSettings } = await import('../catalog');
  return resolveModelForSettings(tier, settings).id;
}
