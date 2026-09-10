/**
 * Healthcare / insurance compliance validator.
 *
 * Phase 3 introduces explicit rules for the industries that ArkyPro
 * actively targets (US health insurance, PBM, member-portal flows).
 * The validator runs across every IR but only fires when the IR exposes
 * the corresponding domain signals — non-healthcare diagrams stay
 * unaffected.
 *
 * Rules:
 *  - PHI/PII data classification: when a node touches member / patient
 *    / claim / coverage / policy / pharmacy data, the node should
 *    declare `dataClassification = phi | pii | pci` and the relations
 *    that move that data should declare `security` and `dataSensitivity`.
 *  - FHIR adoption: clinical / eligibility / coverage flows should
 *    prefer FHIR payloads. We surface the recommendation when the IR
 *    mentions clinical concepts but does not declare `payload` /
 *    `protocol` containing "FHIR".
 *  - X12 (eligibility 270/271, claims 837/835, remittance 835/820):
 *    when the IR mentions eligibility / claims / remittance and a
 *    payer/provider/clearing-house interaction exists, recommend X12
 *    when the protocol does not contain "X12" / "EDI".
 *  - NCPDP (pharmacy claims): when the IR mentions PBM / pharmacy /
 *    eligibility for drugs, recommend NCPDP D.0 / SCRIPT.
 *  - Auditability: critical financial / clinical flows should carry
 *    `observability` so the architecture supports auditing.
 *  - Adjudication trace: when claims appear, the validator expects an
 *    adjudication / accumulator / remittance node to be present in the
 *    same diagram.
 *
 * The module exports `validateHealthcareCompliance` which returns a
 * flat array of issues. It never mutates the IR.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';

export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface HealthcareComplianceIssue {
    id: string;
    code:
        | 'HC_MISSING_PHI_CLASSIFICATION'
        | 'HC_MISSING_PII_CLASSIFICATION'
        | 'HC_SENSITIVE_EDGE_MISSING_SECURITY'
        | 'HC_SENSITIVE_EDGE_MISSING_SENSITIVITY'
        | 'HC_RECOMMEND_FHIR'
        | 'HC_RECOMMEND_X12'
        | 'HC_RECOMMEND_NCPDP'
        | 'HC_MISSING_OBSERVABILITY'
        | 'HC_MISSING_ADJUDICATION_TRACE';
    severity: ComplianceSeverity;
    message: string;
    recommendation: string;
    affectedIds?: string[];
}

const PHI_KEYWORDS = /\b(patient|paciente|patient[-_ ]?id|mrn|member[-_ ]?id|policy[-_ ]?holder|assured|asegurado|claim|reclam(o|aci[oó]n)|coverage|cobertura|policy|p[oó]liza|eligibility|elegibilidad|remittance|adjudication|adjudicaci[oó]n|copay|deductible|deducible|prescription|prescripci[oó]n|formulary|formulario|pbm|pharmacy|farmacia|provider|proveedor|hl7|fhir|x12|ehr|emr|clinical|cl[ií]nico|diagnosis|diagn[oó]stico|treatment|tratamiento|medication|medicamento|lab\s+result|allergy|alergia)\b/i;
const PII_KEYWORDS = /\b(ssn|social[-_ ]?security|tax[-_ ]?id|dni|cedula|c[eé]dula|passport|pasaporte|birth\s*date|fecha\s*de\s*nacimiento|home\s+address|domicilio|email|phone\s*number|tel[eé]fono|name\s+(of|del)\s+(member|patient|insured))\b/i;

// Higher-confidence concept detectors used by the recommendation rules.
const CLINICAL_KEYWORDS = /\b(patient|paciente|clinical|cl[ií]nico|diagnosis|diagn[oó]stico|lab\s+result|hl7|fhir|ehr|emr|prescription|prescripci[oó]n|allergy|alergia|encounter|encuentro|cdc|condition|treatment|tratamiento)\b/i;
const ELIGIBILITY_KEYWORDS = /\b(eligibility|elegibilidad|270|271|coverage\s+check|verificaci[oó]n\s+de\s+cobertura|benefits\s+inquiry)\b/i;
const CLAIM_KEYWORDS = /\b(claim|reclam(o|aci[oó]n)|837|835|adjudication|adjudicaci[oó]n|remittance|remesa|denial|denegaci[oó]n|cob|coordination\s+of\s+benefits|prior\s+auth)\b/i;
const PHARMACY_KEYWORDS = /\b(pbm|pharmacy|farmacia|ncpdp|formulary|formulario|drug|medicaci[oó]n|prescription|prescripci[oó]n|script|d\.0|sig|days[-_ ]?supply)\b/i;
const PAYER_PROVIDER_KEYWORDS = /\b(payer|payor|pagador|carrier|provider|proveedor|hospital|clinic|cl[ií]nica|insurer|aseguradora|tpa|clearing\s*house|clearinghouse|edi\s+gateway)\b/i;

function nodeMatches(node: DiagramIRNode, re: RegExp): boolean {
    const haystack = `${node.label ?? ''} ${node.description ?? ''} ${node.domain ?? ''} ${node.technology ?? ''} ${node.businessMeaning ?? ''}`;
    return re.test(haystack);
}

function edgeMatches(edge: DiagramIREdge, re: RegExp): boolean {
    const haystack = `${edge.label ?? ''} ${edge.protocol ?? ''} ${edge.payload ?? ''} ${edge.businessMeaning ?? ''}`;
    return re.test(haystack);
}

function looksLikePHI(node: DiagramIRNode): boolean {
    if (node.dataClassification === 'phi') return true;
    return nodeMatches(node, PHI_KEYWORDS);
}

function looksLikePII(node: DiagramIRNode): boolean {
    if (node.dataClassification === 'pii') return true;
    return nodeMatches(node, PII_KEYWORDS);
}

function dedup<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}

/**
 * Healthcare-context heuristic: only fire the validator when the IR has
 * enough domain signals to be considered a healthcare/insurance diagram.
 * The contract is intentionally conservative — we'd rather miss a
 * recommendation than spam a non-healthcare diagram with PHI warnings.
 *
 * The diagram qualifies when at least TWO of the following hold:
 *  - any node already declares `dataClassification = phi | pii | pci`
 *  - ≥ 2 nodes match the strong healthcare vocabulary (claim, coverage,
 *    member-id, FHIR, X12, NCPDP, pharmacy, …)
 *  - any edge already declares an FHIR / X12 / NCPDP / HL7 payload
 *  - the IR's diagramType / title explicitly mentions
 *    health/insurance/PBM/claims
 */
