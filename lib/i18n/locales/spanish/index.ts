// GENERADO por scripts/buildDictionarySections.mjs — no editar a mano (14.6).
// Núcleo eager y cargadores de las secciones diferidas.
// Regenerar: npm run i18n:sections
import type { Dictionary } from '../../translations';
export { section as esCore } from './core';

export const SPANISH_SECTION_LOADERS: Record<string, () => Promise<Dictionary>> = {
  "AgentsPage": async () => (await import('./AgentsPage')).section,
  "AuthPage": async () => (await import('./AuthPage')).section,
  "CapabilityMapPage": async () => (await import('./CapabilityMapPage')).section,
  "DashboardPage": async () => (await import('./DashboardPage')).section,
  "EngagementRoom": async () => (await import('./EngagementRoom')).section,
  "InitiativeRoom": async () => (await import('./InitiativeRoom')).section,
  "InitiativesPage": async () => (await import('./InitiativesPage')).section,
  "KeyboardShortcutsModal": async () => (await import('./KeyboardShortcutsModal')).section,
  "OfficePage": async () => (await import('./OfficePage')).section,
  "PlatformGuideDock": async () => (await import('./PlatformGuideDock')).section,
  "PortfolioPage": async () => (await import('./PortfolioPage')).section,
  "ProjectsPage": async () => (await import('./ProjectsPage')).section,
  "SDDProcessView": async () => (await import('./SDDProcessView')).section,
  "SettingsPage": async () => (await import('./SettingsPage')).section,
  "TrainingCenterPage": async () => (await import('./TrainingCenterPage')).section,
  "TransitionPlanPage": async () => (await import('./TransitionPlanPage')).section,
  "UserManagementPage": async () => (await import('./UserManagementPage')).section,
  "Workspace": async () => (await import('./Workspace')).section,
  "shared": async () => (await import('./shared')).section,
};
