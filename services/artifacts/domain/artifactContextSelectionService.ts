import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { ArtifactGenerationContract } from './artifactGenerationContract';

export interface ArtifactSourceSummary {
  id: string;
  name: string;
  type: string;
  architecturalView: string;
  phase: string;
  version: number;
  versionGroupId: string;
  createdAt: string;
  objective: string;
  qualityScore?: number;
  summary: string;
  relevanceScore: number;
}

/** How a user-requested source id was resolved against the live project. */
export type SourceResolutionKind = 'exact' | 'latest-version' | 'missing' | 'excluded-conflict';

export interface ResolvedSourceMapping {
  requestedId: string;
  resolvedId?: string;
  versionGroupId?: string;
  resolution: SourceResolutionKind;
  warning?: string;
}

export interface ArtifactContextSelectionResult {
  requiredSources: ArtifactSourceSummary[];
  optionalSources: ArtifactSourceSummary[];
  excludedSources: ArtifactSourceSummary[];
  /** Trace of how each explicitly-requested source id was resolved. */
  resolvedSourceMappings: ResolvedSourceMapping[];
  usedContextItems: string[];
  assumptions: string[];
  promptBlock: string;
}

const normalizeText = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokenize = (value: string): Set<string> => new Set(normalizeText(value).split(/[^a-z0-9]+/).filter(token => token.length >= 3));

const overlap = (left: string, rightTokens: Set<string>): number => {
  const leftTokens = tokenize(left);
  let count = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) count += 1;
  }
  return count;
};

const groupOf = (artifact: Artifact): string => artifact.versionGroupId || artifact.id;

const latestArtifacts = (artifacts: Artifact[]): Artifact[] => {
  const byGroup = new Map<string, Artifact>();
  artifacts.forEach(artifact => {
    const group = groupOf(artifact);
    const current = byGroup.get(group);
    if (!current || artifact.version > current.version) byGroup.set(group, artifact);
  });
  return Array.from(byGroup.values());
};

