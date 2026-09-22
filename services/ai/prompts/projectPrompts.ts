/**
 * Composición de prompts sobre un proyecto.
 *
 * Vivía en `utils.ts`, en la raíz del repositorio, y eso no era una cuestión de
 * orden: estas funciones leen el contexto del proyecto, su memoria de agente y
 * sus artefactos para redactar lo que se le manda a un modelo. Es capa de IA.
 * Por vivir en la raíz, `utils.ts` importaba `services/ai` y `services/memory`
 * —dos imports ascendentes desde la capa de fundación— y cerraba el ciclo
 * `services/ai <-> utils.ts`. Ninguno de los dos lo veía el gate hasta F3-02,
 * porque no abría los ficheros de la raíz.
 *
 * Lo que se quedó en `utils.ts` es lo que su nombre promete: extracción de
 * JSON, agrupación de artefactos, una caché en memoria. Nada de eso llama a un
 * modelo ni sabe que existe.
 */

import type { Artifact, Project, Settings } from '../../types';
import { prioritizeProjectContext } from './diagramPrompts';
// Por el barril: `services/memory` ya publica esta función y es un módulo de
// declaraciones puras —ningún chunk pesado detrás—, así que no hay razón de
// bundle que justifique entrar por el fichero.
import { formatMemoryTextsForPrompt } from '../../memory';
import { extractMermaidCode } from '../../../utils/diagram/extractMermaid';
// `getLatestArtifacts` se queda en `utils.ts`: agrupar versiones no es componer
// un prompt, y moverlo aquí habría arrastrado a la capa de IA una función que
// usan cinco pantallas.
import { getLatestArtifacts } from '../../../utils';

export function buildGlobalPrompt(settings: Settings): string {
  const tone = settings.aiConfig?.tone || 'Profesional y Técnico';
  return `You are an expert solution architect, acting as the Arquitecto Agente — the AI architecture agent for this platform.

CRITICAL INDUSTRY CONTEXT:
This platform is a service provided to an Insurance Company that offers Life and Health products.
Whenever you are generating a project, its artifacts, courses, knowledge cards, or answering ANY question, you MUST take this into account.
You must adhere to the highest standards of the Life and Health Insurance industry, as well as the best standards in Technology.
This is highly relevant when crafting or elaborating information for artifacts, courses, knowledge cards, and everything related to them.

Global Context/Standards (ordenado por prioridad del usuario y recencia; [prioridad · fecha · autor] cuando se conoce):
${formatMemoryTextsForPrompt(settings.globalContext, settings.globalContextEntries).map(c => `- ${c}`).join('\n')}

Style Instructions:
- Tone: ${tone}
- Language: ${settings.language === 'es' ? 'Spanish (Español)' : 'English'}`;
}

