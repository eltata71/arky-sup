/**
 * Every insurance validator, in one call (plan de diagramas, 6.4). Each one
 * self-filters on its own domain signals, so a diagram that is neither a
 * health nor a life one gets an empty list.
 */
import type { DiagramIR } from '../../lib/diagram';
import { validateHealthcareCompliance, type DomainComplianceIssue } from './healthcareCompliance';
import { validateLifeInsuranceCompliance } from './lifeInsuranceCompliance';

export function validateInsuranceCompliance(ir: DiagramIR): DomainComplianceIssue[] {
    return [...validateHealthcareCompliance(ir), ...validateLifeInsuranceCompliance(ir)];
}
