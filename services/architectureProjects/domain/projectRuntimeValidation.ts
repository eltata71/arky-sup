/**
 * Hand-rolled runtime validators for the few payloads that arrive at our
 * client from outside the type system (Firestore reads, AI responses,
 * `localStorage` rehydration).
 *
 * Why not Zod? — adding ~30KB of bundle for a handful of shapes is not worth
 * it. These validators are deliberately small, dependency-free, and focused
 * on shape integrity rather than business invariants. They are only meant to
 * catch the **obvious** corruptions that would otherwise crash a render
 * (missing `id`, missing `versionGroupId`, non-string content, etc).
 *
 * It lived in `lib/` and imported three domain modules to do its job, which
 * made the layer documented as "no dependencies" depend on `memory`,
 * `publicationPipeline` and `architectureOffice`. A validator that has to know
 * what a publication package is is a service, not a helper. The docblock above
 * still describes it correctly; only its address was wrong.
 *
 * The three imports below deliberately name a file rather than the module's
 * `index.ts`. This is loaded on the eager path, and entering through a barrel
 * pulls that whole module into the entry chunk: routing these through
 * `../publicationPipeline` and `../architectureOffice` took the eager payload
 * from 658 KB gz to 1.126 KB and `check:bundle-budget` refused it. A boundary
 * is an internal property; the critical path is one the user pays for. They are
 * recorded in `checkModuleBoundaries.mjs` as what they are.
 *
 * ## Por qué vive aquí, y no en `services/persistence`
 *
 * La Ola 2 lo intentó y el gate lo rechazó: llevarlo a la persistencia metía a
 * ese módulo en un ciclo con la Oficina de Arquitectura, porque este fichero
 * conoce cuatro contextos de dominio (proyectos, publicación, memoria y los
 * códigos de iniciativa). Se quedó en la raíz de `services/` con la nota de que
 * su sitio se decidiría al partir `firestoreService`.
 *
 * Ya está partido, y la respuesta la dio el reparto: sus **dos únicos
 * llamadores** son `projectReads` y `projectDocumentMapper`, los dos de este
 * módulo. No era código compartido; era código de este agregado que estaba
 * guardado fuera porque el monolito de persistencia lo llamaba.
 *
 * Los tres pares que arrastra —publicación, memoria, oficina— ya los tenía
 * `projectDocumentMapper` registrados, así que entrar aquí no añade
 * acoplamiento: lo reatribuye a quien de verdad lo tiene.

 */