export function buildLMSTutorPersona(settings: Settings): string {
  const base = buildGlobalPrompt(settings);
  return `${base}

## Tu Rol como Arquitecto-Profesor

Eres un Arquitecto de Soluciones Senior que actúa como Profesor de Clase Magistral en un programa ejecutivo de nivel Harvard/MIT, formando a la próxima generación de arquitectos de soluciones para la industria de Seguros de Salud y Vida.

No eres un académico teórico ni un consultor con experiencias aisladas. Integras:
- **Pensamiento estratégico**: conectas decisiones tecnológicas con la estrategia de negocio asegurador
- **Dominio tecnológico profundo**: arquitectura de microservicios, APIs, nube, integración de sistemas core de pólizas y reclamaciones
- **Comprensión del negocio asegurador**: ciclo de vida de pólizas, suscripción, reclamaciones, redes médicas, regulación y cumplimiento normativo

### Lo que enseñas
Más que herramientas o patrones específicos, enseñas **criterios de decisión**. Cada concepto responde a la pregunta fundamental:
> "¿Qué problema de negocio de una aseguradora resuelve esta decisión arquitectónica?"

Has participado en transformaciones tecnológicas reales: modernización de sistemas core, integraciones entre plataformas de pólizas y hospitales, adopción de arquitecturas cloud, evolución de ecosistemas digitales dentro de aseguradoras. Esta experiencia se refleja en cada contenido que produces.

### Tu audiencia
Profesionales en formación avanzada que ya trabajan (o aspiran a trabajar) en compañías de seguros de salud y vida. Muchos tienen experiencia técnica en desarrollo de software, integración de sistemas o análisis de negocio, y están evolucionando desde una perspectiva técnica especializada hacia una **visión integral de arquitectura**.

### Temas dominantes
Arquitectura empresarial en seguros, modernización de sistemas core (pólizas, reclamaciones, facturación), arquitectura de microservicios, integración mediante APIs y eventos, plataformas de datos para analítica actuarial, arquitecturas cloud e híbridas, resiliencia y continuidad operativa, seguridad y cumplimiento regulatorio, experiencia digital del asegurado, ecosistemas de integración con hospitales y proveedores médicos.

### Estilo y lenguaje
- **Precisión técnica con claridad conceptual**: introduces términos especializados contextualizándolos en problemas reales del sector asegurador
- **Tono profesional, analítico y exigente, pero cercano**: el debate intelectual es natural y productivo
- **Rigor intelectual**: las soluciones vagas o afirmaciones sin sustento técnico o de negocio no son aceptadas
- **Ejemplos concretos del sector**: modernización de sistemas legacy de reclamaciones, integración con redes hospitalarias, procesamiento masivo de reclamaciones médicas, portales de autoservicio para asegurados

### Tres dimensiones que todo arquitecto debe equilibrar
1. **Impacto en el negocio**: ¿qué valor crea para la aseguradora y el asegurado?
2. **Viabilidad tecnológica**: ¿es técnicamente implementable con las restricciones existentes?
3. **Sostenibilidad operativa**: ¿puede mantenerse y evolucionar en el tiempo?

### Valor tangible que la arquitectura crea en aseguradoras
- Acelerar la introducción de nuevos productos al mercado
- Mejorar la experiencia del asegurado en todos los puntos de contacto
- Reducir tiempos de procesamiento de reclamaciones médicas
- Integrar eficientemente redes médicas y proveedores de salud
- Fortalecer el cumplimiento regulatorio
- Optimizar costos operativos de la plataforma tecnológica
- Habilitar la innovación digital continua`;
}

export type BasePromptMode = 'document' | 'diagram';

export interface BasePromptOptions {
  /**
   * `document` (default) preserves the historical behavior — full project
   * context, full description. `diagram` applies a tight cap to avoid
   * saturating the model when the project was created by the guided
   * assistant (which accumulates 30-80+ contextual bullets).
   */
  mode?: BasePromptMode;
  /** Override the default per-mode cap on `projectContext` items. */
  maxContextItems?: number;
  /** Override the default per-mode cap on description characters. */
  maxDescriptionChars?: number;
}

const DIAGRAM_MAX_CONTEXT_ITEMS = 12;
const DIAGRAM_MAX_DESCRIPTION_CHARS = 600;

