/**
 * Translates a classified `AgentIntent` into an `AgentActionPlan` (the card
 * the user sees before any execution happens). Pure & sync.
 *
 * The planner intentionally does NOT call the AI — that work is deferred to
 * the executor and only happens once the user confirms. This keeps the plan
 * card snappy and lets us preview "what will happen" without burning tokens.
 */

import type { Artifact, Project } from '../../types';
import type { AgentActionPlan, AgentIntent, AgentIntentType, BatchMatcher } from './agentTypes';
import { newTraceId, logAgentEvent } from './agentLogger';

const TITLES: Record<AgentIntentType, string> = {
  'artifact.create': 'Crear nuevo artefacto',
  'artifact.regenerate': 'Regenerar artefacto',
  'artifact.improve': 'Mejorar con IA',
  'artifact.patch': 'Aplicar cambio puntual',
  'artifact.createVersion': 'Crear nueva versión',
  'artifact.applySuggestion': 'Aplicar sugerencias cargadas',
  'artifact.explainOnly': 'Explicar artefacto',
  'artifacts.batch': 'Aplicar cambio en múltiples artefactos',
  'memory.save.global': 'Guardar en memoria global',
  'memory.save.project': 'Guardar en memoria del proyecto',
  'memory.save.artifact': 'Guardar en memoria del artefacto',
  unknown: 'Acción no disponible',
};

const SUMMARIES: Record<AgentIntentType, (artifact: Artifact, intent?: AgentIntent) => string> = {
  'artifact.create': (_a, intent) => {
    const template = intent?.createHint?.templateName;
    if (template) return `Voy a generar un nuevo artefacto basado en la plantilla "${template}" usando el contexto del proyecto. Quedará registrado como v1 del artefacto.`;
    return 'Voy a generar un nuevo artefacto a la medida a partir de tu solicitud, usando el contexto del proyecto. Quedará registrado como v1 del artefacto.';
  },
  'artifact.regenerate': (a) =>
    `Voy a regenerar "${a.name}" desde cero incorporando lo que conversamos. La versión actual (v${a.version}) se conserva.`,
  'artifact.improve': (a) =>
    `Voy a aplicar mejoras dirigidas sobre "${a.name}" reutilizando el pipeline de "Mejorar con IA". Generaré una nueva versión.`,
  'artifact.patch': (a) =>
    `Voy a aplicar un cambio puntual sobre "${a.name}" (modificación dirigida del contenido). Por defecto creo nueva versión.`,
  'artifact.createVersion': (a) =>
    `Voy a crear una nueva versión de "${a.name}" recogiendo el contexto reciente del chat.`,
  'artifact.applySuggestion': (a) =>
    `Voy a aplicar las sugerencias cargadas sobre "${a.name}" como una nueva versión, igual que el botón "Mejorar con IA".`,
  'artifact.explainOnly': (a) =>
    `Voy a explicar "${a.name}" sin modificarlo.`,
  'artifacts.batch': (a) =>
    `Voy a propagar el cambio sobre varios artefactos del proyecto (anclado a "${a.name}"). Cada artefacto generará su propia nueva versión.`,
  'memory.save.global': () =>
    'Voy a guardar los conceptos clave de la conversación en la memoria global. Quedarán disponibles para todos los proyectos del workspace.',
  'memory.save.project': () =>
    'Voy a guardar los conceptos clave de la conversación en el contexto del proyecto. Servirán de directriz para la IA en este proyecto.',
  'memory.save.artifact': (a) =>
    `Voy a guardar los conceptos clave de la conversación como memoria del artefacto "${a.name}". No modifico su contenido — sólo añado contexto.`,
  unknown: () => 'No se detectó una acción ejecutable.',
};

const RATIONALES: Record<AgentIntentType, string> = {
  'artifact.create':
    'Detecté una solicitud de creación. Si la solicitud encaja con una plantilla del catálogo, se usa esa; si no, se genera un artefacto a medida con tu instrucción como objetivo.',
  'artifact.regenerate':
    'Detecté una instrucción explícita de regeneración. Se invoca el mismo pipeline de generación que usa el botón principal, con tu nueva instrucción como contexto adicional.',
  'artifact.improve':
    'Detecté una solicitud de mejora general. Se reutiliza el flujo de aplicación de mejoras existente para no duplicar lógica.',
  'artifact.patch':
    'Detecté una modificación dirigida (renombrado, corrección o ajuste). Se reutiliza la herramienta `modifyArtifact` que ya invocas desde el chat tradicional.',
  'artifact.createVersion':
    'Detecté una solicitud explícita de versionamiento. Se versiona sin alterar la actual.',
  'artifact.applySuggestion':
    'Detecté la intención de aplicar las sugerencias ya cargadas. Se reutiliza el flujo de "Mejorar con IA" con esas sugerencias.',
  'artifact.explainOnly':
    'Detecté que solo necesitas explicación. No se ejecutará ninguna modificación.',
  'artifacts.batch':
    'Detecté una instrucción que aplica al conjunto. Cada artefacto se procesa por separado y genera su propia nueva versión, así nada queda en estado inconsistente.',
  'memory.save.global':
    'Detecté que quieres preservar conocimiento transversal. La extracción de bullets se hace con IA y los resultados son editables antes de persistir.',
  'memory.save.project':
    'Detecté que quieres preservar contexto del proyecto. Los bullets se añaden al `projectContext` (no se sobrescriben) y la IA los usará como directriz.',
  'memory.save.artifact':
    'Detecté que quieres preservar notas del artefacto. Los bullets se añaden a `artifactMemory` sin tocar el contenido renderizable.',
  unknown: 'Sin acción asociada.',
};

