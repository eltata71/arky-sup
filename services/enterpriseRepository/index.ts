/**
 * Enterprise inventory (11.2, R-17 option A: per user).
 * Applications, capabilities and technologies the organisation has, which the
 * projects' knowledge graphs reference by id. Domain + repository + the
 * assisted promotion (a proposal; nothing is unified without a human click).
 */
export * from './domain';
export {
  listInventory,
  saveInventoryItem,
  deleteInventoryItem,
  clearInventoryCache,
} from './infrastructure/InventoryRepository';
export {
  proposePromotions,
  acceptPromotion,
  inventoryKindForEntityType,
  type PromotableEntity,
  type PromotionProposal,
  type PromotionPlan,
  type EntityReference,
  type ProposePromotionsOptions,
} from './application/inventoryPromotion';
export {
  buildCapabilityMap,
  flattenCapabilityMap,
  CAPABILITY_LAYERS,
  COVERAGE_SATURATION,
  type CapabilityLayer,
  type CapabilityMap,
  type CapabilityNode,
  type CapabilityMapIssue,
  type InitiativesByProject,
  type LayerValue,
} from './application/capabilityMap';
export { buildCapabilityExportRows, type CapabilityExportRow } from './application/capabilityMapExport';
export {
  analyzeGaps,
  type GapPlanPort,
  type GapAction,
  type GapChange,
  type GapEntry,
  type GapIssue,
  type GapAnalysis,
} from './application/gapAnalysis';
export {
  classifyTime,
  buildApplicationPortfolio,
  TIME_QUADRANTS,
  TIME_HIGH_THRESHOLD,
  type TimeQuadrant,
  type ApplicationTimeEntry,
  type ApplicationPortfolio,
} from './application/timeClassification';
export {
  buildTechnologyRadar,
  type RadarStandard,
  type TechnologyRadar,
  type TechnologyRadarEntry,
} from './application/technologyRadar';
