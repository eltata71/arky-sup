export type OfficeArchitectureDomain =
  | 'global'
  | 'aws'
  | 'salesforce'
  | 'mulesoft'
  | 'as400'
  | 'software'
  | 'artifacts'
  | 'insurance';

export interface OfficeArchitectureStandard {
  id: string;
  domain: OfficeArchitectureDomain;
  statement: string;
}

export interface OfficeArchitectureContext {
  version: string;
  standards: readonly OfficeArchitectureStandard[];
  promptContext: string[];
}

const STANDARDS: readonly OfficeArchitectureStandard[] = Object.freeze([
  { id: 'GLOBAL-API-FIRST', domain: 'global', statement: 'API-First y Contract-First con OpenAPI 3.1 y AsyncAPI 3.0.' },
  { id: 'GLOBAL-ZERO-TRUST', domain: 'global', statement: 'Zero Trust, mínimo privilegio y cifrado en tránsito y reposo.' },
  { id: 'GLOBAL-OBSERVABILITY', domain: 'global', statement: 'Observabilidad nativa con trazas, métricas y logs correlacionados.' },
  { id: 'AWS-WELL-ARCHITECTED', domain: 'aws', statement: 'Aplicar AWS Well-Architected, alta disponibilidad y control de costos.' },
  { id: 'SALESFORCE-STANDARD-FIRST', domain: 'salesforce', statement: 'Usar objetos estándar primero, Flow sobre Apex y sharing verificable.' },
  { id: 'MULESOFT-API-LED', domain: 'mulesoft', statement: 'API-led System, Process y Experience con políticas e idempotencia.' },
  { id: 'AS400-STRANGLER', domain: 'as400', statement: 'Modernizar IBM i con Strangler Fig, API facade, CDC y rollback.' },
  { id: 'SOFTWARE-EVOLUTIONARY', domain: 'software', statement: 'Preferir monolito modular, NFR medibles, resiliencia y pruebas.' },
  { id: 'ARTIFACTS-EVIDENCE', domain: 'artifacts', statement: 'Artefactos C4, ADR, contratos y STRIDE deben ser trazables, accesibles y validables.' },
  { id: 'INS-ACORD-CANONICAL', domain: 'insurance', statement: 'Modelar póliza, siniestro, parte y cobertura sobre el modelo canónico ACORD; toda integración traduce hacia ese canónico, nunca hacia el modelo interno de un sistema.' },
  { id: 'INS-PII-PHI-MINIMIZATION', domain: 'insurance', statement: 'Clasificar PII y PHI en origen, minimizar su propagación fuera del dominio que la produce y cifrarla en tránsito y reposo con control de acceso demostrable.' },
  { id: 'INS-REGULATORY-TRACEABILITY', domain: 'insurance', statement: 'Cada requisito regulatorio (Solvencia II, NAIC, HIPAA, DORA, ISO 27001) se traza a un control, un artefacto de evidencia y un responsable.' },
  { id: 'INS-CLAIMS-AUDITABILITY', domain: 'insurance', statement: 'El ciclo de vida del siniestro y de la póliza es reconstruible: eventos inmutables, versionado de decisiones y retención acorde a la normativa aplicable.' },
]);

export const getOfficeArchitectureContext = (): OfficeArchitectureContext => ({
  version: '1.1.0',
  standards: STANDARDS,
  promptContext: STANDARDS.map((standard) => `[${standard.id}] ${standard.statement}`),
});
