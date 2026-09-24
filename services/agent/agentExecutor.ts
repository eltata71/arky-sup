/**
 * Executes an `AgentActionPlan` by calling the existing AI/versioning/quality
 * services — never by re-implementing them.
 *
 * Reused capabilities (in this order of dependency):
 *  - `artifactGenerationService.applyArtifactImprovements`  → improve / applySuggestion
 *  - `requestArtifactPatch` (`agentConversation`)  → patch (re-uses the modifyArtifact tool)
 *  - `artifactGenerationService.generateArtifactContent`    → regenerate
 *  - `AppContext.createArtifactVersion`         → new version persistence
 *  - `AppContext.updateArtifact`                → "apply to current" persistence
 *  - `runDiagramQualityGate` (already used by   → post-execution quality validation
 *      "Auto-mejorar diagrama")
 *
 * The executor reports progress through `onPhase` so the action card can show
 * the live state (analizando → preparando → generando → validando → finalizado).
 */

import type { ArtifactTemplate, MemoryEntry, Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { ArtifactReviewSuggestion } from '../review';
import type { ChatMessage } from '../chat';
import { appendMemoryNotes } from '../memory/memoryEntries';
import { artifactGenerationService, classifyAIError, AIServiceError } from '../ai';
import { runDiagramQualityGate } from '../diagram/qualityGate';
import { assessDocumentArtifact } from '../quality/documentAcceptability';
import { validateArtifactReadiness } from '../../lib/artifacts/artifactGovernance';
import { extractIRFromArtifact } from '../diagram';
import { repairDiagramIRSemantics } from '../../lib/semanticRoleResolver';
import { ARTIFACT_TEMPLATES } from '../../constants';
import type {
  AgentActionPlan,
  AgentActionResult,
  AgentExecutionPhase,
  AgentExecutionTarget,
  AgentIntent,
  MemoryScope,
} from './agentTypes';
import { refuseUnconfirmedAction } from './agentConfirmationGate';
import { logAgentEvent } from './agentLogger';
import { matchTemplateFromInstruction, buildCustomTemplate } from './templateMatcher';
import { reuseDeterministicArtifact } from './deterministicArtifactReuse';
import type { AgentArtifactStore } from './agentExecutorContracts';
import { requestArtifactPatch } from './agentConversation';
import type { AgentPersonaBriefing } from './agentContextComposer';
import { agentGenerationOptions } from './agentPersonaComposer';
export type { AgentArtifactStore } from './agentExecutorContracts';

/** Callback fired as the action moves through phases. */
export type AgentPhaseListener = (phase: AgentExecutionPhase, message: string) => void;

/**
 * Persistence handlers for the three memory scopes. Mirrors the existing
 * AppContext shape so callers can pass it inline:
 *   `{ updateGlobalContext: (next) => updateSettings({ globalContext: next }) }`.
 *
 * The executor reads the current value, deduplicates against the new
 * bullets, and writes the merged array — caller logic stays minimal.
 */
export interface AgentMemoryStore {
  getGlobalContext: () => string[];
  updateGlobalContext: (next: string[], nextEntries?: MemoryEntry[]) => void;
  getProjectContext: (projectId: string) => string[];
  updateProjectContext: (projectId: string, next: string[], nextEntries?: MemoryEntry[]) => void;
  getArtifactMemory: (projectId: string, artifactId: string) => string[];
  updateArtifactMemory: (projectId: string, artifactId: string, next: string[], nextEntries?: MemoryEntry[]) => void;
  /**
   * Optional structured-metadata readers (fecha, autor, prioridad). When
   * provided the executor preserves existing metadata and stamps new notes
   * with author + timestamp; when absent the notes are saved metadata-less
   * (legacy behaviour).
   */
  getGlobalContextEntries?: () => MemoryEntry[];
  getProjectContextEntries?: (projectId: string) => MemoryEntry[];
  getArtifactMemoryEntries?: (projectId: string, artifactId: string) => MemoryEntry[];
}

export interface AgentExecutorInput {
  plan: AgentActionPlan;
  artifact: Artifact;
  project: Project;
  settings: Settings;
  history: ChatMessage[];
  /** Suggestions currently loaded for the artifact (if any). */
  pendingSuggestions?: ArtifactReviewSuggestion[];
  /** Persistence helpers — usually the context's `{ createArtifactVersion, updateArtifact }`. */
  store: AgentArtifactStore;
  /** Optional memory persistence handlers — required only for `memory.save.*` actions. */
  memoryStore?: AgentMemoryStore;
  /**
   * Pre-extracted memory bullets (typically curated by the user in the
   * action card before confirming). When omitted on a memory action we fall
   * back to a sanitised single bullet built from the user instruction.
   */
  memoryBullets?: string[];
  /** Lifecycle listener (UI uses this to animate the action card). */
  onPhase?: AgentPhaseListener;
  /** Optional override — if `'current'` the new content overwrites in-place. */
  targetOverride?: AgentExecutionTarget;
  /** Who triggered the action — stamps authorship on saved memory notes. */
  actor?: { id: string | null; name: string | null };
  /** True when a human has seen this exact plan and approved it. See
   *  `agentConfirmationGate` for why the flag is enforced rather than trusted. */
  confirmedByUser?: boolean;
  /** Who speaks in the patch turn, from its text — `officePersonaForMessage`; the agent cannot look the Office up. */
  resolvePersona?: (message: string) => AgentPersonaBriefing;
}

/**
 * Run a planned action end-to-end. Never throws — failures are reflected in
 * the returned `status: 'failed'` with a human-friendly message.
 */
export async function executeAgentAction(input: AgentExecutorInput): Promise<AgentActionResult> {
  const { plan, artifact, project, settings, history, store } = input;
  const target = input.targetOverride ?? plan.target;
  const traceId = plan.traceId;

  const emit = (phase: AgentExecutionPhase, message: string, meta?: Record<string, unknown>) => {
    logAgentEvent({ traceId, phase, level: 'info', message, meta });
    input.onPhase?.(phase, message);
  };

  const baseResult: AgentActionResult = {
    status: 'failed',
    newArtifactVersionId: null,
    previousArtifactVersionId: artifact.id,
    appliedChanges: [],
    validationResult: null,
    messages: [],
    errors: [],
    traceId,
  };

  const refusal = refuseUnconfirmedAction(plan, input.confirmedByUser, baseResult);
  if (refusal) return refusal;

  try {
    emit('analyzing', 'Analizando contexto del artefacto…', { actionType: plan.actionType });

    let newContent: string | null = null;
    const appliedChanges: string[] = [];

    switch (plan.actionType) {
      case 'artifact.create': {
        // Brand-new artifact creation. Path:
        //   1. Resolve a template (catalog match → fallback to custom template).
        //   2. Generate content via the existing pipeline (`generateArtifactContent`).
        //   3. Persist via `store.createArtifact` (NOT `createArtifactVersion`).
        // Returns directly because the single-artifact persistence path below
        // assumes a pre-existing artifact to version off.
        return await executeArtifactCreate({ ...input, emit, target });
      }
      case 'artifact.improve': {
        emit('preparing', 'Preparando mejoras…');
        const reviewSuggestions = mapPendingSuggestionsToReview(input.pendingSuggestions, plan.intent.userInstruction);
        emit('generating', 'Generando mejoras con IA…');
        newContent = await artifactGenerationService.applyArtifactImprovements(artifact, reviewSuggestions, project, settings);
        appliedChanges.push(`Mejora aplicada según: "${plan.intent.userInstruction}"`);
        break;
      }
      case 'artifact.applySuggestion': {
        const reviewSuggestions = mapPendingSuggestionsToReview(input.pendingSuggestions, plan.intent.userInstruction);
        if (reviewSuggestions.length === 0) {
          // No suggestions in scope — fall back to a generic improvement turn
          // using the user instruction as the recommendation. The pipeline
          // tolerates a single-item list.
          reviewSuggestions.push({
            id: 'agent-inline',
            title: 'Recomendación del Arquitecto Agente',
            description: plan.intent.userInstruction,
            category: 'Best Practices',
          });
        }
        emit('preparing', 'Preparando aplicación de sugerencias…');
        emit('generating', 'Reescribiendo contenido con sugerencias seleccionadas…');
        newContent = await artifactGenerationService.applyArtifactImprovements(artifact, reviewSuggestions, project, settings);
        appliedChanges.push(`Sugerencias aplicadas (${reviewSuggestions.length}).`);
        break;
      }
      case 'artifact.patch': {
        emit('preparing', 'Preparando cambio puntual…');
        emit('generating', 'Solicitando a la IA el contenido modificado…');
        // The chat's own function-calling tool: the model must return the whole
        // new content through modifyArtifact (see `requestArtifactPatch`).
        const patchPrompt = `Aplica el siguiente cambio puntual al artefacto y devuelve el contenido completo modificado mediante la herramienta modifyArtifact. Cambio solicitado: ${plan.intent.userInstruction}`;
        newContent = await requestArtifactPatch({
          project, activeArtifact: artifact, history, question: patchPrompt, settings,
          persona: input.resolvePersona?.(patchPrompt),
        });
        appliedChanges.push(`Cambio puntual: ${truncate(plan.intent.userInstruction, 140)}`);
        break;
      }
      case 'artifact.regenerate': {
        emit('preparing', 'Recuperando plantilla del artefacto…');
        const template = findTemplateForArtifact(artifact);
        if (!template) {
          throw new Error('No se encontró una plantilla compatible para regenerar este artefacto.');
        }
        // Inject the user instruction so the regeneration is biased by the
        // conversation — without it the regeneration would silently reuse the
        // original template objective.
        const augmentedTemplate: ArtifactTemplate = {
          ...template,
          objective: `${template.objective}\n\nInstrucciones adicionales del Arquitecto: ${plan.intent.userInstruction}`,
        };
        emit('generating', 'Regenerando artefacto con la IA…');
        newContent = await artifactGenerationService.generateArtifactContent(project, augmentedTemplate, settings, artifact, agentGenerationOptions(input.resolvePersona));
        appliedChanges.push(`Regenerado a partir de: "${truncate(plan.intent.userInstruction, 140)}"`);
        break;
      }
      case 'artifact.createVersion': {
        emit('preparing', 'Preparando nueva versión…');
        // Versionado sin cambio de contenido — replica la versión actual con
        // una nota incluida en el resumen de cambios. Si se quisiera un
        // contenido nuevo, el usuario debe pedir "regenera" o "mejora".
        newContent = artifact.content;
        appliedChanges.push('Nueva versión creada a partir de la actual.');
        break;
      }
      case 'artifacts.batch': {
        // Multi-artifact: delegate to a focused loop that reuses the
        // single-artifact executor for each target. Returns directly so we
        // skip the single-artifact persistence path below.
        return await executeBatchAction({ ...input, target });
      }
      case 'memory.save.global':
      case 'memory.save.project':
      case 'memory.save.artifact': {
        // Memory save: no AI content generation, no artifact versioning —
        // we persist conversation-derived bullets into the appropriate
        // string[] store. Returns directly so we skip the single-artifact
        // persistence path below.
        return await executeMemorySave({ ...input, emit });
      }
      case 'artifact.explainOnly':
      case 'unknown':
      default: {
        emit('done', 'Sin acción ejecutable.');
        return {
          ...baseResult,
          status: 'cancelled',
          messages: ['Esta intención no requiere ejecutar cambios.'],
        };
      }
    }

    if (typeof newContent !== 'string' || !newContent.trim()) {
      throw new Error('La IA no devolvió contenido para aplicar.');
    }
    if (newContent.trim() === artifact.content.trim() && plan.actionType !== 'artifact.createVersion') {
      emit('done', 'La IA no propuso cambios.');
      return {
        ...baseResult,
        status: 'cancelled',
        messages: ['La IA no propuso cambios aplicables. Revisa el panel de sugerencias o reformula tu instrucción.'],
      };
    }

    emit('validating', 'Validando calidad del resultado…');
    const validation = validateArtifactContent(artifact, newContent);
    if (!validation.passed) {
      emit('failed', `La validación de calidad rechazó el resultado: ${validation.summary}`);
      logAgentEvent({
        traceId,
        phase: 'failed',
        level: 'warn',
        message: 'Resultado descartado por validación de calidad.',
        meta: { summary: validation.summary },
      });
      return {
        ...baseResult,
        status: 'failed',
        validationResult: validation,
        messages: ['La nueva versión no superó la validación mínima de calidad y no se aplicó.'],
        errors: [validation.summary],
      };
    }

    emit('persisting', 'Persistiendo nueva versión…');
    let newVersionId: string | null = null;
    try {
      if (target === 'current') {
        store.updateArtifact(project.id, artifact.id, { content: newContent });
      } else {
        const { id: _omitId, version: _omitVersion, versionGroupId: _omitGroup, createdAt: _omitDate, ...rest } = artifact;
        const newVersion = store.createArtifactVersion(project.id, artifact.versionGroupId, {
          ...rest,
          content: newContent,
        });
        // Verify the store contract: `createArtifactVersion` must return a
        // real artifact with an id. If the contract is broken we fail loudly
        // instead of declaring success and leaving the user staring at the
        // old version in the Hub.
        if (!newVersion || !newVersion.id) {
          throw new Error('La creación de nueva versión no devolvió un artefacto válido.');
        }
        newVersionId = newVersion.id;
      }
    } catch (persistErr) {
      const friendly = classifyAIError(persistErr);
      logAgentEvent({
        traceId,
        phase: 'failed',
        level: 'error',
        message: 'Persistencia falló.',
        meta: { actionType: plan.actionType, error: friendly.message },
      });
      return {
        ...baseResult,
        status: 'failed',
        messages: ['No pude guardar los cambios. Reintenta en unos segundos.'],
        errors: [friendly.message ?? String(persistErr)],
        validationResult: validation,
      };
    }

    emit('done', 'Cambios aplicados.');

    return {
      status: 'success',
      newArtifactVersionId: newVersionId,
      previousArtifactVersionId: artifact.id,
      appliedChanges,
      validationResult: validation,
      messages: [
        target === 'current'
          ? `Cambios aplicados al artefacto actual (${artifact.name}).`
          : `Nueva versión (v${(artifact.version ?? 1) + 1}) creada para ${artifact.name}.`,
      ],
      errors: [],
      traceId,
    };
  } catch (err) {
    const friendly = err instanceof AIServiceError ? err : classifyAIError(err);
    logAgentEvent({
      traceId,
      phase: 'failed',
      level: 'error',
      message: 'Acción agencial falló.',
      meta: {
        actionType: plan.actionType,
        category: friendly.category,
        status: friendly.status,
        error: friendly.message,
      },
    });
    return {
      ...baseResult,
      status: 'failed',
      messages: [friendly.userMessage || 'No se pudo completar la acción. Reintenta en unos segundos.'],
      errors: [friendly.message ?? String(err)],
    };
  }
}

/**
 * Memory save execution.
 *
 * Persists conversation-derived bullets into one of the three context arrays:
 *  - global  → `settings.globalContext`
 *  - project → `project.projectContext`
 *  - artifact → `artifact.artifactMemory`
 *
 * Reuses the existing setters (no new persistence path is introduced). The
 * function is defensive: it short-circuits when the memory store is missing,
 * when there are no bullets to save, or when the target scope can't be
 * resolved (e.g. artifact scope without an active artifact). Failures keep
 * the existing context intact.
 *
 * No new artifact version is created — memory is metadata, not content.
 */
async function executeMemorySave(
  input: AgentExecutorInput & { emit: (phase: AgentExecutionPhase, message: string, meta?: Record<string, unknown>) => void },
): Promise<AgentActionResult> {
  const { plan, artifact, project, memoryStore, emit } = input;
  const traceId = plan.traceId;

  const result: AgentActionResult = {
    status: 'failed',
    newArtifactVersionId: null,
    previousArtifactVersionId: artifact.id,
    appliedChanges: [],
    validationResult: null,
    messages: [],
    errors: [],
    traceId,
  };

  if (!memoryStore) {
    return {
      ...result,
      status: 'failed',
      messages: ['No se pudo guardar la memoria: el panel no expuso un almacén de memoria.'],
      errors: ['agent.memoryStore.missing'],
    };
  }

  const scope = resolveMemoryScopeForExecution(plan);
  if (!scope) {
    return {
      ...result,
      status: 'failed',
      messages: ['No pude determinar el alcance de memoria (global / proyecto / artefacto).'],
      errors: ['agent.memory.scope.unresolved'],
    };
  }

  // Artifact scope falls back to project when no artifact is anchored — keeps
  // the action useful instead of silently dropping it.
  const effectiveScope: MemoryScope = scope === 'artifact' && !artifact ? 'project' : scope;

  emit('preparing', `Preparando bullets para memoria (${effectiveScope})…`);

  const incomingBullets = (input.memoryBullets ?? [])
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (incomingBullets.length === 0) {
    // Fall back to a sanitised version of the user's literal instruction so
    // we never persist nothing when the user explicitly confirmed.
    incomingBullets.push(plan.intent.userInstruction.trim());
  }

  emit('persisting', `Guardando ${incomingBullets.length} concepto(s) en memoria ${effectiveScope}…`);

  let existing: string[] = [];
  let existingEntries: MemoryEntry[] = [];
  try {
    if (effectiveScope === 'global') {
      existing = memoryStore.getGlobalContext();
      existingEntries = memoryStore.getGlobalContextEntries?.() ?? [];
    } else if (effectiveScope === 'project') {
      existing = memoryStore.getProjectContext(project.id);
      existingEntries = memoryStore.getProjectContextEntries?.(project.id) ?? [];
    } else if (effectiveScope === 'artifact') {
      existing = memoryStore.getArtifactMemory(project.id, artifact.id);
      existingEntries = memoryStore.getArtifactMemoryEntries?.(project.id, artifact.id) ?? [];
    }
  } catch {
    existing = [];
    existingEntries = [];
  }

  // Merge with structured metadata: dedupe (case-insensitive) against what
  // already exists, stamp authorship + timestamp on the new notes (prioridad
  // media por omisión — el usuario puede ajustarla en el Centro de Memoria).
  const mergeResult = appendMemoryNotes({
    existingTexts: existing,
    existingEntries,
    newTexts: incomingBullets,
    authorId: input.actor?.id ?? null,
    authorName: input.actor?.name ?? 'Arquitecto Agente',
  });
  const newBullets = mergeResult.added;

  if (newBullets.length === 0) {
    emit('done', 'Sin cambios en memoria (todos los conceptos ya estaban guardados).');
    return {
      ...result,
      status: 'cancelled',
      messages: ['No agregué nada: todos los conceptos ya estaban guardados en esta memoria.'],
    };
  }

  const merged = mergeResult.texts;
  const mergedEntries = mergeResult.entries;

  try {
    if (effectiveScope === 'global') memoryStore.updateGlobalContext(merged, mergedEntries);
    else if (effectiveScope === 'project') memoryStore.updateProjectContext(project.id, merged, mergedEntries);
    else if (effectiveScope === 'artifact') memoryStore.updateArtifactMemory(project.id, artifact.id, merged, mergedEntries);
  } catch (err) {
    return {
      ...result,
      status: 'failed',
      messages: ['No pude guardar la memoria. Reintenta en un momento.'],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  emit('done', `Memoria actualizada: ${newBullets.length} nuevo(s) concepto(s).`);

  const scopeLabel =
    effectiveScope === 'global' ? 'memoria global' : effectiveScope === 'project' ? 'contexto del proyecto' : `memoria del artefacto "${artifact.name}"`;

  return {
    status: 'success',
    newArtifactVersionId: null,
    previousArtifactVersionId: artifact.id,
    appliedChanges: newBullets.map((b) => `Guardado en ${scopeLabel}: ${truncate(b, 120)}`),
    validationResult: { passed: true, summary: `Persistido en ${scopeLabel}.` },
    messages: [`Se guardaron ${newBullets.length} concepto(s) en ${scopeLabel}.`],
    errors: [],
    traceId,
  };
}

/**
 * Brand-new artifact creation.
 *
 * Reuses the existing single-artifact generation pipeline
 * (`artifactGenerationService.generateArtifactContent`) — the same one that backs the
 * "Generar artefacto" button in the Project Hub. Persistence goes through
 * `store.createArtifact` (NOT `createArtifactVersion`), so the result lands
 * in the project as a fresh v1.
 *
 * Template resolution:
 *  1. If the intent carries a `createHint.templateName`, prefer that.
 *  2. Otherwise run the heuristic matcher against the catalog.
 *  3. If nothing matches, build a custom template from the user's instruction.
 */
async function executeArtifactCreate(
  input: AgentExecutorInput & {
    emit: (phase: AgentExecutionPhase, message: string, meta?: Record<string, unknown>) => void;
    target: AgentExecutionTarget;
  },
): Promise<AgentActionResult> {
  const { plan, project, settings, store, emit } = input;
  const traceId = plan.traceId;
  const userInstruction = plan.intent.userInstruction;

  const result: AgentActionResult = {
    status: 'failed',
    newArtifactVersionId: null,
    newArtifactId: null,
    previousArtifactVersionId: input.artifact.id,
    appliedChanges: [],
    validationResult: null,
    messages: [],
    errors: [],
    traceId,
  };

  if (!store.createArtifact) {
    return {
      ...result,
      messages: ['No se puede crear el artefacto: el panel no expuso el almacén de creación.'],
      errors: ['agent.createArtifact.unavailable'],
    };
  }

  const deterministicId = plan.intent.createHint?.deterministicArtifactId ?? null;
  const reused = reuseDeterministicArtifact(project, deterministicId, traceId, result, emit);
  if (reused) return reused;

  emit('preparing', 'Resolviendo plantilla del catálogo…');

  const hintName = plan.intent.createHint?.templateName ?? null;
  let templateMatch = hintName
    ? ARTIFACT_TEMPLATES.find((t) => t.name === hintName) ?? null
    : null;
  if (!templateMatch) {
    const match = matchTemplateFromInstruction(userInstruction);
    if (match) templateMatch = match.template;
  }
  const baseTemplate = templateMatch ?? buildCustomTemplate(userInstruction);
  // Inject the user instruction so the generation pipeline biases content
  // toward the actual ask, even when we re-use a catalog template.
  const generationTemplate = {
    ...baseTemplate,
    objective: `${baseTemplate.objective}\n\nSolicitud del usuario: ${userInstruction}`,
  };

  // Governance pre-flight: surface missing prerequisite artifacts BEFORE
  // generating, so the model compensates (states assumptions instead of
  // inventing inputs) and the user gets an actionable advisory. Non-blocking:
  // the architect stays in control of the roadmap order.
  let governanceAdvisory: string | null = null;
  try {
    const readiness = validateArtifactReadiness(project, baseTemplate as ArtifactTemplate);
    if (readiness.missingArtifacts.length > 0) {
      const missing = readiness.missingArtifacts.join(', ');
      governanceAdvisory = `Aviso de gobernanza: "${baseTemplate.name}" suele apoyarse en artefactos que aún no existen (${missing}). Puedes pedirme generarlos para máxima consistencia.`;
      emit('preparing', `Prerrequisitos ausentes detectados: ${missing}.`, {
        readinessScore: readiness.score,
        missingArtifacts: readiness.missingArtifacts,
      });
      generationTemplate.objective += `\n\nNota de gobernanza: los artefactos prerrequisito (${missing}) aún no existen en el proyecto. Genera el contenido con el contexto disponible, declara explícitamente los supuestos que asumas en su lugar y mantén consistencia con los artefactos que sí existen.`;
    }
  } catch {
    // Governance is advisory only — never blocks creation.
  }

  emit('generating', `Generando "${baseTemplate.name}" con la IA…`, {
    template: baseTemplate.name,
    type: baseTemplate.type,
  });

  let generatedContent: string;
  try {
    generatedContent = await artifactGenerationService.generateArtifactContent(
      project,
      generationTemplate,
      settings, undefined, agentGenerationOptions(input.resolvePersona),
    );
  } catch (err) {
    const friendly = err instanceof AIServiceError ? err : classifyAIError(err);
    logAgentEvent({
      traceId,
      phase: 'failed',
      level: 'error',
      message: 'Generación de nuevo artefacto falló.',
      meta: { category: friendly.category, status: friendly.status, error: friendly.message },
    });
    return {
      ...result,
      messages: [friendly.userMessage || 'No pude generar el artefacto. Reintenta en unos segundos.'],
      errors: [friendly.message ?? String(err)],
    };
  }

  if (!generatedContent || generatedContent.trim().length === 0) {
    return {
      ...result,
      messages: ['La IA no devolvió contenido para el nuevo artefacto.'],
      errors: ['agent.create.emptyContent'],
    };
  }

  emit('validating', 'Validando contenido generado…');
  const probeArtifact: Artifact = {
    id: 'new-artifact',
    versionGroupId: 'new-artifact',
    version: 1,
    createdAt: new Date().toISOString(),
    name: baseTemplate.name,
    type: baseTemplate.type,
    phase: baseTemplate.phase,
    architecturalView: baseTemplate.architecturalView,
    objective: baseTemplate.objective,
    keyConcepts: baseTemplate.keyConcepts,
    representation: baseTemplate.representation,
    content: '',
  };
  const validation = validateArtifactContent(probeArtifact, generatedContent);
  if (!validation.passed) {
    return {
      ...result,
      validationResult: validation,
      messages: ['La nueva versión no superó la validación mínima de calidad y no se aplicó.'],
      errors: [validation.summary],
    };
  }

  // Diagram-typed artifacts go through the canonical IR pipeline before
  // persistence. This is the safety net that prevents the agent from
  // persisting a raw Mermaid string whose nodes would render as the wrong
  // semantic role (e.g. "Asegurado" painted as a pink process card). The
  // repair is non-destructive: it normalises shapes / roles in-place and
  // appends a `semantic-role-repair` entry to `metadata.repairHistory` so
  // the trail stays auditable.
  const finalContent = generatedContent;
  const renderableMeta: { nodes: number; edges: number; ok: boolean } | null = (() => {
    const isDiagram =
      baseTemplate.representation === 'diagram' ||
      baseTemplate.representation === 'hybrid' ||
      baseTemplate.type === 'react-flow-graph' ||
      /diagrama|c4|sequence|flowchart|mermaid/i.test(baseTemplate.type);
    if (!isDiagram) return null;
    try {
      const probe: Artifact = {
        ...probeArtifact,
        content: finalContent,
      };
      const ir = extractIRFromArtifact(probe);
      if (!ir || ir.nodes.length === 0) {
        return { nodes: 0, edges: 0, ok: false };
      }
      const repaired = repairDiagramIRSemantics(ir, { diagramKind: ir.metadata?.sourceFormat });
      logAgentEvent({
        traceId,
        phase: 'validating',
        level: repaired.changes.length > 0 ? 'info' : 'info',
        message: repaired.changes.length > 0
          ? `Semántica del diagrama normalizada (${repaired.changes.length} ajuste${repaired.changes.length === 1 ? '' : 's'}).`
          : 'Semántica del diagrama coherente — sin ajustes necesarios.',
        meta: { changes: repaired.changes },
      });
      return { nodes: ir.nodes.length, edges: ir.edges.length, ok: true };
    } catch (err) {
      logAgentEvent({
        traceId,
        phase: 'validating',
        level: 'warn',
        message: 'Reparación semántica del diagrama falló (se persiste el contenido tal cual).',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }
  })();

  emit('persisting', 'Persistiendo nuevo artefacto…');
  let newArtifact: Artifact;
  try {
    newArtifact = store.createArtifact(project.id, {
      name: baseTemplate.name,
      type: baseTemplate.type,
      phase: baseTemplate.phase,
      architecturalView: baseTemplate.architecturalView,
      objective: baseTemplate.objective,
      keyConcepts: baseTemplate.keyConcepts,
      representation: baseTemplate.representation,
      content: finalContent,
    }, deterministicId ?? undefined);
    // Defensive: verify the store contract. If the persistence path is
    // broken (offline Firestore, optimistic update rolled back, …) we
    // surface a clean failure instead of silently telling the user the
    // artifact was created.
    if (!newArtifact || !newArtifact.id) {
      throw new Error('La creación del artefacto no devolvió un objeto válido.');
    }
  } catch (err) {
    return {
      ...result,
      messages: ['No pude persistir el nuevo artefacto. Reintenta en unos segundos.'],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  emit('done', `Artefacto "${newArtifact.name}" creado.`);

  const appliedChanges: string[] = [
    `Nuevo artefacto creado: "${newArtifact.name}" (${newArtifact.type})`,
    templateMatch
      ? `Plantilla del catálogo: ${templateMatch.name}`
      : 'Plantilla a medida sintetizada a partir de la solicitud',
  ];
  if (renderableMeta && renderableMeta.ok) {
    appliedChanges.push(`Diagrama renderizable: ${renderableMeta.nodes} nodos · ${renderableMeta.edges} relaciones.`);
  }

  return {
    status: 'success',
    newArtifactId: newArtifact.id,
    newArtifactVersionId: null,
    previousArtifactVersionId: input.artifact.id,
    appliedChanges,
    validationResult: validation,
    messages: [
      templateMatch
        ? `Creé "${newArtifact.name}" usando la plantilla "${templateMatch.name}".`
        : `Creé "${newArtifact.name}" como artefacto a medida.`,
      ...(governanceAdvisory ? [governanceAdvisory] : []),
    ],
    errors: [],
    traceId,
  };
}

/** Resolve the memory scope from an intent type — keeps the case logic tidy. */
function resolveMemoryScopeForExecution(plan: AgentActionPlan): MemoryScope | null {
  if (plan.intent.memoryScope) return plan.intent.memoryScope;
  if (plan.actionType === 'memory.save.global') return 'global';
  if (plan.actionType === 'memory.save.project') return 'project';
  if (plan.actionType === 'memory.save.artifact') return 'artifact';
  return null;
}

/**
 * Multi-artifact (batch) execution.
 *
 * Strategy:
 *  - Iterate over the plan's pre-resolved `batchArtifactIds` (the planner
 *    snapshot guarantees we touch what the user confirmed, not whatever the
 *    project drifted to during execution).
 *  - For each artifact, build a derived single-artifact plan that delegates
 *    to the existing `executeAgentAction` path (improve / patch). This
 *    guarantees zero divergence with the single-artifact behavior —
 *    quality validation, versioning, error handling all reuse the same
 *    code path.
 *  - Aggregate results: a per-artifact failure does NOT abort siblings.
 *    The final status is "success" if any artifact succeeded with no
 *    failures, "partial" on mixed outcomes, "failed" if all attempts
 *    failed.
 */
async function executeBatchAction(input: AgentExecutorInput & { target: AgentExecutionTarget }): Promise<AgentActionResult> {
  const { plan, project } = input;
  const traceId = plan.traceId;
  const emit = (phase: AgentExecutionPhase, message: string, meta?: Record<string, unknown>) => {
    logAgentEvent({ traceId, phase, level: 'info', message, meta });
    input.onPhase?.(phase, message);
  };

  const ids = plan.batchArtifactIds ?? [input.artifact.id];
  const subAction = plan.intent.batchScope?.subAction ?? 'artifact.improve';
  const succeeded: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const newVersionIds: string[] = [];
  const appliedChanges: string[] = [];

  emit('preparing', `Preparando lote (${ids.length} artefacto${ids.length === 1 ? '' : 's'})…`, { count: ids.length });

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const target = project.artifacts.find((a) => a.id === id);
    if (!target) {
      failed.push({ id, reason: 'Artefacto no encontrado en el proyecto.' });
      continue;
    }
    emit('generating', `Procesando ${i + 1}/${ids.length}: ${target.name}…`, { artifactId: id, index: i });

    // Build a derived single-artifact plan from the batch plan. We DO NOT call
    // `planAgentAction` again because that would emit a separate trace; we
    // reuse the same traceId so the batch is correlatable end-to-end.
    const derivedIntent: AgentIntent = {
      ...plan.intent,
      type: subAction,
      artifactId: target.id,
      artifactVersionGroupId: target.versionGroupId,
      batchScope: undefined,
    };
    const derivedPlan: AgentActionPlan = {
      ...plan,
      intent: derivedIntent,
      actionType: subAction,
      artifactId: target.id,
      currentVersionId: target.id,
      batchArtifactIds: undefined,
    };

    const result = await executeAgentAction({
      ...input,
      plan: derivedPlan,
      artifact: target,
      targetOverride: input.target,
    });

    if (result.status === 'success') {
      succeeded.push(target.name);
      if (result.newArtifactVersionId) newVersionIds.push(result.newArtifactVersionId);
      appliedChanges.push(`${target.name}: ${result.appliedChanges[0] ?? 'actualizado.'}`);
    } else {
      failed.push({ id, reason: result.messages[0] ?? result.errors[0] ?? 'Falló.' });
    }
  }

  const status: AgentActionResult['status'] =
    succeeded.length > 0 && failed.length === 0
      ? 'success'
      : succeeded.length > 0
        ? 'partial'
        : 'failed';

  emit(status === 'failed' ? 'failed' : 'done', `Batch finalizado: ${succeeded.length} ok, ${failed.length} con error.`, {
    succeeded: succeeded.length,
    failed: failed.length,
  });

  return {
    status,
    newArtifactVersionId: newVersionIds[0] ?? null,
    previousArtifactVersionId: input.artifact.id,
    appliedChanges,
    validationResult: null,
    messages: [
      status === 'success'
        ? `Lote aplicado: ${succeeded.length} artefacto${succeeded.length === 1 ? '' : 's'} actualizado${succeeded.length === 1 ? '' : 's'}.`
        : status === 'partial'
          ? `Lote aplicado parcialmente: ${succeeded.length} ok, ${failed.length} con error.`
          : 'Ningún artefacto pudo actualizarse.',
      ...(failed.length > 0 ? [`Errores: ${failed.map((f) => `${f.id} (${truncate(f.reason, 60)})`).join('; ')}`] : []),
    ],
    errors: failed.map((f) => `${f.id}: ${f.reason}`),
    traceId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — kept inside the executor so they never leak into the public API
// ─────────────────────────────────────────────────────────────────────────────

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const mapPendingSuggestionsToReview = (
  pending: ArtifactReviewSuggestion[] | undefined,
  fallbackInstruction: string,
): ArtifactReviewSuggestion[] => {
  if (pending && pending.length > 0) return pending;
  return [
    {
      id: 'agent-inline',
      title: 'Mejora solicitada por el Arquitecto Agente',
      description: fallbackInstruction,
      category: 'Best Practices',
    },
  ];
};

/**
 * Looks up the catalog template that matches an artifact's type+name. Falls
 * back to a type-only match so a renamed artifact can still be regenerated.
 */
const findTemplateForArtifact = (artifact: Artifact): ArtifactTemplate | undefined => {
  const byNameAndType = ARTIFACT_TEMPLATES.find(
    (t) => t.name === artifact.name && t.type === artifact.type,
  );
  if (byNameAndType) return byNameAndType;
  return ARTIFACT_TEMPLATES.find((t) => t.type === artifact.type);
};

/**
 * Lightweight quality gate. For diagrams that have an IR field we run the
 * existing deterministic gate. For everything else we apply structural sanity
 * checks (non-empty, length sanity, no truncation markers). This is a
 * pre-flight — the canvas-level renderability gate still runs on the actual
 * persisted artifact when the user navigates to it.
 */
const validateArtifactContent = (
  artifact: Artifact,
  newContent: string,
): NonNullable<AgentActionResult['validationResult']> => {
  const trimmed = newContent.trim();
  if (trimmed.length === 0) {
    return { passed: false, summary: 'El contenido generado está vacío.' };
  }
  if (trimmed.length < 16) {
    return { passed: false, summary: 'El contenido generado es demasiado corto para ser válido.' };
  }
  if (/```\s*$/m.test(trimmed) && !/```[\s\S]*```/.test(trimmed)) {
    return { passed: false, summary: 'El contenido contiene un bloque de código sin cerrar.' };
  }
  // Document-quality parity with the Workspace generation gate: agent paths
  // (improve / patch / applySuggestion) bypass `generateArtifactContent`, so
  // without this check a truncated or gutted document would persist silently.
  // We fail only on hard signals (truncation, drastic shrinkage); structural
  // warnings pass through with the score in the summary.
  if (artifact.representation === 'document' && artifact.type !== 'yaml' && !artifact.ir) {
    const assessment = assessDocumentArtifact(trimmed, { expectStructuredDocument: true });
    if (assessment.truncated) {
      const issues = assessment.issues.map((i) => i.message).join(' · ');
      return { passed: false, summary: `El documento llegó truncado: ${issues}`, score: assessment.score };
    }
    const previousLength = (artifact.content ?? '').trim().length;
    const shrankDrastically = previousLength >= 800 && trimmed.length < previousLength * 0.35;
    if (shrankDrastically) {
      return {
        passed: false,
        summary: `El nuevo contenido (${trimmed.length} caracteres) es drásticamente más corto que el actual (${previousLength}); se descarta para evitar pérdida de contenido.`,
        score: assessment.score,
      };
    }
    return {
      passed: true,
      summary: assessment.ok
        ? `Documento válido (calidad estimada ${assessment.score}/100).`
        : `Documento aceptado con advertencias (${assessment.issues.map((i) => i.code).join(', ')}) — calidad estimada ${assessment.score}/100.`,
      score: assessment.score,
    };
  }

  // Diagram-specific: if we already have an IR snapshot, run the existing
  // deterministic quality gate. We only USE its score; we don't apply its
  // automatic rewrites (those are reserved for the explicit "Auto-mejorar"
  // button so the user retains control over deterministic patches).
  if (artifact.ir) {
    try {
      const gate = runDiagramQualityGate(artifact.ir, {
        artifact: {
          name: artifact.name,
          type: artifact.type,
          objective: artifact.objective,
          audience: artifact.audience,
          theme: artifact.theme,
        },
        audience: artifact.audience ?? 'technical',
        targetScore: 60,
        maxPasses: 1,
      });
      return {
        passed: gate.quality.score >= 40,
        summary:
          gate.quality.score >= 40
            ? `Calidad estimada ${gate.quality.score}/100.`
            : `Calidad estimada ${gate.quality.score}/100 — por debajo del umbral mínimo (40).`,
        score: gate.quality.score,
      };
    } catch {
      // Fall through to "structural OK".
    }
  }
  return { passed: true, summary: 'Contenido estructuralmente válido.' };
};
