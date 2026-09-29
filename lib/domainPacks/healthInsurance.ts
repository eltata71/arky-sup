/**
 * Seguros de salud — gastos médicos, planes de salud y PBM (plan de
 * diagramas, 6.4).
 *
 * Its vocabulary and the validator's detectors are in `healthDetectors.ts` —
 * the ones `services/diagram/healthcareCompliance` used to declare inline —
 * so the validator and the prompt read one vocabulary.
 */
import type { DomainPack } from './domainPackTypes';
import { HEALTH_REGULATORY_TERMS, HEALTH_VOCABULARY } from './healthDetectors';

export const HEALTH_INSURANCE_PACK: DomainPack = {
    id: 'health-insurance',
    name: 'Seguros de salud',
    regulatoryTerms: HEALTH_REGULATORY_TERMS,
    vocabulary: HEALTH_VOCABULARY,
    entities: [
        'Asegurado (titular y dependientes)', 'Plan o póliza y sus coberturas', 'Proveedor de la red (hospital, médico, farmacia)',
        'Elegibilidad', 'Autorización previa', 'Reclamación', 'Adjudicación', 'Acumuladores (deducible, coaseguro, máximo de bolsillo)',
        'Remesa y pago al proveedor', 'Reembolso al asegurado', 'Apelación', 'Formulario de medicamentos y PBM',
    ],
    flows: [
        'Elegibilidad: proveedor → pagador, en tiempo real, con respuesta de vigencia y beneficios.',
        'Autorización previa: solicitud del proveedor → revisión clínica (automática o dictaminada) → decisión con plazo y rastro de auditoría.',
        'Reclamación: recepción → validación → adjudicación contra coberturas → actualización de acumuladores → remesa y pago al proveedor.',
        'Farmacia: adjudicación de la receta en tiempo real a través del PBM contra el formulario.',
        'Reembolso: el asegurado presenta comprobantes → dictamen → pago a su cuenta.',
    ],
    standards: [
        { name: 'HL7 FHIR R4', use: 'interoperabilidad clínica y de cobertura (Coverage, CoverageEligibilityRequest, Claim, ExplanationOfBenefit; Da Vinci PAS para autorización previa).' },
        { name: 'X12 270/271, 278, 837, 835, 820', use: 'intercambio pagador-proveedor bajo HIPAA en EE. UU.: elegibilidad, autorización, reclamación, remesa y pago de primas.' },
        { name: 'NCPDP D.0 / SCRIPT', use: 'transacciones de farmacia en tiempo real y receta electrónica.' },
        { name: 'HIPAA / HITECH', use: 'privacidad y seguridad de la información de salud en EE. UU.; en otro país, cita sólo la norma que nombren el proyecto o la iniciativa.' },
    ],
    dataRules: [
        'Todo dato clínico o de un asegurado identificable es PHI: dataClassification "phi" en el elemento y dataSensitivity "phi" en cada relación que lo transporta.',
        'Mínimo necesario: un canal digital recibe sólo lo que muestra.',
        'Cada relación con PHI declara su control en "security" (cifrado en tránsito y autenticación).',
        'Las decisiones clínicas y de pago dejan rastro de auditoría ("observability").',
    ],
};