const summarizeContent = (artifact: Artifact, maxChars: number): string => {
  const raw = artifact.content?.trim() || artifact.objective || '';
  const compact = raw.replace(/\s+/g, ' ');
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1).trimEnd()}…`;
};

const toSummary = (artifact: Artifact, relevanceScore: number, maxChars: number): ArtifactSourceSummary => ({
  id: artifact.id,
  name: artifact.name,
  type: artifact.type,
  architecturalView: artifact.architecturalView,
  phase: artifact.phase,
  version: artifact.version,
  versionGroupId: groupOf(artifact),
  createdAt: artifact.createdAt,
  objective: artifact.objective,
  qualityScore: artifact.compilation?.compilerScore,
  summary: summarizeContent(artifact, maxChars),
  relevanceScore,
});

export interface SelectArtifactContextOptions {
  maxOptionalSources?: number;
  maxContextItems?: number;
  sourceSummaryChars?: number;
  /**
   * When true, a required source is kept at the exact version the architect
   * picked instead of being mapped forward to the latest version of its group.
   */
  preserveExactSourceVersions?: boolean;
}

export const selectArtifactGenerationContext = (
  project: Project,
  contract: ArtifactGenerationContract,
  options: SelectArtifactContextOptions = {},
): ArtifactContextSelectionResult => {
  const maxOptionalSources = options.maxOptionalSources ?? 3;
  const maxContextItems = options.maxContextItems ?? 5;
  const sourceSummaryChars = options.sourceSummaryChars ?? 900;
  const preserveExact = options.preserveExactSourceVersions ?? false;

  const allArtifacts = project.artifacts ?? [];
  const allById = new Map(allArtifacts.map(artifact => [artifact.id, artifact]));
  const latest = latestArtifacts(allArtifacts);
  const latestByGroup = new Map(latest.map(artifact => [groupOf(artifact), artifact]));

  // Exclusion set — by explicit id AND by version group. If the architect
  // excludes any version of an artifact, the whole group is excluded so an
  // older/newer sibling cannot leak back in as evidence.
  const excludedIds = new Set(contract.excludedSourceArtifactIds);
  const excludedGroups = new Set<string>();
  contract.excludedSourceArtifactIds.forEach(id => {
    const artifact = allById.get(id);
    if (artifact) excludedGroups.add(groupOf(artifact));
  });
  const isExcluded = (artifact: Artifact): boolean =>
    excludedIds.has(artifact.id) || excludedGroups.has(groupOf(artifact));

  const intentTokens = tokenize(`${contract.normalizedIntent} ${contract.originalRequest} ${contract.acceptanceCriteria.join(' ')}`);
  const resolvedSourceMappings: ResolvedSourceMapping[] = [];

  // ── Required sources ─────────────────────────────────────────────────────
  // Each requested id is resolved against the live project: kept exact,
  // mapped forward to the latest version of its group, flagged missing, or
  // flagged as conflicting with an exclusion (exclusion always wins).
  const requiredSources: ArtifactSourceSummary[] = [];
  const seenRequiredIds = new Set<string>();
  contract.requiredSourceArtifactIds.forEach(requestedId => {
    const artifact = allById.get(requestedId);
    if (!artifact) {
      resolvedSourceMappings.push({
        requestedId,
        resolution: 'missing',
        warning: `La fuente obligatoria "${requestedId}" no existe en el proyecto; se omitió sin bloquear la generación.`,
      });
      return;
    }
    const group = groupOf(artifact);
    if (isExcluded(artifact)) {
      resolvedSourceMappings.push({
        requestedId,
        versionGroupId: group,
        resolution: 'excluded-conflict',
        warning: `La fuente obligatoria "${requestedId}" entra en conflicto con una exclusión; gana la exclusión y no se usa.`,
      });
      return;
    }
    const latestOfGroup = latestByGroup.get(group) ?? artifact;
    const resolved = preserveExact ? artifact : latestOfGroup;
    if (resolved.id === artifact.id) {
      resolvedSourceMappings.push({ requestedId, resolvedId: resolved.id, versionGroupId: group, resolution: 'exact' });
    } else {
      resolvedSourceMappings.push({
        requestedId,
        resolvedId: resolved.id,
        versionGroupId: group,
        resolution: 'latest-version',
        warning: `Seleccionaste la versión v${artifact.version}; se usó la versión más reciente v${resolved.version} del mismo grupo.`,
      });
    }
    if (!seenRequiredIds.has(resolved.id)) {
      seenRequiredIds.add(resolved.id);
      requiredSources.push(toSummary(resolved, 100, sourceSummaryChars));
    }
  });

  const requiredIds = new Set(requiredSources.map(source => source.id));

  // ── Optional sources ─────────────────────────────────────────────────────
  const explicitOptional = contract.optionalSourceArtifactIds.length > 0;
  if (explicitOptional) {
    contract.optionalSourceArtifactIds.forEach(requestedId => {
      const artifact = allById.get(requestedId);
      if (!artifact) {
        resolvedSourceMappings.push({
          requestedId,
          resolution: 'missing',
          warning: `La fuente opcional "${requestedId}" no existe; se omitió.`,
        });
        return;
      }
      const group = groupOf(artifact);
      if (isExcluded(artifact)) {
        resolvedSourceMappings.push({
          requestedId,
          versionGroupId: group,
          resolution: 'excluded-conflict',
          warning: `La fuente opcional "${requestedId}" coincide con una exclusión y no se usa.`,
        });
        return;
      }
      const resolved = preserveExact ? artifact : (latestByGroup.get(group) ?? artifact);
      resolvedSourceMappings.push({
        requestedId,
        resolvedId: resolved.id,
        versionGroupId: group,
        resolution: resolved.id === artifact.id ? 'exact' : 'latest-version',
        warning: resolved.id === artifact.id
          ? undefined
          : `Fuente opcional mapeada a la versión más reciente v${resolved.version}.`,
      });
    });
  }

  const optionalPool = explicitOptional
    ? contract.optionalSourceArtifactIds
        .map(id => allById.get(id))
        .filter((artifact): artifact is Artifact => Boolean(artifact))
        .map(artifact => latestByGroup.get(groupOf(artifact)) ?? artifact)
    : latest;

  const optionalSources = optionalPool
    .filter(artifact => !isExcluded(artifact) && !requiredIds.has(artifact.id))
    .map(artifact => ({
      artifact,
      score: overlap(`${artifact.name} ${artifact.objective} ${artifact.type} ${artifact.architecturalView} ${artifact.phase} ${artifact.content.slice(0, 1200)}`, intentTokens),
    }))
    .filter(entry => explicitOptional || entry.score > 0)
    .sort((a, b) => b.score - a.score || b.artifact.version - a.artifact.version)
    .slice(0, maxOptionalSources)
    // Dedup: two requested ids can resolve to the same group's latest.
    .reduce<{ seen: Set<string>; rows: ArtifactSourceSummary[] }>((acc, entry) => {
      if (!acc.seen.has(entry.artifact.id)) {
        acc.seen.add(entry.artifact.id);
        acc.rows.push(toSummary(entry.artifact, entry.score, sourceSummaryChars));
      }
      return acc;
    }, { seen: new Set(), rows: [] })
    .rows;

  const excludedSources = contract.excludedSourceArtifactIds
    .map(id => allById.get(id))
    .filter((artifact): artifact is Artifact => Boolean(artifact))
    .map(artifact => toSummary(artifact, 0, 180));

  const usedContextItems = (contract.requiredContextItems.length > 0 ? contract.requiredContextItems : project.projectContext ?? [])
    .filter(item => !contract.excludedContextItems.some(excluded => normalizeText(item).includes(normalizeText(excluded))))
    .slice(0, maxContextItems);

  const mappingWarnings = resolvedSourceMappings.filter(mapping => mapping.warning).length;
  const assumptions = [
    requiredSources.length > 0 ? 'Las fuentes obligatorias tienen precedencia sobre heurísticas de relevancia.' : 'No se seleccionaron fuentes obligatorias; se aplicó ranking por relevancia.',
    optionalSources.length > 0 ? 'Las fuentes opcionales incluidas superaron el umbral de relevancia o fueron seleccionadas explícitamente.' : 'No se incluyeron fuentes opcionales por presupuesto o baja relevancia.',
    excludedSources.length > 0 ? 'Las fuentes excluidas no deben usarse como evidencia ni inspiración del contenido final.' : 'No hay fuentes excluidas explícitamente.',
    mappingWarnings > 0 ? `${mappingWarnings} fuente(s) requirieron resolución de versión o se omitieron; revisa la trazabilidad de mappings.` : 'Todas las fuentes solicitadas se resolvieron de forma exacta.',
  ];

  const renderSources = (title: string, sources: ArtifactSourceSummary[], includeContent = true): string => {
    if (sources.length === 0) return `### ${title}\n- Ninguna.`;
    return `### ${title}\n${sources.map(source => {
      const header = `- [${source.id}] ${source.name} · ${source.type} · ${source.architecturalView} · v${source.version} · score=${source.relevanceScore}`;
      return includeContent
        ? `${header}\n  Objetivo: ${source.objective}\n  Resumen: ${source.summary}`
        : `${header}\n  Nota: fuente excluida; se lista sólo para trazabilidad y NO debe usarse como evidencia, inspiración ni contenido.`;
    }).join('\n')}`;
  };

  const renderMappings = (): string => {
    const relevant = resolvedSourceMappings.filter(mapping => mapping.resolution !== 'exact');
    if (relevant.length === 0) return '### Resolución de versiones\n- Todas las fuentes se resolvieron de forma exacta.';
    return `### Resolución de versiones\n${relevant.map(mapping => `- ${mapping.requestedId} → ${mapping.resolvedId ?? 'n/d'} (${mapping.resolution})${mapping.warning ? `: ${mapping.warning}` : ''}`).join('\n')}`;
  };

  const promptBlock = `
## Selección controlada de fuentes/contexto
${renderSources('Fuentes obligatorias usadas', requiredSources)}
${renderSources('Fuentes opcionales usadas', optionalSources)}
${renderSources('Fuentes excluidas', excludedSources, false)}
${renderMappings()}
### Contexto textual usado
${usedContextItems.length > 0 ? usedContextItems.map((item, index) => `- (${index + 1}) ${item}`).join('\n') : '- Ninguno.'}
### Supuestos
${assumptions.map(item => `- ${item}`).join('\n')}
### Restricción dura
- Está prohibido usar las fuentes excluidas como evidencia, inspiración o contenido del artefacto final.
`;

  return { requiredSources, optionalSources, excludedSources, resolvedSourceMappings, usedContextItems, assumptions, promptBlock };
};

