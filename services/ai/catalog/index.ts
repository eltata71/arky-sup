/**
 * `services/ai/catalog` — per-provider model spaces.
 *
 * Turn a tier into a model id with `resolveModelForSettings`. Nothing outside
 * a provider should name a concrete model.
 */

export {
  resolveInCatalog,
  type CatalogResolution,
  type ProviderModelCatalog,
} from './ProviderModelCatalog';

export {
  catalogFor,
  catalogForSettings,
  anthropicCatalog,
  geminiCatalog,
  openRouterCatalog,
  proxyProviderFor,
  registerCatalog,
  registeredCatalogProviders,
  resolveModelForSettings,
  resolveProviderId,
} from './catalogs';
