/**
 * The industry packs and the rule that decides which apply (plan de
 * diagramas, 6.4).
 *
 * Structured data first: an initiative's regulatory drivers are a statement
 * about the business, so one regulatory term there activates a pack on its
 * own. Free text — the initiative's need and objectives, the project's
 * description and context — needs two distinct vocabulary terms, because a
 * single passing word is not an industry. Every activation carries its
 * source and its evidence, so the trace can say why a diagram was drawn as a
 * health or a life one, and a wrong activation can be traced to a word.
 */
import type { ArtifactBusinessMotivation } from '../artifacts/artifactPersona';
import type { DomainPack, DomainTerm } from './domainPackTypes';
import { HEALTH_INSURANCE_PACK } from './healthInsurance';
import { LIFE_INSURANCE_PACK } from './lifeInsurance';

export type { DomainPack, DomainStandard, DomainTerm } from './domainPackTypes';
export { HEALTH_INSURANCE_PACK } from './healthInsurance';
export { LIFE_INSURANCE_PACK } from './lifeInsurance';
export { HEALTH_DETECTORS, HEALTH_REGULATORY_TERMS, HEALTH_VOCABULARY } from './healthDetectors';
export { LIFE_DETECTORS, LIFE_REGULATORY_TERMS, LIFE_VOCABULARY } from './lifeDetectors';

export const DOMAIN_PACKS: readonly DomainPack[] = [HEALTH_INSURANCE_PACK, LIFE_INSURANCE_PACK];

export interface ResolvedDomainPack {
    pack: DomainPack;
    source: 'iniciativa' | 'proyecto';
    /** The terms that activated it, by their label. */
    evidence: string[];
}

export interface DomainPackInput {
    motivations?: readonly ArtifactBusinessMotivation[];
    /** The project's own words: description, context, the artifact's objective. */
    texts: readonly (string | undefined)[];
}

const matched = (terms: readonly DomainTerm[], text: string): string[] =>
    terms.filter((term) => term.pattern.test(text)).map((term) => term.label);

export function resolveDomainPacks(input: DomainPackInput): ResolvedDomainPack[] {
    const motivations = input.motivations ?? [];
    const regulatory = motivations.flatMap((m) => m.regulatoryDrivers).join(' \n ');
    const initiativeText = motivations.flatMap((m) => [m.title, m.need, m.driver ?? '', ...m.objectives]).join(' \n ');
    const projectText = input.texts.filter(Boolean).join(' \n ');

    const resolved: ResolvedDomainPack[] = [];
    for (const pack of DOMAIN_PACKS) {
        const fromRegulation = matched([...pack.regulatoryTerms, ...pack.vocabulary], regulatory);
        const fromInitiative = matched([...pack.regulatoryTerms, ...pack.vocabulary], initiativeText);
        if (fromRegulation.length > 0 || fromInitiative.length >= 2) {
            resolved.push({ pack, source: 'iniciativa', evidence: [...new Set([...fromRegulation, ...fromInitiative])] });
            continue;
        }
        const fromProject = matched([...pack.regulatoryTerms, ...pack.vocabulary], projectText);
        if (fromProject.length >= 2) resolved.push({ pack, source: 'proyecto', evidence: fromProject });
    }
    return resolved;
}