export interface ControlledContextValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Last-line guard run before a controlled-context selection is folded into the
 * final prompt. It never throws and never blocks generation by itself — it
 * surfaces critical issues so the caller can correct the selection or record a
 * visible warning.
 */
export const validateControlledContextForPrompt = (
  selection: ArtifactContextSelectionResult,
): ControlledContextValidationResult => {
  const warnings: string[] = [];
  const errors: string[] = [];

  const excludedIds = new Set(selection.excludedSources.map(source => source.id));
  const usedIds = [
    ...selection.requiredSources.map(source => source.id),
    ...selection.optionalSources.map(source => source.id),
  ];
  const leaked = usedIds.filter(id => excludedIds.has(id));
  if (leaked.length > 0) {
    errors.push(`Fuente(s) excluida(s) aparecen como usadas: ${leaked.join(', ')}.`);
  }

  // An excluded source whose name/objective text shows up verbatim in the used
  // textual context is also a leak.
  const normalizedContext = selection.usedContextItems.map(item => item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  selection.excludedSources.forEach(source => {
    const needle = source.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (needle.length >= 4 && normalizedContext.some(item => item.includes(needle))) {
      errors.push(`La fuente excluida "${source.name}" aparece en el contexto textual usado.`);
    }
  });

  const hasSelectedSources = selection.requiredSources.length > 0 || selection.optionalSources.length > 0;
  if (hasSelectedSources && selection.promptBlock.trim().length === 0) {
    errors.push('El bloque de prompt está vacío pese a existir fuentes seleccionadas.');
  }

  selection.resolvedSourceMappings.forEach(mapping => {
    if (mapping.resolution === 'missing' && !mapping.warning) {
      errors.push(`La fuente "${mapping.requestedId}" no se encontró y no registró advertencia.`);
    }
    if (mapping.resolution === 'latest-version') {
      warnings.push(mapping.warning ?? `La fuente "${mapping.requestedId}" se mapeó a una versión más reciente.`);
    }
    if (mapping.resolution === 'excluded-conflict') {
      warnings.push(mapping.warning ?? `Conflicto requerido/excluido en "${mapping.requestedId}" resuelto a favor de la exclusión.`);
    }
  });

  return { ok: errors.length === 0, warnings, errors };
};
