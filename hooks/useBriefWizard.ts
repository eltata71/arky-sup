import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../context/AppContext';
import {
  type ArtifactGenerationContract,
  type ArtifactRecommendationCandidate,
  selectArtifactGenerationContext,
  updateArtifactBriefFromForm,
  validateArtifactGenerationContract,
} from '../services/artifacts';
import type { SourceUse, WizardStepNumber } from '../components/artifacts/wizard';
import { SOURCE_FILTER_THRESHOLD, briefReadiness, latestArtifacts, matchesSourceQuery } from '../components/artifacts/briefWizard/briefWizardModel';

interface UseBriefWizardArgs {
  project: Project;
  contract: ArtifactGenerationContract;
  candidates: ArtifactRecommendationCandidate[];
  selectedCandidateId?: string;
  onContractChange: (contract: ArtifactGenerationContract, reason?: string) => void;
  onBackToIdea: () => void;
}

export function useBriefWizard({ project, contract, candidates, selectedCandidateId, onContractChange, onBackToIdea }: UseBriefWizardArgs) {
  const [step, setStep] = useState<2 | 3 | 4 | 5>(2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const validationErrors = useMemo(() => validateArtifactGenerationContract(contract), [contract]);
  const artifacts = useMemo(() => latestArtifacts(project.artifacts ?? []), [project.artifacts]);
  const filteredArtifacts = useMemo(
    () => artifacts.filter(artifact => matchesSourceQuery(artifact, sourceQuery)),
    [artifacts, sourceQuery],
  );
  const showSourceFilter = artifacts.length >= SOURCE_FILTER_THRESHOLD;
  const selectedCandidate = candidates.find(candidate => candidate.id === selectedCandidateId) ?? candidates[0];
  const sourceMappingWarnings = useMemo(
    () => selectArtifactGenerationContext(project, contract).resolvedSourceMappings.filter(mapping => mapping.warning),
    [project, contract],
  );
  const readiness = useMemo(() => briefReadiness(contract, validationErrors), [contract, validationErrors]);
  const sourceCounts = useMemo(() => ({
    suggested: artifacts.length,
    required: contract.requiredSourceArtifactIds.length,
    optional: contract.optionalSourceArtifactIds.length,
    excluded: contract.excludedSourceArtifactIds.length,
  }), [artifacts.length, contract.requiredSourceArtifactIds.length, contract.optionalSourceArtifactIds.length, contract.excludedSourceArtifactIds.length]);

  const completedSteps = useMemo(() => {
    const completed: WizardStepNumber[] = [1];
    if (step > 2 || readiness.ready) completed.push(2);
    if (step > 3) completed.push(3);
    if (step > 4) completed.push(4);
    return completed;
  }, [step, readiness.ready]);

  const navigableSteps = useMemo<WizardStepNumber[]>(() => {
    const reachable: WizardStepNumber[] = [1, 2];
    if (step >= 3 || readiness.ready) reachable.push(3);
    if (step >= 4 || candidates.length > 0) reachable.push(4);
    if (selectedCandidate) reachable.push(5);
    return reachable;
  }, [step, readiness.ready, candidates.length, selectedCandidate]);

  const patchContract = (patch: Partial<ArtifactGenerationContract>, reason = 'brief.edited') => {
    onContractChange(updateArtifactBriefFromForm(contract, patch), reason);
  };

  const setSourceUse = (artifactId: string, use: SourceUse) => {
    const without = (ids: string[]) => ids.filter(id => id !== artifactId);
    patchContract({
      requiredSourceArtifactIds: use === 'required' ? [...without(contract.requiredSourceArtifactIds), artifactId] : without(contract.requiredSourceArtifactIds),
      optionalSourceArtifactIds: use === 'optional' ? [...without(contract.optionalSourceArtifactIds), artifactId] : without(contract.optionalSourceArtifactIds),
      excludedSourceArtifactIds: use === 'excluded' ? [...without(contract.excludedSourceArtifactIds), artifactId] : without(contract.excludedSourceArtifactIds),
    }, 'context.sources-selected');
  };

  // Move focus to the active step heading whenever the user advances or
  // navigates back.  Heading is tabIndex={-1} so it can receive focus without
  // joining the tab order; screen readers will announce the new step context.
  useEffect(() => {
    stepHeadingRef.current?.focus({ preventScroll: false });
  }, [step]);

  const handleNavigate = (target: WizardStepNumber) => {
    if (target === 1) {
      onBackToIdea();
      return;
    }
    if (target >= 2 && target <= 5) {
      setStep(target as 2 | 3 | 4 | 5);
    }
  };

  return {
    step, setStep, showAdvanced, setShowAdvanced, sourceQuery, setSourceQuery, stepHeadingRef,
    artifacts, filteredArtifacts, showSourceFilter, selectedCandidate,
    sourceMappingWarnings, readiness, sourceCounts, completedSteps, navigableSteps,
    patchContract, setSourceUse, handleNavigate,
  };
}