export function buildBasePrompt(project: Project, settings: Settings, opts: BasePromptOptions = {}): string {
  const mode: BasePromptMode = opts.mode ?? 'document';
  const description = (project.description ?? '').toString();

  if (mode === 'diagram') {
    const maxItems = opts.maxContextItems ?? DIAGRAM_MAX_CONTEXT_ITEMS;
    const maxChars = opts.maxDescriptionChars ?? DIAGRAM_MAX_DESCRIPTION_CHARS;
    const trimmedDescription = description.length > maxChars
      ? `${description.slice(0, maxChars).trimEnd()}…`
      : description;
    // Order by user priority + recency BEFORE the diagram-specific
    // prioritizer caps the list, so high-priority/recent notes survive the
    // tight diagram budget. Annotations stay off here: the diagram
    // prioritizer keys on the note text itself.
    const orderedTexts = formatMemoryTextsForPrompt(
      project.projectContext,
      project.projectContextEntries,
      { annotate: false },
    );
    const items = prioritizeProjectContext(orderedTexts, { limit: maxItems });
    return `${buildGlobalPrompt(settings)}

Project Name: ${project.name}
Project Description: ${trimmedDescription}
Project-Specific Context (Updates & Requirements):
${items.map(c => `- ${c}`).join('\n')}
`;
  }

  const projectContextLines = formatMemoryTextsForPrompt(project.projectContext, project.projectContextEntries);
  const agentMemoryLines = formatMemoryTextsForPrompt(project.agentMemory, project.agentMemoryEntries);
  const initialCaptureLines = formatMemoryTextsForPrompt(project.initialCapture, project.initialCaptureEntries);
  const optionalSections: string[] = [];
  if (initialCaptureLines.length > 0) {
    optionalSections.push(`Initial Capture (objetivos, alcance y stakeholders del proyecto):\n${initialCaptureLines.map(c => `- ${c}`).join('\n')}`);
  }
  if (agentMemoryLines.length > 0) {
    optionalSections.push(`Agent Memory for this Project (decisiones, lecciones y preferencias registradas):\n${agentMemoryLines.map(c => `- ${c}`).join('\n')}`);
  }

  return `${buildGlobalPrompt(settings)}

Project Name: ${project.name}
Project Description: ${description}
Project-Specific Context (Updates & Requirements):
${projectContextLines.map(c => `- ${c}`).join('\n')}
${optionalSections.length > 0 ? `\n${optionalSections.join('\n\n')}\n` : ''}`;
}

export interface ArtifactsContextOptions {
  /**
   * In `diagram` mode the helper returns only the most recent N artifacts
   * (without the full objective body) to keep the per-call payload small.
   */
  mode?: BasePromptMode;
  /** Cap for the diagram mode. Defaults to 5. */
  maxArtifacts?: number;
  /**
   * When true (document/presentation generation), the context additionally
   * embeds a capped excerpt of the most relevant sibling artifacts' CONTENT
   * so the model can stay consistent with what was already produced
   * (a use case that references the real BRD, a presentation that cites the
   * actual C4 narrative…). Names/objectives alone proved insufficient for
   * cross-artifact traceability.
   */
  includeExcerpts?: boolean;
  /**
   * Version-group of the artifact being (re)generated; excluded from the
   * excerpt list so the model is not fed its own previous output twice.
   */
  excludeVersionGroupId?: string;
  /** Cap of artifacts whose content is excerpted. Defaults to 4. */
  maxExcerpts?: number;
  /** Cap of characters per excerpt. Defaults to 1100. */
  maxExcerptChars?: number;
}

const DIAGRAM_MAX_ARTIFACTS = 5;
const DEFAULT_MAX_EXCERPTS = 4;
const DEFAULT_EXCERPT_CHARS = 1100;

/**
 * Prepare an artifact's content for prompt embedding: strip fenced diagram /
 * JSON blocks (the receiving model needs the prose, not the syntax) and cap
 * the length at a word boundary.
 */
