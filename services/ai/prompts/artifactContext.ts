/**
 * The context an artifact operation hands a model, assembled once (plan de
 * calidad de artefactos, 7.2).
 *
 * Seven composers answered this question each their own way — the base
 * prompt, the agent's composer, the context-graph pack, the diagram brief,
 * the controlled selection and two inline ones — and the answer depended on
 * which button was pressed: generation read the project's notes in stored
 * order and never the agent's memory; the chat ranked them by relevance,
 * priority and recency and saw the artifact's own memory; refinement read the
 * first eight project notes and nothing else. The bench measured it: 32 % of
 * the context reached the model, averaged over every path.
 *
 * This is the one assembly. It knows **scopes** and how they rank against
 * each other, and every operation declares a **profile** that fixes which
 * scopes it reads and how much of each:
 *
 * - **Hierarchy.** artefacto > proyecto (context, initial capture, project
 *   memory) > global > agente > hermanos. It orders the scopes, decides which
 *   copy of a note repeated in two scopes survives, and decides what the
 *   budget cuts first.
 * - **Relevance.** Inside a scope, notes are ranked against the operation's
 *   query with the memory module's ranking (relevance + priority + recency);
 *   sibling artifacts by how much of the query they mention.
 * - **Budget.** Per scope (how many) and per profile (how many characters in
 *   all). Nothing is cut silently: every note left out is counted in
 *   `omitted`, with the reason.
 *
 * Pure and synchronous. It reads only what an operation already holds —
 * the project, the settings, the artifact — so the AI layer imports no
 * other context to use it. What only another context knows (the initiative,
 * the deliverable, the conversation) arrives as data through a port.
 */
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { rankRelevantMemoryEntries, scoreBulletForQuery } from '../../memory';
import { getLatestArtifacts } from '../../../utils';

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/**
 * A note that names a technology, a regulation or an architectural concern.
 * The diagram profile ranks these first: a diagram is grounded by them, and
 * the guided creation accumulates dozens of conversational echoes beside them.
 * Curated for the Spanish guided-creation flow; extend it carefully — every
 * new term inflates the pattern and lowers its selectivity.
 */
export const ARCHITECTURE_SIGNAL_PATTERN = /\b(tecnolog|stack|kafka|postgres|mysql|mongo|redis|aws|azure|gcp|kubernetes|docker|saas|hipaa|pci|sox|gdpr|on-?prem|cloud|microservic|monolit|integra|api|escala|tenant|legacy|cumplimiento|regulator|seguridad|sla|latencia|throughput|disponibilidad|backup|recovery|frontend|backend|gateway|queue|event|streaming|data\s*warehouse|etl|lakehouse|graphql|rest|grpc)\b/i;

/**
 * The words a conversational echo is made of. A note made only of them («ok»,
 * «sí, gracias», «perfecto, listo») is the guided creation acknowledging a
 * turn, not context. Length is not the test: «Team of 5» is short and says
 * something.
 */
const ECHO_WORDS = new Set([
  'ok', 'okay', 'si', 'sí', 'no', 'vale', 'gracias', 'muchas', 'perfecto', 'listo', 'entendido', 'claro',
  'genial', 'bien', 'de', 'acuerdo', 'excelente', 'correcto', 'thanks', 'thank', 'you', 'yes', 'sure', 'great',
]);

const isConversationalEcho = (text: string): boolean => {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.every((word) => ECHO_WORDS.has(word));
};

/** In hierarchy order: a scope earlier in this list wins a conflict. */
export const ARTIFACT_CONTEXT_SCOPES = [
  'artefacto',
  'proyecto',
  'capturaInicial',
  'memoriaProyecto',
  'global',
  'agente',
  'hermanos',
] as const;
export type ArtifactContextScope = typeof ARTIFACT_CONTEXT_SCOPES[number];

export type ArtifactContextProfileName = 'generate' | 'diagram' | 'refine' | 'review' | 'edit' | 'present' | 'convert' | 'consult';

export interface ArtifactContextProfile {
  name: ArtifactContextProfileName;
  /** How many items each scope may contribute; a scope absent here is not read. */
  limits: Partial<Record<ArtifactContextScope, number>>;
  /** Per-note character cap. */
  noteChars: number;
  /** Per-sibling excerpt character cap. */
  excerptChars: number;
  /** Characters for the whole bundle; the lowest scopes are cut first. */
  totalChars: number;
  /** A profile's own signal, added to each note's ranking. */
  noteBoost?: (text: string) => number;
}