import type { Artifact } from '../../../lib/artifacts';
import type { Project, ProjectAttentionTracking, AttentionContribution, AttentionMilestone, AttentionRisk } from './ArchitectureProjectTypes';
import { validatePublicationPackages } from '../../publicationPipeline/PublicationRuntimeValidation';
import { sanitizeMemoryEntryList } from '../../memory/memoryEntries';
import { toInitiativeCodes as normalizeBusinessProjectIds } from '../../../lib/eaTerminology';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  value: T | null;
  issues: ValidationIssue[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Validates an Artifact object. Returns the artifact (with safe defaults
 * applied) or `null` if the shape is too broken to recover.
 */
export function validateArtifact(input: unknown, pathPrefix = 'artifact'): ValidationResult<Artifact> {
  const issues: ValidationIssue[] = [];

  if (!isObject(input)) {
    return { value: null, issues: [{ path: pathPrefix, message: 'No es un objeto' }] };
  }

  const id = input.id;
  const versionGroupId = input.versionGroupId;
  const version = input.version;
  const name = input.name;
  const type = input.type;
  const content = input.content;

  if (!isNonEmptyString(id)) {
    issues.push({ path: `${pathPrefix}.id`, message: 'id ausente o vacío' });
  }
  if (!isNonEmptyString(versionGroupId)) {
    issues.push({ path: `${pathPrefix}.versionGroupId`, message: 'versionGroupId ausente o vacío' });
  }
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) {
    issues.push({ path: `${pathPrefix}.version`, message: 'version no es un número válido (>=1)' });
  }
  if (!isNonEmptyString(name)) {
    issues.push({ path: `${pathPrefix}.name`, message: 'name ausente o vacío' });
  }
  if (!isNonEmptyString(type)) {
    issues.push({ path: `${pathPrefix}.type`, message: 'type ausente o vacío' });
  }
  if (typeof content !== 'string') {
    issues.push({ path: `${pathPrefix}.content`, message: 'content no es un string' });
  }

  // If any of the truly required fields are missing, this artifact cannot be
  // safely surfaced to the renderer.
  if (!isNonEmptyString(id) || !isNonEmptyString(versionGroupId) || !isNonEmptyString(name) || !isNonEmptyString(type)) {
    return { value: null, issues };
  }

  // Apply safe defaults for optional structural fields.
  const safeArtifact: Artifact = {
    id,
    versionGroupId,
    version: typeof version === 'number' && Number.isFinite(version) && version > 0 ? version : 1,
    name,
    type: type as Artifact['type'],
    phase: typeof input.phase === 'string' ? input.phase : '',
    architecturalView: (typeof input.architecturalView === 'string' ? input.architecturalView : 'Vista Lógica y de Diseño') as Artifact['architecturalView'],
    content: typeof content === 'string' ? content : '',
    objective: typeof input.objective === 'string' ? input.objective : '',
    keyConcepts: Array.isArray(input.keyConcepts)
      ? input.keyConcepts.filter((kc): kc is { term: string; definition: string } =>
          isObject(kc) && typeof kc.term === 'string' && typeof kc.definition === 'string')
      : [],
    representation: (input.representation === 'diagram' || input.representation === 'document' || input.representation === 'hybrid')
      ? input.representation
      : 'document',
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    isFavorite: input.isFavorite === true,
  };

  // Optional fields preserved as-is when present and well-formed.
  // La revisión es lo que el siguiente comando compara (ADR-106): perderla al
  // sanear convertiría cada edición tras una recarga en un conflicto falso.
  if (typeof input.revision === 'number' && Number.isInteger(input.revision) && input.revision > 0) {
    safeArtifact.revision = input.revision;
  }
  if (isObject(input.ir)) safeArtifact.ir = input.ir as unknown as Artifact['ir'];
  if (typeof input.lucidDocumentId === 'string') safeArtifact.lucidDocumentId = input.lucidDocumentId;
  if (input.audience === 'executive' || input.audience === 'technical' || input.audience === 'operations') {
    safeArtifact.audience = input.audience;
  }
  if (typeof input.theme === 'string') safeArtifact.theme = input.theme as Artifact['theme'];
  if (typeof input.coverImageUrl === 'string') safeArtifact.coverImageUrl = input.coverImageUrl;
  if (isObject(input.lastDiagramError)) safeArtifact.lastDiagramError = input.lastDiagramError as unknown as Artifact['lastDiagramError'];
  if (isObject(input.generationTrace)) safeArtifact.generationTrace = input.generationTrace as unknown as Artifact['generationTrace'];
  // Memoria del artefacto (Centro de Memoria): texts mirror + structured
  // metadata entries must survive the re-shape or the user's notes vanish on
  // every reload.
  if (isStringArray(input.artifactMemory)) safeArtifact.artifactMemory = input.artifactMemory;
  if (Array.isArray(input.artifactMemoryEntries)) {
    const entries = sanitizeMemoryEntryList(input.artifactMemoryEntries);
    if (entries.length > 0) safeArtifact.artifactMemoryEntries = entries;
  }

  return { value: safeArtifact, issues };
}

/**
 * Validates a Project object. Drops corrupt artifacts silently (with their
 * issues reported) so a single bad artifact does not poison the whole
 * project view. Returns `null` only if the project envelope itself is
 * unsalvageable.
 */
/**
 * Attention tracking is optional and hand-editable, so it is normalized rather
 * than trusted: an unknown status would otherwise reach a `Record` lookup in
 * the UI and render `undefined`.
 */