export function buildArtifactExcerpt(content: string, maxChars = DEFAULT_EXCERPT_CHARS): string {
  const prose = (content ?? '')
    .replace(/```(?:mermaid|json|yaml|xml)[\s\S]*?```/gi, '[bloque de diagrama/código omitido]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (prose.length <= maxChars) return prose;
  const cut = prose.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return `${cut.slice(0, lastBreak > maxChars * 0.6 ? lastBreak : maxChars).trimEnd()}\n[…extracto truncado…]`;
}

/**
 * Rank sibling artifacts for excerpt relevance: text-bearing artifacts
 * (documents, hybrids) first — they carry the requirements and decisions the
 * new artifact must stay consistent with — then most recent first.
 */
export function selectExcerptCandidates(
  artifacts: Artifact[],
  opts: { excludeVersionGroupId?: string; limit?: number } = {},
): Artifact[] {
  const limit = opts.limit ?? DEFAULT_MAX_EXCERPTS;
  return getLatestArtifacts(artifacts)
    .filter((a) => a.versionGroupId !== opts.excludeVersionGroupId)
    .filter((a) => (a.content ?? '').trim().length >= 120)
    .sort((a, b) => {
      const aDoc = a.representation === 'document' || a.representation === 'hybrid' ? 1 : 0;
      const bDoc = b.representation === 'document' || b.representation === 'hybrid' ? 1 : 0;
      if (aDoc !== bDoc) return bDoc - aDoc;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    })
    .slice(0, limit);
}

export function buildArtifactsContext(project: Project, opts: ArtifactsContextOptions = {}): string {
  if (project.artifacts.length === 0) {
    return "This project currently has no artifacts.\n";
  }

  const latestArtifacts = getLatestArtifacts(project.artifacts);

  if (opts.mode === 'diagram') {
    const limit = opts.maxArtifacts ?? DIAGRAM_MAX_ARTIFACTS;
    const recent = latestArtifacts
      .slice()
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, limit);
    return `
Other Existing Project Artifacts (recent, names only):
${recent.map(a => `- "${a.name}" (Type: ${a.type})`).join('\n')}
`;
  }

  const header = `
Other Existing Project Artifacts (for reference):
${latestArtifacts.map(a => `
- Artifact Name: "${a.name}" (Type: ${a.type})
  - Objective: ${a.objective}
`).join('\n')}
`;

  if (!opts.includeExcerpts) return header;

  const candidates = selectExcerptCandidates(latestArtifacts, {
    excludeVersionGroupId: opts.excludeVersionGroupId,
    limit: opts.maxExcerpts ?? DEFAULT_MAX_EXCERPTS,
  });
  if (candidates.length === 0) return header;

  const excerptBlock = candidates
    .map((a) => `### "${a.name}" (${a.type})\n${buildArtifactExcerpt(a.content, opts.maxExcerptChars ?? DEFAULT_EXCERPT_CHARS)}`)
    .join('\n\n');

  return `${header}
CONTENT EXCERPTS FROM RELATED ARTIFACTS (use them as the source of truth for consistency — reuse the same entity names, requirement IDs, system names and decisions; do NOT contradict them):

${excerptBlock}
`;
}

const SIBLING_DIAGRAM_MAX_SOURCES = 2;
const SIBLING_DIAGRAM_MAX_CHARS = 1600;

/**
 * Build a prompt block exposing the Mermaid SOURCE of the most recent diagram
 * artifacts in the project, so document generation can embed/adapt the real
 * architecture diagrams instead of inventing disconnected toy diagrams.
 *
 * Sources longer than {@link SIBLING_DIAGRAM_MAX_CHARS} are skipped (a
 * truncated Mermaid block would be syntactically broken and worse than
 * nothing). Returns '' when no reusable source exists.
 */
export function buildSiblingDiagramsPromptBlock(
  project: Project,
  opts: { excludeVersionGroupId?: string; maxSources?: number } = {},
): string {
  const limit = opts.maxSources ?? SIBLING_DIAGRAM_MAX_SOURCES;
  const candidates = getLatestArtifacts(project.artifacts)
    .filter((a) => a.versionGroupId !== opts.excludeVersionGroupId)
    .filter((a) => a.representation === 'diagram' || a.representation === 'hybrid')
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const sources: string[] = [];
  for (const artifact of candidates) {
    if (sources.length >= limit) break;
    const code = extractMermaidCode(artifact.content, artifact.representation);
    if (!code || code.trim().length === 0 || code.length > SIBLING_DIAGRAM_MAX_CHARS) continue;
    sources.push(`### Diagrama existente: "${artifact.name}" (${artifact.type})\n\`\`\`mermaid\n${code.trim()}\n\`\`\``);
  }
  if (sources.length === 0) return '';
  return `
PREVIOUSLY GENERATED PROJECT DIAGRAMS (reusable Mermaid sources):
${sources.join('\n\n')}

When the document discusses the architecture covered by one of these diagrams, EMBED that diagram (verbatim or a simplified subset preserving node names) in a \`\`\`mermaid fence and reference it by its artifact name (e.g. "Figura: Diagrama de Contenedores"). Prefer reusing these real diagrams over inventing new ones, so the document stays visually consistent with the rest of the project.
`;
}

// --- Artifact Utilities (from AppContext) ---

/**
 * Deduplicates artifacts by versionGroupId, keeping only the latest version.
 */
