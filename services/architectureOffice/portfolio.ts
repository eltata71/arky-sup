/**
 * The Office's portfolio read models — a small door (F6-05).
 *
 * The dashboard is the landing page, and it entered this module through its
 * barrel. The barrel republishes the runner adapters, which reach the agent
 * executor, the diagram pipeline and the AI layer; they carry top-level side
 * effects, so tree-shaking cannot drop them. Signing in therefore downloaded
 * ELK and the Gemini SDK — 517 KB gz in one shared chunk — to draw four charts.
 *
 * Nothing here calls a model or lays out a diagram. Keep it that way: a module
 * that reaches either does not belong behind this door.
 */
export * from './domain/officePortfolio';
export * from './application/portfolioCommandCenter';
