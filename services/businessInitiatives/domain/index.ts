/**
 * El dominio de Iniciativas: reglas puras, sin E/S, sin React (F3-05).
 *
 * Todo lo que hay en esta carpeta se prueba sin un solo mock, y
 * `__tests__/services/businessInitiatives/domainPurity.test.ts` impide que
 * importe persistencia, adaptadores, React o cualquier otro contexto de
 * dominio. Es el patrón que la fase 3 deja escrito para los demás contextos:
 * el dominio abajo, la infraestructura a un lado, y una sola puerta.
 */
export * from './BusinessInitiativeTypes';
export * from './initiativeIdentity';
export * from './initiativeRevision';
export * from './initiativeRecord';
export * from './initiativeCommands';
export * from './initiativeMetrics';
export * from './initiativeDelivery';
export * from './businessInitiativeFactory';