export const normalizeAttentionTracking = (
  input: unknown,
): ProjectAttentionTracking | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const statuses = ['discovery', 'design', 'review', 'delivered', 'on-hold', 'cancelled'] as const;
  const priorities = ['critical', 'high', 'medium', 'low'] as const;
  const asIso = (value: unknown): string | undefined =>
    typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
  const asText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const asPercent = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(100, Math.round(value)));
  };
  const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : []);
  /**
   * Un id ausente no descarta la fila: se le da uno estable por posición.
   *
   * Descartarla perdería un hito o un riesgo que alguien escribió, y el motivo
   * —que un documento antiguo no traía id— no es culpa de quien lo escribió.
   */
  const rowId = (value: unknown, prefix: string, index: number): string =>
    asText(value) ?? `${prefix}-${index + 1}`;

  const milestoneStates = ['pending', 'at-risk', 'met', 'missed'] as const;
  const riskLevels = ['low', 'medium', 'high', 'critical'] as const;
  const contributionStates = ['planned', 'in-progress', 'delivered', 'blocked'] as const;

  const milestones: AttentionMilestone[] = rows(raw.milestones).flatMap((entry, index) => {
    const name = asText(entry.name);
    const dueAt = asIso(entry.dueAt);
    if (!name || !dueAt) return [];
    return [{
      id: rowId(entry.id, 'hito', index),
      name,
      dueAt,
      status: milestoneStates.includes(entry.status as typeof milestoneStates[number])
        ? (entry.status as AttentionMilestone['status'])
        : 'pending',
      completedAt: asIso(entry.completedAt),
    }];
  });

  const risks: AttentionRisk[] = rows(raw.risks).flatMap((entry, index) => {
    const description = asText(entry.description);
    if (!description) return [];
    return [{
      id: rowId(entry.id, 'riesgo', index),
      description,
      level: riskLevels.includes(entry.level as typeof riskLevels[number])
        ? (entry.level as AttentionRisk['level'])
        : 'medium',
      mitigation: asText(entry.mitigation),
    }];
  });

  /*
   * Una contribución sin iniciativa no se puede consolidar contra nada, así que
   * es la única fila que sí se descarta: mantenerla produciría un aporte que no
   * aparece en ninguna iniciativa y que nadie podría encontrar para arreglarlo.
   */
  const contributions: AttentionContribution[] = rows(raw.contributions).flatMap((entry, index) => {
    const initiativeId = asText(entry.initiativeId);
    const statement = asText(entry.statement);
    if (!initiativeId || !statement) return [];
    const weight = typeof entry.weight === 'number' && Number.isFinite(entry.weight)
      ? Math.max(1, Math.min(100, Math.round(entry.weight)))
      : undefined;
    return [{
      id: rowId(entry.id, 'aporte', index),
      initiativeId,
      statement,
      outcomeId: asText(entry.outcomeId),
      kpiId: asText(entry.kpiId),
      weight,
      state: contributionStates.includes(entry.state as typeof contributionStates[number])
        ? (entry.state as AttentionContribution['state'])
        : 'planned',
      note: asText(entry.note),
    }];
  });

  return {
    status: statuses.includes(raw.status as typeof statuses[number])
      ? (raw.status as ProjectAttentionTracking['status'])
      : 'discovery',
    priority: priorities.includes(raw.priority as typeof priorities[number])
      ? (raw.priority as ProjectAttentionTracking['priority'])
      : 'medium',
    architectureLead: asText(raw.architectureLead),
    startDate: asIso(raw.startDate),
    targetEndDate: asIso(raw.targetEndDate),
    healthNote: asText(raw.healthNote),
    progress: asPercent(raw.progress),
    // Las listas vacías no se guardan: un documento con `risks: []` y uno sin
    // el campo dicen lo mismo, y el segundo pesa menos en cada lectura.
    milestones: milestones.length > 0 ? milestones : undefined,
    risks: risks.length > 0 ? risks : undefined,
    contributions: contributions.length > 0 ? contributions : undefined,
  };
};

