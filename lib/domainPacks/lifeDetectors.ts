/**
 * Life-insurance detectors: what recognises a life diagram and its concepts.
 *
 * Split from the pack on purpose (plan de diagramas, 6.4): the validators run
 * on the boot path through the quality service, and they need these regular
 * expressions — not the pack's prompt text. Reaching them through the pack or
 * the barrel put both packs' guidance in the eager payload (+3,2 KB gz).
 */
import type { DomainTerm } from './domainPackTypes';

export const LIFE_REGULATORY_TERMS: readonly DomainTerm[] = [
    { label: 'ACORD', pattern: /\bacord\b/i },
    { label: 'solvencia', pattern: /\bsolvencia\b|\bsolvency\b/i },
];

export const LIFE_VOCABULARY: readonly DomainTerm[] = [
    { label: 'vida', pattern: /\b(seguros?\s+de\s+vida|vida\s+(individual|grupo|colectivo)|life\s+insurance|p[oó]lizas?\s+de\s+vida)\b/i },
    { label: 'beneficiario', pattern: /\bbeneficiari[oa]s?\b/i },
    { label: 'suma asegurada', pattern: /\bsuma\s+asegurada\b/i },
    { label: 'suscripción', pattern: /\b(suscripci[oó]n|suscriptor(es)?|underwriting)\b/i },
    { label: 'fallecimiento', pattern: /\b(fallecimiento|defunci[oó]n|muerte)\b/i },
    { label: 'siniestro de vida', pattern: /\bsiniestros?\s+de\s+vida\b/i },
    { label: 'reaseguro', pattern: /\breasegur(o|ador|adora)\b/i },
    { label: 'rescate', pattern: /\b(rescate|valor\s+de\s+rescate|anualidad(es)?)\b/i },
    { label: 'emisión de póliza', pattern: /\bemisi[oó]n\b/i },
];

/** The validator's detectors for life insurance. */
export const LIFE_DETECTORS = {
    context: /\b(vida|life|beneficiari[oa]s?|suma\s+asegurada|suscripci[oó]n|suscriptor(es)?|underwriting|fallecimiento|defunci[oó]n|reasegur\w*|rescate|anualidad|siniestro)\b/i,
    party: /\b(solicitante|contratante|beneficiari[oa]s?|asegurado|applicant|beneficiary|insured)\b/i,
    evidence: /\b(evidencia\s+m[eé]dica|evidencias?|laboratorio|ex[aá]men(es)?\s+m[eé]dicos?|bur[oó]\s+m[eé]dico|mib|historial\s+m[eé]dico)\b/i,
    payout: /\b(liquidaci[oó]n|pago\s+de\s+(la\s+)?suma|paga\s+suma|suma\s+asegurada|tesorer[ií]a|ordena\s+pago|pago\s+al?\s+beneficiari)/i,
    claim: /\b(siniestros?|fallecimiento|defunci[oó]n|reclamaci[oó]n\s+de\s+vida)\b/i,
    amlScreening: /\b(aml|kyc|sanci[oó]n(es)?|listas?\s+(restrictivas|negras|ofac)|ofac|pep|screening|lavado)\b/i,
    acordParties: /\b(reasegur\w*|administraci[oó]n\s+de\s+p[oó]lizas|distribuidor(es)?|agente|broker|corredor)\b/i,
    acord: /\bacord\b/i,
} as const;
