/**
 * Life-insurance compliance rules (plan de diagramas, 6.4).
 *
 * The product validated health-insurance diagrams and nothing else, so a
 * life-claim payout with no sanctions screening — the control a regulator
 * asks about first — passed every check it had. These rules read the life
 * pack's detectors (`lib/domainPacks`), and like the health validator they
 * fire only on a diagram that is clearly a life one: two distinct life
 * signals, so a single "beneficio" in a label does not light them up.
 *
 * Never mutates the IR; returns what it found.
 */
import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';
import { LIFE_DETECTORS } from '../../lib/domainPacks/lifeDetectors';
import type { DomainComplianceIssue } from './healthcareCompliance';

const nodeText = (node: DiagramIRNode): string =>
    `${node.label ?? ''} ${node.description ?? ''} ${node.domain ?? ''} ${node.businessMeaning ?? ''}`;
const edgeText = (edge: DiagramIREdge): string =>
    `${edge.label ?? ''} ${edge.protocol ?? ''} ${edge.payload ?? ''} ${edge.businessMeaning ?? ''}`;

/** Two distinct life signals across nodes, edges and title. */
export function isLifeInsuranceContext(ir: DiagramIR): boolean {
    const texts = [...ir.nodes.map(nodeText), ...ir.edges.map(edgeText), ir.metadata?.title ?? ''];
    const hits = new Set<string>();
    for (const text of texts) {
        const match = text.toLowerCase().match(LIFE_DETECTORS.context);
        if (match) hits.add(match[1] ?? match[0]);
        if (hits.size >= 2) return true;
    }
    return false;
}

export function validateLifeInsuranceCompliance(ir: DiagramIR): DomainComplianceIssue[] {
    if (!ir.nodes?.length || !isLifeInsuranceContext(ir)) return [];
    const issues: DomainComplianceIssue[] = [];
    const anyText = (re: RegExp) => ir.nodes.some((n) => re.test(nodeText(n))) || ir.edges.some((e) => re.test(edgeText(e)));

    // A payout of the sum assured with no screening anywhere in the picture.
    if (anyText(LIFE_DETECTORS.claim) && anyText(LIFE_DETECTORS.payout) && !anyText(LIFE_DETECTORS.amlScreening)) {
        issues.push({
            id: 'li-payout-without-aml',
            code: 'LI_PAYOUT_WITHOUT_AML',
            severity: 'high',
            message: 'El diagrama paga una suma asegurada y no muestra ningún control AML ni de sanciones antes del pago.',
            recommendation: 'Añade el screening AML/sanciones (listas restrictivas, PEP) entre la validación de beneficiarios y la liquidación.',
        });
    }

    const evidence = ir.nodes.filter((n) => LIFE_DETECTORS.evidence.test(nodeText(n)) && n.dataClassification !== 'phi');
    if (evidence.length > 0) {
        issues.push({
            id: 'li-underwriting-evidence-not-phi',
            code: 'LI_UNDERWRITING_EVIDENCE_NOT_PHI',
            severity: 'high',
            message: `${evidence.length} elemento(s) manejan evidencia médica de suscripción sin clasificación PHI.`,
            recommendation: 'Marca la evidencia médica con dataClassification="phi" y sepárala del resto de la póliza con acceso restringido.',
            affectedIds: evidence.slice(0, 8).map((n) => n.id),
        });
    }

    const parties = ir.nodes.filter((n) => LIFE_DETECTORS.party.test(nodeText(n)) && !n.dataClassification
        && !/person/i.test(n.kind) && n.shape !== 'person');
    if (parties.length > 0) {
        issues.push({
            id: 'li-party-data-not-classified',
            code: 'LI_PARTY_DATA_NOT_CLASSIFIED',
            severity: 'medium',
            message: `${parties.length} elemento(s) guardan o procesan datos de solicitantes, asegurados o beneficiarios sin clasificación.`,
            recommendation: 'Declara dataClassification="pii" en los elementos que guardan o procesan datos de personas de la póliza.',
            affectedIds: parties.slice(0, 8).map((n) => n.id),
        });
    }

    if (anyText(LIFE_DETECTORS.acordParties) && ir.edges.length > 0 && !ir.edges.some((e) => LIFE_DETECTORS.acord.test(edgeText(e)))) {
        issues.push({
            id: 'li-recommend-acord',
            code: 'LI_RECOMMEND_ACORD',
            severity: 'low',
            message: 'Hay intercambio con distribución, administración de pólizas o reaseguro sin declarar ACORD.',
            recommendation: 'Declara ACORD Life & Annuity (TXLife/XML) como payload de los intercambios con distribuidores, administración de pólizas y reaseguradores.',
        });
    }
    return issues;
}