const profile = (
  name: ArtifactContextProfileName,
  limits: ArtifactContextProfile['limits'],
  sizes: Omit<ArtifactContextProfile, 'name' | 'limits'>,
): ArtifactContextProfile => ({ name, limits, ...sizes });

const architectureSignalBoost = (text: string): number => (ARCHITECTURE_SIGNAL_PATTERN.test(text) ? 1 : 0);

/**
 * The profiles. Generation reads the most, because it writes an artifact from
 * nothing; a consultation reads what a chat turn can afford, and its siblings
 * arrive as an inventory the agent composes itself.
 */
export const ARTIFACT_CONTEXT_PROFILES: Readonly<Record<ArtifactContextProfileName, ArtifactContextProfile>> = Object.freeze({
  generate: profile('generate', { artefacto: 8, proyecto: 50, capturaInicial: 12, memoriaProyecto: 10, global: 12, agente: 6, hermanos: 4 }, { noteChars: 400, excerptChars: 1100, totalChars: 24_000 }),
  diagram: profile('diagram', { artefacto: 6, proyecto: 12, capturaInicial: 6, memoriaProyecto: 6, global: 8, agente: 4 }, { noteChars: 300, excerptChars: 0, totalChars: 9_000, noteBoost: architectureSignalBoost }),
  refine: profile('refine', { artefacto: 8, proyecto: 20, capturaInicial: 8, memoriaProyecto: 8, global: 10, agente: 4, hermanos: 3 }, { noteChars: 300, excerptChars: 900, totalChars: 16_000 }),
  review: profile('review', { artefacto: 8, proyecto: 20, capturaInicial: 8, memoriaProyecto: 8, global: 10, agente: 4, hermanos: 3 }, { noteChars: 300, excerptChars: 900, totalChars: 16_000 }),
  edit: profile('edit', { artefacto: 8, proyecto: 12, capturaInicial: 6, memoriaProyecto: 6, global: 10, agente: 8 }, { noteChars: 220, excerptChars: 0, totalChars: 12_000 }),
  present: profile('present', { artefacto: 6, proyecto: 20, capturaInicial: 8, memoriaProyecto: 8, global: 10, agente: 4, hermanos: 6 }, { noteChars: 300, excerptChars: 1100, totalChars: 22_000 }),
  convert: profile('convert', { artefacto: 8, proyecto: 16, capturaInicial: 6, memoriaProyecto: 6, global: 8, agente: 4, hermanos: 2 }, { noteChars: 300, excerptChars: 900, totalChars: 14_000 }),
  consult: profile('consult', { artefacto: 8, proyecto: 12, capturaInicial: 6, memoriaProyecto: 6, global: 10, agente: 8 }, { noteChars: 220, excerptChars: 0, totalChars: 12_000 }),
});

export interface ArtifactContextSources {
  project: Project;
  settings: Settings;
  /** The artifact the operation works on, when there is one. */
  artifact?: Artifact | null;
  /**
   * The agent's base memory. Defaults to `settings.agentMemory`; the chat
   * passes its own, which falls back to the agent's identity when empty.
   */
  agentMemory?: readonly string[];
  /** What the operation is about: the request, the objective, the question. */
  query?: string;
  /** A version group whose siblings must not be excerpted (its own previous output). */
  excludeVersionGroupId?: string;
}

export interface ArtifactContextItem {
  /** What the prompt shows: annotation plus note, or name plus excerpt. */
  text: string;
  /** What two scopes are compared by when deciding a duplicate. */
  key: string;
}

export interface ArtifactContextSection {
  scope: ArtifactContextScope;
  items: ArtifactContextItem[];
}

export type ArtifactContextOmissionReason = 'ruido' | 'limite' | 'duplicado' | 'presupuesto';

export interface ArtifactContextOmission {
  scope: ArtifactContextScope;
  count: number;
  reason: ArtifactContextOmissionReason;
}

export interface ArtifactContextBundle {
  profile: ArtifactContextProfileName;
  /** Non-empty sections, in hierarchy order. */
  sections: ArtifactContextSection[];
  /** Every note that was available and left out, and why. */
  omitted: ArtifactContextOmission[];
  /** Characters of every item kept. */
  chars: number;
}

// ─── Assembly ───────────────────────────────────────────────────────────────

const normalizeKey = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').replace(/[.;:,\s]+$/, '').trim();