export function isHealthcareContext(ir: DiagramIR): boolean {
    // Strong signal — any explicit declaration is enough on its own.
    if (ir.nodes.some((n) => n.dataClassification === 'phi' || n.dataClassification === 'pii' || n.dataClassification === 'pci')) return true;
    const standardEdges = ir.edges.filter((e) => edgeMatches(e, /\b(fhir|x12|ncpdp|hl7|837|835|270|271|820|d\.0)\b/i)).length;
    if (standardEdges >= 1) return true;

    // Otherwise, require at least TWO independent healthcare-style signals
    // across nodes/edges/title so a single mention of "asegurado" / "PBM"
    // in description does not light up the validator.
    let signals = 0;
    const phiTokensTotal = ir.nodes.reduce((acc, n) => acc + (nodeMatches(n, PHI_KEYWORDS) ? 1 : 0), 0)
        + ir.edges.reduce((acc, e) => acc + (edgeMatches(e, PHI_KEYWORDS) ? 1 : 0), 0);
    if (phiTokensTotal >= 2) signals += 1;
    if (phiTokensTotal >= 1) signals += 1;
    const title = (ir.metadata?.title ?? '').toLowerCase();
    if (/\b(health|salud|insurance|seguros?|pbm|pharmacy|farmacia|claim|reclam|coverage|cobertura|eligibility|elegibilidad|member|patient|paciente|hipaa|payer|provider|aseguradora)\b/i.test(title)) signals += 1;
    return signals >= 2;
}

