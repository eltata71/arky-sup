/**
 * El dominio de la Oficina de Arquitectura: reglas puras, sin E/S, sin React
 * (F6-03, corte 3).
 *
 * El encargo y su lectura (`OfficeTypes`, `officeEngagementRecord`), la fábrica
 * que decide si puede existir, sus transiciones, el comité, el planificador del
 * charter, los agentes —su contrato, su registro, sus fichas y su enrutado—, las
 * puertas de calidad y el portafolio. `application/` orquesta —el runner, la
 * coordinación del equipo— y `infrastructure/` habla con la base y con los
 * servicios reales.
 *
 * `contextDomainPurity.test.ts` sigue el cierre de imports de valor de esta
 * carpeta. Cinco de estas reglas llegaban antes a la base por un solo import:
 * `withAuditEntry` y los generadores de ids vivían dentro del repositorio.
 */
export * from './OfficeAgentRouter';
export * from './OfficeArbService';
export * from './OfficeEngagementPlanner';
export * from './OfficeTypes';
export * from './agentDefinition';
export * from './agentHandoff';
export * from './agentRegistry';
export * from './officeAgentPersonas';
export * from './officeAgentProfile';
export * from './officeArchitectureKnowledge';
export * from './officeArtifactValidators';
export * from './officeConsolidationReview';
export * from './officeEngagementFactory';
export * from './officeEngagementRecord';
export * from './officeEngagementTransitions';
export * from './officePortfolio';
export * from './officePublicationBridge';
export * from './officeQualityGates';
export * from './officeShared';
export * from './yamlStructure';
