/**
 * Health-insurance detectors: what recognises a health diagram and its concepts.
 *
 * Split from the pack on purpose (plan de diagramas, 6.4): the validators run
 * on the boot path through the quality service, and they need these regular
 * expressions — not the pack's prompt text. Reaching them through the pack or
 * the barrel put both packs' guidance in the eager payload (+3,2 KB gz).
 */
import type { DomainTerm } from './domainPackTypes';

export const HEALTH_REGULATORY_TERMS: readonly DomainTerm[] = [
    { label: 'HIPAA', pattern: /\bhipaa\b/i },
    { label: 'HITECH', pattern: /\bhitech\b/i },
    { label: 'HL7 FHIR', pattern: /\b(fhir|hl7)\b/i },
    { label: 'X12', pattern: /\bx12\b/i },
    { label: 'NCPDP', pattern: /\bncpdp\b/i },
];

export const HEALTH_VOCABULARY: readonly DomainTerm[] = [
    { label: 'salud', pattern: /\b(salud|health)\b/i },
    { label: 'gastos médicos', pattern: /gastos\s+m[eé]dicos/i },
    { label: 'hospital', pattern: /\bhospital(es)?\b/i },
    { label: 'clínica', pattern: /\b(cl[ií]nic[ao]s?|clinics?)\b/i },
    { label: 'historia clínica', pattern: /\b(ehr|emr|historia\s+cl[ií]nica|expediente\s+cl[ií]nico)\b/i },
    { label: 'paciente', pattern: /\b(pacientes?|patients?)\b/i },
    { label: 'miembro del plan', pattern: /\b(members?|miembros?\s+del\s+plan)\b/i },
    { label: 'farmacia', pattern: /\b(farmacias?|pharmacy|pbm)\b/i },
    { label: 'receta', pattern: /\b(recetas?|prescriptions?|prescripci[oó]n(es)?)\b/i },
    { label: 'elegibilidad', pattern: /\b(elegibilidad|eligibility)\b/i },
    { label: 'autorización previa', pattern: /\b(autorizaci(?:[oó]n|ones)\s+previas?|pre-?autorizaci(?:[oó]n|ones)|prior\s+auth)/i },
    { label: 'reclamación médica', pattern: /\b(reclamaci[oó]n(es)?\s+m[eé]dicas?|claims?)\b/i },
    { label: 'red de proveedores', pattern: /\b(red\s+(de\s+proveedores|m[eé]dica)|proveedor(es)?\s+de\s+salud|providers?|payers?)\b/i },
];

/** The validator's detectors — the vocabulary above, at the granularity each rule needs. */
export const HEALTH_DETECTORS = {
    phi: /\b(patient|paciente|patient[-_ ]?id|mrn|member[-_ ]?id|policy[-_ ]?holder|assured|asegurado|claim|reclam(o|aci[oó]n)|coverage|cobertura|policy|p[oó]liza|eligibility|elegibilidad|remittance|adjudication|adjudicaci[oó]n|copay|deductible|deducible|prescription|prescripci[oó]n|formulary|formulario|pbm|pharmacy|farmacia|provider|proveedor|hl7|fhir|x12|ehr|emr|clinical|cl[ií]nico|diagnosis|diagn[oó]stico|treatment|tratamiento|medication|medicamento|lab\s+result|allergy|alergia)\b/i,
    pii: /\b(ssn|social[-_ ]?security|tax[-_ ]?id|dni|cedula|c[eé]dula|passport|pasaporte|birth\s*date|fecha\s*de\s*nacimiento|home\s+address|domicilio|email|phone\s*number|tel[eé]fono|name\s+(of|del)\s+(member|patient|insured))\b/i,
    clinical: /\b(patient|paciente|clinical|cl[ií]nico|diagnosis|diagn[oó]stico|lab\s+result|hl7|fhir|ehr|emr|prescription|prescripci[oó]n|allergy|alergia|encounter|encuentro|cdc|condition|treatment|tratamiento)\b/i,
    eligibility: /\b(eligibility|elegibilidad|270|271|coverage\s+check|verificaci[oó]n\s+de\s+cobertura|benefits\s+inquiry)\b/i,
    claim: /\b(claim|reclam(o|aci[oó]n)|837|835|adjudication|adjudicaci[oó]n|remittance|remesa|denial|denegaci[oó]n|cob|coordination\s+of\s+benefits|prior\s+auth)\b/i,
    pharmacy: /\b(pbm|pharmacy|farmacia|ncpdp|formulary|formulario|drug|medicaci[oó]n|prescription|prescripci[oó]n|script|d\.0|sig|days[-_ ]?supply)\b/i,
    payerProvider: /\b(payer|payor|pagador|carrier|provider|proveedor|hospital|clinic|cl[ií]nica|insurer|aseguradora|tpa|clearing\s*house|clearinghouse|edi\s+gateway)\b/i,
} as const;