export function validateHealthcareCompliance(ir: DiagramIR): HealthcareComplianceIssue[] {
    if (!ir.nodes || ir.nodes.length === 0) return [];
    // Skip the validator unless the diagram clearly belongs to the
    // healthcare/insurance domain. This keeps non-healthcare diagrams
    // (a single mention of "asegurado" in a description does not make a
    // diagram a healthcare one) from being polluted with spurious
    // compliance findings.
    if (!isHealthcareContext(ir)) return [];

    const issues: HealthcareComplianceIssue[] = [];

    // ── PHI / PII classification ────────────────────────────────────────
    const phiCandidates = ir.nodes.filter((n) => looksLikePHI(n) && n.dataClassification !== 'phi');
    if (phiCandidates.length > 0) {
        issues.push({
            id: 'hc-missing-phi-classification',
            code: 'HC_MISSING_PHI_CLASSIFICATION',
            severity: 'high',
            message: `${phiCandidates.length} nodo(s) manejan información clínica/asegurada pero no declaran clasificación PHI.`,
            recommendation: 'Marca el nodo con dataClassification="phi" y lista frameworks de compliance (HIPAA, HITECH, GDPR si aplica) en el campo compliance.',
            affectedIds: phiCandidates.slice(0, 8).map((n) => n.id),
        });
    }
    const piiCandidates = ir.nodes.filter((n) => looksLikePII(n) && !n.dataClassification);
    if (piiCandidates.length > 0) {
        issues.push({
            id: 'hc-missing-pii-classification',
            code: 'HC_MISSING_PII_CLASSIFICATION',
            severity: 'medium',
            message: `${piiCandidates.length} nodo(s) procesan datos personales (SSN, dirección, teléfono…) sin clasificación PII.`,
            recommendation: 'Marca el nodo con dataClassification="pii" y agrega compliance acorde (GDPR, CCPA, LGPD…).',
            affectedIds: piiCandidates.slice(0, 8).map((n) => n.id),
        });
    }

    // ── Sensitive edges security ────────────────────────────────────────
    // Any edge whose endpoint touches a PHI/PII node must declare a
    // security control (mTLS, OAuth, JWT, VPN, encryption in transit).
    const sensitiveNodeIds = new Set([...phiCandidates, ...piiCandidates, ...ir.nodes.filter((n) => n.dataClassification === 'phi' || n.dataClassification === 'pii')].map((n) => n.id));
    const sensitiveEdges = ir.edges.filter((e) => sensitiveNodeIds.has(e.source) || sensitiveNodeIds.has(e.target));
    const insecureEdges = sensitiveEdges.filter((e) => !(e.security && e.security.trim().length > 0));
    if (insecureEdges.length > 0) {
        issues.push({
            id: 'hc-sensitive-edge-missing-security',
            code: 'HC_SENSITIVE_EDGE_MISSING_SECURITY',
            severity: 'high',
            message: `${insecureEdges.length} relación(es) tocan datos PHI/PII sin declarar control de seguridad.`,
            recommendation: 'Declara security="mTLS + OAuth2" / "TLS 1.2+ + JWT" / VPN según el contexto; HIPAA exige cifrado en tránsito y autenticación fuerte.',
            affectedIds: insecureEdges.slice(0, 8).map((e) => e.id),
        });
    }
    const unsensitiveEdges = sensitiveEdges.filter((e) => !e.dataSensitivity);
    if (unsensitiveEdges.length > 0) {
        issues.push({
            id: 'hc-sensitive-edge-missing-sensitivity',
            code: 'HC_SENSITIVE_EDGE_MISSING_SENSITIVITY',
            severity: 'medium',
            message: `${unsensitiveEdges.length} relación(es) que transportan PHI/PII no declaran dataSensitivity.`,
            recommendation: 'Asigna dataSensitivity="phi" / "pii" / "confidential" para que los badges visuales adviertan el riesgo.',
            affectedIds: unsensitiveEdges.slice(0, 8).map((e) => e.id),
        });
    }

    // ── FHIR recommendation ─────────────────────────────────────────────
    const hasClinical = ir.nodes.some((n) => nodeMatches(n, CLINICAL_KEYWORDS));
    if (hasClinical) {
        const fhirRe = /\bfhir\b/i;
        const fhirEdges = ir.edges.filter((e) => edgeMatches(e, fhirRe));
        if (fhirEdges.length === 0) {
            issues.push({
                id: 'hc-recommend-fhir',
                code: 'HC_RECOMMEND_FHIR',
                severity: 'low',
                message: 'El diagrama incluye conceptos clínicos pero ninguna relación declara payload FHIR.',
                recommendation: 'Adopta FHIR R4/R5 como payload de las relaciones clínicas (Bundle, Patient, Coverage, Claim, ExplanationOfBenefit) para interoperabilidad estándar.',
            });
        }
    }

    // ── X12 recommendation ──────────────────────────────────────────────
    const hasEligibility = ir.nodes.some((n) => nodeMatches(n, ELIGIBILITY_KEYWORDS)) ||
        ir.edges.some((e) => edgeMatches(e, ELIGIBILITY_KEYWORDS));
    const hasClaims = ir.nodes.some((n) => nodeMatches(n, CLAIM_KEYWORDS)) ||
        ir.edges.some((e) => edgeMatches(e, CLAIM_KEYWORDS));
    const hasPayerProvider = ir.nodes.some((n) => nodeMatches(n, PAYER_PROVIDER_KEYWORDS));
    if ((hasEligibility || hasClaims) && hasPayerProvider) {
        const x12Re = /\b(x12|edi|837|835|270|271|820)\b/i;
        const x12Edges = ir.edges.filter((e) => edgeMatches(e, x12Re));
        if (x12Edges.length === 0) {
            issues.push({
                id: 'hc-recommend-x12',
                code: 'HC_RECOMMEND_X12',
                severity: 'low',
                message: 'Hay flujos de eligibility/claims entre payer/provider sin declarar X12/EDI.',
                recommendation: 'Declara el payload X12 (270/271 eligibility, 837/835 claims & remittance, 820 premium payment) en las relaciones B2B — es el estándar HIPAA para intercambio entre payer y provider.',
            });
        }
    }

    // ── NCPDP recommendation ────────────────────────────────────────────
    const hasPharmacy = ir.nodes.some((n) => nodeMatches(n, PHARMACY_KEYWORDS)) ||
        ir.edges.some((e) => edgeMatches(e, PHARMACY_KEYWORDS));
    if (hasPharmacy) {
        const ncpdpRe = /\b(ncpdp|d\.0|script|telecom)\b/i;
        const ncpdpEdges = ir.edges.filter((e) => edgeMatches(e, ncpdpRe));
        if (ncpdpEdges.length === 0) {
            issues.push({
                id: 'hc-recommend-ncpdp',
                code: 'HC_RECOMMEND_NCPDP',
                severity: 'low',
                message: 'Hay flujos de farmacia/PBM sin declarar NCPDP D.0 / SCRIPT.',
                recommendation: 'Declara NCPDP D.0 (transacciones farmacéuticas en tiempo real) o SCRIPT (prescripciones electrónicas) en las relaciones con la PBM/farmacia — es el estándar de la industria.',
            });
        }
    }

    // ── Observability for critical flows ───────────────────────────────
    const criticalEdges = ir.edges.filter((e) => e.criticality === 'critical' || e.criticality === 'high');
    const unobservedCritical = criticalEdges.filter((e) => !(e.observability && e.observability.trim().length > 0));
    if (unobservedCritical.length > 0) {
        issues.push({
            id: 'hc-missing-observability',
            code: 'HC_MISSING_OBSERVABILITY',
            severity: 'medium',
            message: `${unobservedCritical.length} relación(es) crítica(s) no declaran observabilidad/auditoría.`,
            recommendation: 'Agrega observability="OpenTelemetry + audit log" / "SIEM trace" para flujos PHI/financieros — HIPAA y SOC2 exigen pista de auditoría.',
            affectedIds: unobservedCritical.slice(0, 8).map((e) => e.id),
        });
    }

    // ── Adjudication trace ─────────────────────────────────────────────
    if (hasClaims) {
        const hasAdjudication = ir.nodes.some((n) => /\b(adjudication|adjudicaci[oó]n|accumulator|acumulador|remittance|remesa|payment|pago|denial|denegaci[oó]n|appeals|apelaciones?)\b/i.test(`${n.label ?? ''} ${n.description ?? ''}`));
        if (!hasAdjudication) {
            issues.push({
                id: 'hc-missing-adjudication-trace',
                code: 'HC_MISSING_ADJUDICATION_TRACE',
                severity: 'low',
                message: 'El flujo de claims no expone los pasos de adjudicación / acumuladores / remesa / pago.',
                recommendation: 'Incluye nodos para Adjudication, Accumulator update, Remittance (835), Payment (820) y Appeals — la trazabilidad end-to-end es requisito regulatorio y operativo.',
            });
        }
    }

    return dedup(issues);
}
