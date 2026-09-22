/**
 * La puerta de las operaciones de una Iniciativa, sola (F3-06).
 *
 * Existe para poder cargarse **en diferido**. `InitiativeContext` está en el
 * árbol del arranque y sólo necesita estas reglas cuando alguien edita; si las
 * alcanzara por el barril del módulo, entrarían en la carga inicial (lo midió
 * `check:bundle-budget`: 1,2 KB gz). Una puerta pequeña y declarada en
 * `modules.json` permite el `import()` sin saltarse la frontera del módulo.
 */
export {
  applyInitiativeCommand,
  type InitiativeCommand,
  type InitiativeCommandKind,
  type InitiativeCommandOptions,
  type InitiativeCommandRejection,
  type InitiativeCommandRejectionCode,
  type InitiativeCommandResult,
  type ProposedKpi,
  type ProposedOutcome,
  type ProposedRisk,
} from './domain/initiativeCommands';