export function validateProject(input: unknown, pathPrefix = 'project'): ValidationResult<Project> {
  const issues: ValidationIssue[] = [];

  if (!isObject(input)) {
    return { value: null, issues: [{ path: pathPrefix, message: 'No es un objeto' }] };
  }

  const id = input.id;
  const name = input.name;
  if (!isNonEmptyString(id)) {
    return { value: null, issues: [{ path: `${pathPrefix}.id`, message: 'id ausente o vacío' }] };
  }
  if (!isNonEmptyString(name)) {
    issues.push({ path: `${pathPrefix}.name`, message: 'name ausente o vacío' });
  }

  const rawArtifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  const artifacts: Artifact[] = [];
  rawArtifacts.forEach((rawArtifact, index) => {
    const artifactResult = validateArtifact(rawArtifact, `${pathPrefix}.artifacts[${index}]`);
    issues.push(...artifactResult.issues);
    if (artifactResult.value) artifacts.push(artifactResult.value);
  });

  const safeProject: Project = {
    id,
    name: isNonEmptyString(name) ? name : 'Proyecto sin nombre',
    description: typeof input.description === 'string' ? input.description : '',
    projectContext: isStringArray(input.projectContext) ? input.projectContext : [],
    initiativeIds: isStringArray(input.initiativeIds) ? [...new Set(input.initiativeIds)] : [],
    linkedBusinessProjects: normalizeBusinessProjectIds(input.linkedBusinessProjects),
    artifacts,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  };

  // Optional fields preserved as-is when present and well-formed. The
  // Architecture Knowledge Graph is deeply validated at the persistence
  // boundary (`ArchitectureGraphPersistenceAdapter`), so here it only needs
  // to survive the project re-shape.
  const attention = normalizeAttentionTracking(input.attention);
  if (attention) safeProject.attention = attention;
  if (isStringArray(input.agentMemory)) safeProject.agentMemory = input.agentMemory;
  if (isStringArray(input.initialCapture)) safeProject.initialCapture = input.initialCapture;
  // Structured memory metadata (fecha, autor, prioridad) for each scope.
  if (Array.isArray(input.projectContextEntries)) {
    const entries = sanitizeMemoryEntryList(input.projectContextEntries);
    if (entries.length > 0) safeProject.projectContextEntries = entries;
  }
  if (Array.isArray(input.agentMemoryEntries)) {
    const entries = sanitizeMemoryEntryList(input.agentMemoryEntries);
    if (entries.length > 0) safeProject.agentMemoryEntries = entries;
  }
  if (Array.isArray(input.initialCaptureEntries)) {
    const entries = sanitizeMemoryEntryList(input.initialCaptureEntries);
    if (entries.length > 0) safeProject.initialCaptureEntries = entries;
  }
  if (isObject(input.architectureKnowledgeGraph)) {
    safeProject.architectureKnowledgeGraph =
      input.architectureKnowledgeGraph as unknown as Project['architectureKnowledgeGraph'];
  }
  // Publication packages are deeply validated by the publication pipeline's
  // own runtime validators; corrupt packages are dropped, valid ones kept.
  if (Array.isArray(input.publicationPackages)) {
    const packagesResult = validatePublicationPackages(input.publicationPackages);
    packagesResult.issues.forEach((issue) => {
      issues.push({ path: `${pathPrefix}.${issue.path}`, message: issue.message });
    });
    if (packagesResult.value && packagesResult.value.length > 0) {
      safeProject.publicationPackages = packagesResult.value;
    }
  }

  // La revisión optimista de la fila (F4-07): la próxima escritura la compara.
  // Perderla al sanear era perder la única forma correcta de guardar después.
  if (typeof input.revision === 'number' && Number.isInteger(input.revision) && input.revision > 0) {
    safeProject.revision = input.revision;
  }

  // Artifact loading state.
  //
  // These must survive the re-shape or the safety property they exist for is
  // lost: a project read from the portfolio arrives with no artifact bodies,
  // and `artifactsLoaded: false` is the only thing distinguishing that from a
  // project that genuinely has none. Dropping it here would make every
  // portfolio rollup silently report zero — which is exactly what this
  // validator's own re-shape did until a spec caught it.
  if (typeof input.artifactsLoaded === 'boolean') {
    safeProject.artifactsLoaded = input.artifactsLoaded;
  }
  if (typeof input.artifactCount === 'number' && Number.isFinite(input.artifactCount)) {
    safeProject.artifactCount = input.artifactCount;
  }
  if (Array.isArray(input.artifactIndex)) {
    // Identity only, and every entry must carry the fields the portfolio
    // groups by; a malformed entry is dropped rather than allowed to produce
    // an artifact node with no version to compare.
    const summaries = input.artifactIndex.filter((entry): entry is NonNullable<Project['artifactIndex']>[number] => (
      isObject(entry)
      && isNonEmptyString(entry.id)
      && isNonEmptyString(entry.versionGroupId)
      && typeof entry.version === 'number'
    ));
    if (summaries.length !== input.artifactIndex.length) {
      issues.push({
        path: `${pathPrefix}.artifactIndex`,
        message: `Se descartaron ${input.artifactIndex.length - summaries.length} entrada(s) de índice malformadas`,
      });
    }
    safeProject.artifactIndex = summaries;
  }

  return { value: safeProject, issues };
}

/** Convenience: validates a list of projects, dropping unrecoverable ones. */
export function validateProjects(input: unknown[]): ValidationResult<Project[]> {
  const issues: ValidationIssue[] = [];
  const projects: Project[] = [];
  input.forEach((rawProject, index) => {
    const result = validateProject(rawProject, `projects[${index}]`);
    issues.push(...result.issues);
    if (result.value) projects.push(result.value);
  });
  return { value: projects, issues };
}
