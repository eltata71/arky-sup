/**
 * Seguros de vida — individual y grupo, emisión, suscripción, siniestro y
 * reaseguro (plan de diagramas, 6.4). The product targeted health insurance
 * and knew nothing of life: a payout without a sanctions screening passed
 * every check it had.
 */
import type { DomainPack } from './domainPackTypes';
import { LIFE_REGULATORY_TERMS, LIFE_VOCABULARY } from './lifeDetectors';

export const LIFE_INSURANCE_PACK: DomainPack = {
    id: 'life-insurance',
    name: 'Seguros de vida',
    regulatoryTerms: LIFE_REGULATORY_TERMS,
    vocabulary: LIFE_VOCABULARY,
    entities: [
        'Solicitante / contratante', 'Asegurado', 'Beneficiario (designación y porcentajes)', 'Póliza de vida (temporal, ordinario, dotal, vida grupo)',
        'Suma asegurada', 'Prima y cobranza', 'Suscripción (evaluación del riesgo)', 'Evidencia médica y de hábitos',
        'Reaseguro (cesión por encima de la retención)', 'Siniestro (fallecimiento, invalidez)', 'Liquidación y pago', 'Rescate y préstamo sobre póliza',
    ],
    flows: [
        'Emisión: cotización → solicitud con firma electrónica → verificación de identidad y listas (KYC/AML) → suscripción → alta en la administración de pólizas.',
        'Suscripción: evidencia médica (laboratorio, buró de información médica) → motor de reglas → aceptar, extraprima, rechazar o referir a un suscriptor.',
        'Siniestro: aviso → documentos (acta de defunción, identificación) → validación de beneficiarios → screening AML y de sanciones → liquidación → pago.',
        'Reaseguro: cesión de riesgo y reportes periódicos con el reasegurador.',
        'Cobranza y conservación: primas, caducidad y rehabilitación.',
    ],
    standards: [
        { name: 'ACORD Life & Annuity', use: 'mensajes entre distribución, administración de pólizas y reaseguradores.' },
        { name: 'ISO 20022', use: 'pagos de suma asegurada y cobranza bancaria.' },
        { name: 'KYC / AML', use: 'verificación de identidad y listas restrictivas antes de emitir y antes de pagar; la norma local sólo si el proyecto o la iniciativa la nombran.' },
    ],
    dataRules: [
        'Solicitante, asegurado y beneficiarios son PII: dataClassification "pii" en los elementos que los guardan o procesan.',
        'La evidencia médica de suscripción es PHI y se separa del resto de la póliza, con acceso restringido.',
        'Ningún pago de suma asegurada sin screening AML y de sanciones previo, visible en el diagrama.',
        'La decisión de suscripción y la liquidación dejan rastro de auditoría ("observability").',
    ],
};