const AFFECTED_AREAS: Record<AgentIntentType, string[]> = {
  'artifact.create': ['Nuevo artefacto', 'Lista de artefactos del proyecto', 'Versión inicial'],
  'artifact.regenerate': ['Contenido completo', 'Layout (si es diagrama)', 'Versión'],
  'artifact.improve': ['Contenido', 'Calidad estructural', 'Versión'],
  'artifact.patch': ['Contenido (cambio dirigido)', 'Versión'],
  'artifact.createVersion': ['Versión'],
  'artifact.applySuggestion': ['Contenido', 'Calidad', 'Versión'],
  'artifact.explainOnly': [],
  'artifacts.batch': ['Contenido de cada artefacto afectado', 'Versiones múltiples'],
  'memory.save.global': ['Contexto global del workspace'],
  'memory.save.project': ['Contexto del proyecto activo'],
  'memory.save.artifact': ['Memoria del artefacto activo (no su contenido)'],
  unknown: [],
};

const RISKS: Record<AgentIntentType, string[]> = {
  'artifact.create': [
    'Si la solicitud no encaja con el catálogo, se genera un artefacto a medida — revísalo antes de promoverlo.',
    'Reutilizamos el contexto del proyecto, así que el resultado depende de qué tan completo esté.',
  ],
  'artifact.regenerate': [
    'Puede modificar nombres, descripciones o estructura completa.',
    'El layout del diagrama se recalcula.',
  ],
  'artifact.improve': [
    'Las mejoras pueden cambiar nodos, etiquetas o tablas existentes.',
  ],
  'artifact.patch': [
    'El cambio puntual depende de cómo la IA interprete tu instrucción — revisa el resultado antes de promover la versión.',
  ],
  'artifact.createVersion': ['Sin riesgos relevantes — la versión anterior se conserva.'],
  'artifact.applySuggestion': [
    'Aplica todas las sugerencias cargadas — desmárcalas en el panel de sugerencias si quieres aplicar sólo algunas.',
  ],
  'artifact.explainOnly': [],
  'artifacts.batch': [
    'Cada artefacto procesado genera una versión nueva — el espacio de versiones crece rápidamente.',
    'Una falla en un artefacto no detiene a los demás; la versión previa se conserva.',
  ],
  'memory.save.global': [
    'Lo que guardes aquí influye en todos los proyectos. Edítalo o elimínalo desde el Centro de Memoria.',
  ],
  'memory.save.project': [
    'Lo que guardes aquí queda disponible como directriz para la IA en este proyecto.',
  ],
  'memory.save.artifact': [
    'Lo que guardes aquí queda anclado al artefacto y se conserva al versionarlo.',
  ],
  unknown: [],
};

export interface PlanAgentActionInput {
  intent: AgentIntent;
  artifact: Artifact;
  /** Project context required to resolve batch scopes into concrete artifact ids. */
  project?: Project;
}

export function planAgentAction({ intent, artifact, project }: PlanAgentActionInput): AgentActionPlan {
  const traceId = newTraceId();
  const actionId = `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Resolve batch scope into a concrete artifact id list at plan-time so the
  // confirmation card can show exactly how many artifacts will be touched.
  const batchArtifactIds =
    intent.type === 'artifacts.batch' && intent.batchScope && project
      ? resolveBatchScope(project, intent.batchScope.matcher, artifact.id)
      : undefined;

  const plan: AgentActionPlan = {
    actionId,
    intent,
    artifactId: artifact.id,
    currentVersionId: artifact.id,
    actionType: intent.type,
    title: TITLES[intent.type],
    summary: SUMMARIES[intent.type](artifact, intent),
    rationale: RATIONALES[intent.type],
    affectedAreas: AFFECTED_AREAS[intent.type],
    risks: RISKS[intent.type],
    target: intent.suggestedTarget,
    requiresConfirmation: intent.requiresConfirmation,
    status: 'pending',
    createdAt: new Date().toISOString(),
    traceId,
    batchArtifactIds,
  };

  logAgentEvent({
    traceId,
    phase: 'plan',
    level: 'info',
    message: `Plan creado: ${plan.actionType}`,
    meta: {
      actionId,
      artifactId: artifact.id,
      artifactName: artifact.name,
      target: plan.target,
      confidence: intent.confidence,
      requiresConfirmation: plan.requiresConfirmation,
      batchSize: batchArtifactIds?.length,
    },
  });

  return plan;
}

/**
 * Resolve a `BatchMatcher` against a project's current artifacts. Returns the
 * deduplicated list of latest-version artifact ids that match the criteria.
 * The anchor artifact is always included so the plan card shows at least one
 * target even on a degenerate matcher.
 */
function resolveBatchScope(project: Project, matcher: BatchMatcher, anchorId: string): string[] {
  // Latest version per versionGroup — we never batch over historical versions.
  const latestByGroup = new Map<string, Artifact>();
  for (const a of project.artifacts) {
    const current = latestByGroup.get(a.versionGroupId);
    if (!current || a.version > current.version) latestByGroup.set(a.versionGroupId, a);
  }
  const candidates = Array.from(latestByGroup.values());

  const matches = candidates.filter((a) => {
    switch (matcher.kind) {
      case 'all':
        return true;
      case 'view':
        return a.architecturalView.toLowerCase().includes(matcher.view.toLowerCase());
      case 'type':
        return a.type.startsWith(matcher.type) || a.type === matcher.type;
      case 'ids':
        return matcher.ids.includes(a.id);
      default:
        return false;
    }
  });

  const ids = matches.map((a) => a.id);
  if (!ids.includes(anchorId)) ids.push(anchorId);
  return Array.from(new Set(ids));
}