const excerptOf = (content: string, maxChars: number): string => {
  const prose = (content ?? '')
    .replace(/```(?:mermaid|json|yaml|xml)[\s\S]*?```/gi, '[bloque de diagrama/código omitido]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (prose.length <= maxChars) return prose;
  const cut = prose.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return `${cut.slice(0, lastBreak > maxChars * 0.6 ? lastBreak : maxChars).trimEnd()}\n[…extracto truncado…]`;
};

interface Candidates {
  items: ArtifactContextItem[];
  /** Candidates worth showing, before the limit. */
  available: number;
  /** Conversational echoes left out before ranking. */
  noise?: number;
}

interface NoteRanking {
  limit: number;
  noteChars: number;
  query: string | undefined;
  noteBoost?: (text: string) => number;
}

function memoryCandidates(
  texts: readonly string[] | null | undefined,
  entries: Parameters<typeof rankRelevantMemoryEntries>[0]['entries'],
  ranking: NoteRanking,
): Candidates {
  const present = (texts ?? []).filter((text): text is string => typeof text === 'string' && text.trim().length > 0);
  const meaningful = present.filter((text) => !isConversationalEcho(text));
  const ranked = rankRelevantMemoryEntries({
    texts: meaningful,
    entries,
    query: ranking.query,
    limit: ranking.limit,
    bulletCharCap: ranking.noteChars,
    extraScore: ranking.noteBoost,
  });
  return {
    items: ranked.map((note) => ({ text: note.rendered, key: normalizeKey(note.entry.text) })),
    available: Math.max(meaningful.length, ranked.length),
    noise: present.length - meaningful.length,
  };
}

/**
 * Sibling artifacts ranked by how much of the query they mention; without a
 * query, documents first (they carry the requirements and decisions a new
 * artifact must agree with), then the most recent.
 */
function siblingCandidates(sources: ArtifactContextSources, limit: number, excerptChars: number, query: string | undefined): Candidates {
  const excluded = new Set([sources.excludeVersionGroupId, sources.artifact?.versionGroupId].filter(Boolean));
  const siblings = getLatestArtifacts(sources.project.artifacts ?? [])
    .filter((artifact) => !excluded.has(artifact.versionGroupId))
    .filter((artifact) => (artifact.content ?? '').trim().length >= 120);
  const isDocument = (artifact: Artifact): number => (artifact.representation === 'document' || artifact.representation === 'hybrid' ? 1 : 0);
  const relevance = (artifact: Artifact): number =>
    query ? scoreBulletForQuery(`${artifact.name} ${artifact.objective ?? ''} ${excerptOf(artifact.content, 600)}`, query) : 0;
  const ranked = siblings
    .map((artifact) => ({ artifact, relevance: relevance(artifact) }))
    .sort((a, b) => (b.relevance - a.relevance)
      || (isDocument(b.artifact) - isDocument(a.artifact))
      || (b.artifact.createdAt ?? '').localeCompare(a.artifact.createdAt ?? ''))
    .slice(0, limit);
  return {
    items: ranked.map(({ artifact }) => ({
      text: `### «${artifact.name}» (${artifact.type})\n${excerptOf(artifact.content, excerptChars)}`,
      key: `artefacto:${artifact.versionGroupId}`,
    })),
    available: siblings.length,
  };
}

function candidatesFor(scope: ArtifactContextScope, sources: ArtifactContextSources, profileDef: ArtifactContextProfile): Candidates {
  const { project, settings, artifact, query } = sources;
  const ranking: NoteRanking = { limit: profileDef.limits[scope] ?? 0, noteChars: profileDef.noteChars, query, noteBoost: profileDef.noteBoost };
  switch (scope) {
    case 'artefacto':
      return memoryCandidates(artifact?.artifactMemory, artifact?.artifactMemoryEntries, ranking);
    case 'proyecto':
      return memoryCandidates(project.projectContext, project.projectContextEntries, ranking);
    case 'capturaInicial':
      return memoryCandidates(project.initialCapture, project.initialCaptureEntries, ranking);
    case 'memoriaProyecto':
      return memoryCandidates(project.agentMemory, project.agentMemoryEntries, ranking);
    case 'global':
      return memoryCandidates(settings.globalContext, settings.globalContextEntries, ranking);
    case 'agente':
      return memoryCandidates(sources.agentMemory ?? settings.agentMemory, undefined, ranking);
    case 'hermanos':
      return siblingCandidates(sources, ranking.limit, profileDef.excerptChars, query);
  }
}

const addOmission = (omitted: ArtifactContextOmission[], scope: ArtifactContextScope, count: number, reason: ArtifactContextOmissionReason): void => {
  if (count <= 0) return;
  const existing = omitted.find((entry) => entry.scope === scope && entry.reason === reason);
  if (existing) existing.count += count;
  else omitted.push({ scope, count, reason });
};

/** Assemble the context of one operation. Never throws. */
export function assembleArtifactContext(
  sources: ArtifactContextSources,
  profile: ArtifactContextProfileName | ArtifactContextProfile,
): ArtifactContextBundle {
  const profileDef = typeof profile === 'string' ? ARTIFACT_CONTEXT_PROFILES[profile] : profile;
  const profileName = profileDef.name;
  const omitted: ArtifactContextOmission[] = [];
  const seen = new Set<string>();
  const sections: ArtifactContextSection[] = [];

  // Hierarchy order: the first scope to hold a note keeps it.
  for (const scope of ARTIFACT_CONTEXT_SCOPES) {
    if (!profileDef.limits[scope]) continue;
    const { items, available, noise } = candidatesFor(scope, sources, profileDef);
    addOmission(omitted, scope, noise ?? 0, 'ruido');
    addOmission(omitted, scope, available - items.length, 'limite');
    const kept = items.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
    addOmission(omitted, scope, items.length - kept.length, 'duplicado');
    if (kept.length > 0) sections.push({ scope, items: kept });
  }

  // Budget: cut from the bottom of the hierarchy, last item first.
  const size = (): number => sections.reduce((sum, section) => sum + section.items.reduce((acc, item) => acc + item.text.length + 3, 0), 0);
  for (let index = sections.length - 1; index >= 0 && size() > profileDef.totalChars; index -= 1) {
    const section = sections[index];
    while (section.items.length > 0 && size() > profileDef.totalChars) {
      section.items.pop();
      addOmission(omitted, section.scope, 1, 'presupuesto');
    }
  }

  const nonEmpty = sections.filter((section) => section.items.length > 0);
  return { profile: profileName, sections: nonEmpty, omitted, chars: size() };
}

/** The items a bundle kept for one scope (empty when it kept none). */
export const bundleItems = (bundle: ArtifactContextBundle, scope: ArtifactContextScope): string[] =>
  bundle.sections.find((section) => section.scope === scope)?.items.map((item) => item.text) ?? [];

// ─── Rendering ──────────────────────────────────────────────────────────────

/** How each scope is titled in a prompt. The chat's composer uses the same words. */
export const ARTIFACT_CONTEXT_TITLES: Readonly<Record<ArtifactContextScope, string>> = Object.freeze({
  artefacto: 'Memoria del Artefacto',
  proyecto: 'Contexto del Proyecto (selección relevante)',
  capturaInicial: 'Captura Inicial del Proyecto (objetivos, alcance, stakeholders)',
  memoriaProyecto: 'Memoria del Agente (Proyecto)',
  global: 'Memoria Global (estándares y preferencias)',
  agente: 'Preferencias del Arquitecto (memoria del agente)',
  hermanos: 'Extractos de artefactos relacionados del proyecto (fuente de verdad para nombres, IDs y decisiones; no los contradigas)',
});

/** The rule that tells the model how to weigh the scopes it just read. */
export const ARTIFACT_CONTEXT_HIERARCHY_RULE = [
  'Jerarquía del contexto (obligatoria):',
  '- Usa todos los ámbitos disponibles; ante información en conflicto, manda el artefacto > el proyecto (contexto, captura inicial, memoria del proyecto) > lo global > las preferencias del arquitecto.',
  '- Dentro de un ámbito, manda la prioridad de la nota (alta > media > baja) y, a igual prioridad, la más reciente. Las anotaciones [prioridad · fecha · autor] lo indican.',
  '- Mantén los nombres, IDs y decisiones de los artefactos relacionados; si detectas una contradicción, señálala en vez de elegir en silencio.',
].join('\n');

/**
 * The bundle as one fenced block, with the hierarchy rule outside the fence:
 * everything inside is what people wrote, the rule is what the application says.
 */
export function renderArtifactContextBundle(bundle: ArtifactContextBundle): string {
  if (bundle.sections.length === 0) return '';
  const body = bundle.sections
    .map((section) => {
      const lines = section.scope === 'hermanos'
        ? section.items.map((item) => item.text)
        : section.items.map((item) => `- ${item.text}`);
      return [`${ARTIFACT_CONTEXT_TITLES[section.scope]}:`, ...lines].join('\n');
    })
    .join('\n\n');
  return [wrapUntrustedContent('contexto del proyecto', body), ARTIFACT_CONTEXT_HIERARCHY_RULE].join('\n');
}

/** A diagram's context, ranked against the artifact it will draw (the IR path, 7.2b). */
export const renderDiagramContextBundle = (project: Project, settings: Settings, artifact?: Artifact): string =>
  renderArtifactContextBundle(assembleArtifactContext(
    { project, settings, artifact, query: artifact ? `${artifact.name}. ${artifact.objective ?? ''}` : undefined },
    'diagram',
  ));
