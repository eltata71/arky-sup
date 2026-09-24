/**
 * La puerta diferida de la recuperación del grafo (F5-05).
 *
 * `useArchitectureGraphSync` está en el árbol de providers desde el arranque, y
 * entrar por el barril del módulo subía la carga inicial de 309,1 a 310,3 KB gz
 * (la regla del barril contra el bundle). La recuperación sólo corre cuando ya
 * hay proyectos, así que el hook la carga con `import()` por esta puerta, que
 * `modules.json` declara, igual que `businessInitiatives/commands.ts`.
 */
export { recoverGraphProjections } from './graphProjectionRecovery';
export type { GraphProjectionReport } from './graphProjectionRecovery';
export { createGraphProjectionPorts } from './graphProjectionPorts';
