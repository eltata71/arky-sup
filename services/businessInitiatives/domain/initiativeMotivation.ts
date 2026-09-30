/**
 * An initiative as the reason an artifact exists (plan de diagramas, 6.2).
 *
 * Artifact generation declares what it needs to know about the business
 * behind a project — `ArtifactBusinessMotivation`, a contract in
 * `lib/artifacts` — because the AI layer must never import this context.
 * This is the initiative's side of that port. It chooses what the prompt
 * reads, and two choices are rules rather than formatting:
 *
 * - **An outcome is its statement, with its measure when agreed.** An outcome
 *   with no measure is still the business's expectation; dropping it would
 *   hide the work nobody has started, which is what the rollups exist to show.
 * - **A KPI says its unit and, only when it exists, its target.** A target
 *   invented to complete a sentence is the precision this product refuses
 *   everywhere else.
 */
import type { ArtifactBusinessMotivation } from '../../../lib/artifacts';
import type { BusinessInitiative, InitiativeKpi } from './BusinessInitiativeTypes';

const describeKpi = (kpi: InitiativeKpi): string => {
    const unit = kpi.unit?.trim() ? ` (${kpi.unit.trim()})` : '';
    const path = kpi.baseline !== undefined && kpi.target !== undefined
        ? `: ${kpi.baseline} → ${kpi.target}`
        : kpi.target !== undefined ? `: meta ${kpi.target}` : '';
    return `${kpi.name}${unit}${path}`;
};

/**
 * What a project declares it moves in this initiative — the port the project
 * context supplies (`AttentionContribution` fits it), so this context does not
 * import the project's (plan de calidad de artefactos, 7.3c).
 */
export interface InitiativeContributionRef {
    statement: string;
    outcomeId?: string;
    kpiId?: string;
}

/**
 * The contributions resolved against the initiative, by id. A reference that
 * no longer resolves is left out of the prompt — the portfolio graph reports
 * it; a prompt is not where a broken link should be discovered.
 */
const describeContribution = (initiative: BusinessInitiative, contributions: readonly InitiativeContributionRef[]) => {
    const outcomeIds = new Set(contributions.map((c) => c.outcomeId).filter(Boolean));
    const kpiIds = new Set(contributions.map((c) => c.kpiId).filter(Boolean));
    return {
        statements: contributions.map((c) => c.statement.trim()).filter(Boolean),
        outcomes: initiative.expectedOutcomes.filter((o) => outcomeIds.has(o.id) && o.statement.trim()).map((o) => o.statement.trim()),
        kpis: initiative.kpis.filter((k) => kpiIds.has(k.id) && k.name.trim()).map(describeKpi),
    };
};

export function describeInitiativeMotivation(
    initiative: BusinessInitiative,
    contributions: readonly InitiativeContributionRef[] = [],
): ArtifactBusinessMotivation {
    const clean = (values: readonly string[]) => values.map((value) => value.trim()).filter(Boolean);
    const contribution = contributions.length ? describeContribution(initiative, contributions) : null;
    return {
        title: initiative.title,
        code: initiative.code || undefined,
        need: initiative.need,
        driver: initiative.driver?.trim() || undefined,
        objectives: clean(initiative.objectives),
        expectedOutcomes: initiative.expectedOutcomes
            .filter((outcome) => outcome.statement.trim())
            .map((outcome) => (outcome.measure?.trim()
                ? `${outcome.statement.trim()} (se evidencia por: ${outcome.measure.trim()})`
                : outcome.statement.trim())),
        kpis: initiative.kpis.filter((kpi) => kpi.name.trim()).map(describeKpi),
        regulatoryDrivers: clean(initiative.regulatoryDrivers),
        ...(contribution && (contribution.statements.length || contribution.outcomes.length || contribution.kpis.length)
            ? { projectContribution: contribution }
            : {}),
    };
}
