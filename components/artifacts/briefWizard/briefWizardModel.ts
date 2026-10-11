import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactGenerationContract, ArtifactAudience, ArtifactDetailLevel, ArtifactFamilyPreference, ArtifactPurpose } from '../../../services/artifacts/domain/artifactGenerationContract';
import type { SourceUse, WizardStepNumber } from '../wizard';

export const audienceOptions: Array<{ value: ArtifactAudience; label: string }> = [
  { value: 'mixed', label: 'Mixta' },
  { value: 'executive', label: 'Ejecutiva' },
  { value: 'technical', label: 'Técnica' },
  { value: 'operations', label: 'Operaciones' },
  { value: 'business', label: 'Negocio' },
];

export const familyOptions: Array<{ value: ArtifactFamilyPreference; label: string }> = [
  { value: 'auto', label: 'Automático' },
  { value: 'document', label: 'Documento' },
  { value: 'diagram', label: 'Diagrama' },
  { value: 'hybrid', label: 'Híbrido' },
  { value: 'table', label: 'Tabla' },
  { value: 'matrix', label: 'Matriz' },
  { value: 'presentation', label: 'Presentación' },
];

export const purposeOptions: Array<{ value: ArtifactPurpose; label: string }> = [
  { value: 'explanation', label: 'Explicar' },
  { value: 'decision', label: 'Decidir' },
  { value: 'design', label: 'Diseñar' },
  { value: 'implementation', label: 'Implementar' },
  { value: 'analysis', label: 'Analizar' },
  { value: 'governance', label: 'Gobernar' },
  { value: 'comparison', label: 'Comparar' },
  { value: 'validation', label: 'Validar' },
  { value: 'communication', label: 'Comunicar' },
];

export const detailOptions: Array<{ value: ArtifactDetailLevel; label: string }> = [
  { value: 'executive', label: 'Ejecutivo' },
  { value: 'conceptual', label: 'Conceptual' },
  { value: 'logical', label: 'Lógico' },
  { value: 'physical', label: 'Físico' },
  { value: 'technical', label: 'Técnico' },
  { value: 'deep-technical', label: 'Técnico profundo' },
];

export const audienceLabel = (value: ArtifactAudience): string => audienceOptions.find(option => option.value === value)?.label ?? value;
export const purposeLabel = (value: ArtifactPurpose): string => purposeOptions.find(option => option.value === value)?.label ?? value;
export const detailLabel = (value: ArtifactDetailLevel): string => detailOptions.find(option => option.value === value)?.label ?? value;
export const familyLabel = (value: ArtifactFamilyPreference): string => familyOptions.find(option => option.value === value)?.label ?? value;

export const listToText = (items: string[]): string => items.join('\n');
export const textToList = (value: string): string[] => value.split(/\n|;|,/).map(item => item.trim()).filter(Boolean).slice(0, 10);

export const sourceUseFor = (contract: ArtifactGenerationContract, artifactId: string): SourceUse => {
  if (contract.requiredSourceArtifactIds.includes(artifactId)) return 'required';
  if (contract.optionalSourceArtifactIds.includes(artifactId)) return 'optional';
  if (contract.excludedSourceArtifactIds.includes(artifactId)) return 'excluded';
  return 'none';
};

export const latestArtifacts = (artifacts: Artifact[]): Artifact[] => {
  const byGroup = new Map<string, Artifact>();
  artifacts.forEach(artifact => {
    const group = artifact.versionGroupId || artifact.id;
    const current = byGroup.get(group);
    if (!current || artifact.version > current.version) byGroup.set(group, artifact);
  });
  return Array.from(byGroup.values()).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
};

export const briefReadiness = (
  contract: ArtifactGenerationContract,
  validationErrors: string[],
): { ready: boolean; message: string } => {
  if (validationErrors.length > 0) return { ready: false, message: validationErrors[0] };
  if (contract.normalizedIntent.trim().length < 25) {
    return { ready: false, message: 'Detalla la intención normalizada (al menos 25 caracteres) para avanzar con un brief sólido.' };
  }
  return { ready: true, message: 'El brief está suficientemente claro para continuar a la selección de fuentes.' };
};

/** Show the source search input when the project has at least this many artifacts. */
export const SOURCE_FILTER_THRESHOLD = 6;

export const matchesSourceQuery = (artifact: Artifact, query: string): boolean => {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    artifact.name,
    artifact.type,
    artifact.architecturalView,
    artifact.phase,
    artifact.objective,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
};

export const WIZARD_STEPS = [
  { number: 1 as WizardStepNumber, label: 'Idea' },
  { number: 2 as WizardStepNumber, label: 'Brief' },
  { number: 3 as WizardStepNumber, label: 'Fuentes' },
  { number: 4 as WizardStepNumber, label: 'Recomendaciones' },
  { number: 5 as WizardStepNumber, label: 'Confirmación' },
];
