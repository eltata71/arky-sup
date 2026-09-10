/**
 * Assigns Architecture Office work to personas.
 *
 * This replaces the seven-regex `ROUTING_RULES` table that only ever answered
 * "which personas are vaguely relevant to this sentence". Assigning a task
 * needs a stronger answer: *this* persona, for *this* artifact type, with a
 * *different* persona reviewing it.
 *
 * The scoring is deterministic and pure — no AI, no I/O — so the planner can
 * produce a working charter even when the model is unavailable, and every
 * routing decision is reproducible in a test.
 */

import type { ArtifactType } from '../../types';
import {
  OFFICE_AGENT_PERSONAS,
  type OfficeAgentId,
  type OfficeAgentPersona,
} from './officeAgentPersonas';
// The registry is the only door onto "which agent?". The router asks it rather
// than filtering the record itself — three doors onto one table is how the
// Office ended up with two routing tables that disagreed.
import {
  canTakeWorkstream,
  findAgentsThatProduce,
  findAgentsThatReview,
} from './agentRegistry';
import { foldOfficeText } from './officeShared';

/** Weight added when a domain keyword for the persona appears in the brief. */
const DOMAIN_SIGNAL_WEIGHT = 3;
/** Weight added when the persona declares the exact artifact type. */
const TYPE_MATCH_WEIGHT = 5;
/** Small bias so a specialist beats the generalist on equal evidence. */
const SPECIALIST_BIAS = 1;

interface DomainSignal {
  personaId: OfficeAgentId;
  pattern: RegExp;
  /**
   * Suppresses the signal when the match is a false positive. "Health Cloud"
   * and "Financial Services Cloud" are Salesforce products, not AWS work —
   * without this, a bare `cloud` sends Salesforce deliverables to the AWS
   * architect.
   */
  notWhen?: RegExp;
  /**
   * Overrides the default weight. Product-specific, multi-word signals score
   * higher than generic ones so the specialist wins the tie.
   */
  weight?: number;
}

/**
 * Accent-folded signals. Kept as data next to the personas they score so a new
 * persona is one entry here plus one entry in the registry.
 *
 * **This is the only routing table in the Office.** There used to be a second
 * one — `ROUTING_RULES` inside `officeOrchestration.ts` — answering the same
 * question for the coordination path, and the two had drifted: this table
 * learned the `notWhen` suppression that stops "Health Cloud" (a Salesforce
 * product) reaching the AWS architect, and the copy never did. The same
 * sentence therefore convened a different specialist depending on whether it
 * arrived as a deliverable or as a coordination request.
 *
 * Merging them meant taking the union, not picking a winner: `seguridad`,
 * `proyecto` and `data` existed only in the copy and are marked below, because
 * a keyword silently dropped in a merge is a specialist who silently stops
 * being called.
 */
const DOMAIN_SIGNALS: readonly DomainSignal[] = Object.freeze([
  {
    personaId: 'felipe',
    pattern: /\b(aws|cloud|nube|serverless|lambda|eks|ecs|s3|costo|costos)\b/,
    notWhen: /\b(health|financial services|sales|service|marketing|commerce|experience)\s+cloud\b/,
  },
  {
    personaId: 'natalia',
    pattern: /\b(salesforce|health cloud|financial services cloud|fsc|apex|flow|sharing)\b/,
    weight: 4,
  },
  { personaId: 'mauricio', pattern: /\b(mulesoft|anypoint|api|apis|integraci|raml|openapi|asyncapi|esb)\b/ },
  { personaId: 'ricardo', pattern: /\b(as.?400|ibm i|rpg|cobol|db2|legacy|mainframe|modernizaci)\b/ },
  { personaId: 'gabriel', pattern: /\b(software|componente|componentes|nfr|resilien|prueba|pruebas|test|rendimiento|latencia)\b/ },
  // `seguridad` came from the merged coordination table.
  { personaId: 'elena', pattern: /\b(artefact|diagrama|diagramas|c4|adr|stride|amenaza|seguridad|erd|contrato|contratos)\b/ },
  // `proyecto` came from the merged coordination table.
  { personaId: 'tomas', pattern: /\b(reporte|estado|cronograma|seguimiento|hito|hitos|backlog|proyecto)\b/ },
  { personaId: 'sofia', pattern: /\b(poliza|polizas|siniestro|siniestros|suscripci|reaseguro|prima|primas|cobertura|coberturas|endoso|acord|asegurad|ramo|siniestralidad)\b/ },
  // `data` came from the merged coordination table.
  { personaId: 'daniel', pattern: /\b(dato|datos|data|analitic|analitica|actuarial|reserva|reservas|tarificaci|linaje|reporting|bi|datamart|datalake)\b/ },
  { personaId: 'carmen', pattern: /\b(cumplimiento|compliance|regulator|regulatorio|solvencia|naic|hipaa|dora|iso 27001|auditor|auditoria|riesgo|riesgos|pii|phi|gdpr)\b/ },
]);

export interface OfficeRoutingSignal {
  personaId: OfficeAgentId;
  score: number;
  reasons: string[];
}

/**
 * Ranks personas against a free-form brief. Used to decide which specialists
 * take part in an engagement at all, before any artifact type is known.
 */
/** True when the signal fires and is not suppressed by a known false positive. */
const signalMatches = (signal: DomainSignal, normalizedText: string): boolean => {
  if (!signal.pattern.test(normalizedText)) return false;
  if (signal.notWhen?.test(normalizedText)) return false;
  return true;
};

export const rankPersonasForBrief = (brief: string): OfficeRoutingSignal[] => {
  const normalized = foldOfficeText(brief);
  const scores = new Map<OfficeAgentId, OfficeRoutingSignal>();

  for (const signal of DOMAIN_SIGNALS) {
    if (!signalMatches(signal, normalized)) continue;
    const persona = OFFICE_AGENT_PERSONAS[signal.personaId];
    scores.set(signal.personaId, {
      personaId: signal.personaId,
      score: (signal.weight ?? DOMAIN_SIGNAL_WEIGHT) + SPECIALIST_BIAS,
      reasons: [`Señal de dominio ${persona.domains[0]} presente en la solicitud.`],
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score || a.personaId.localeCompare(b.personaId));
};

/**
 * The specialists a free-form request should convene, in rank order.
 *
 * The coordination path needs a *team*, not an assignment, and it needs one
 * more guarantee than `rankPersonasForBrief` gives: that everyone it returns
 * can actually take a workstream. That used to be a hardcoded
 * `Exclude<OfficeAgentId, 'arky' | 'lucia' | 'alejandro'>` on the workstream
 * type — a list of three names kept in step by hand with a registry that
 * already declares the same fact twice over.
 *
 * So it is asked of the registry: a persona takes a workstream when it is a
 * `participant` (not the generalist, the coordinator or the consolidator) and
 * declares the `consult` capability. A persona that declares neither is never
 * returned, whatever the brief says — which is the capability rule the
 * deliverable path has always had through `producesArtifactTypes`, and the
 * coordination path never did.
 */
export const rankSpecialistsForRequest = (request: string): OfficeAgentId[] =>
  rankPersonasForBrief(request)
    .map((signal) => OFFICE_AGENT_PERSONAS[signal.personaId])
    .filter(canTakeWorkstream)
    .map((persona) => persona.id);

export interface OfficeAssignment {
  assigneeId: OfficeAgentId;
  reviewerId: OfficeAgentId;
  rationale: string;
}

interface AssignmentOptions {
  /** Personas already taking part; they get preference to keep the team tight. */
  preferredIds?: readonly OfficeAgentId[];
  /** Persona ids excluded from production (e.g. already at capacity). */
  excludeAssignees?: readonly OfficeAgentId[];
}

const scoreCandidate = (
  persona: OfficeAgentPersona,
  type: ArtifactType,
  normalizedBrief: string,
  preferred: ReadonlySet<OfficeAgentId>,
): { score: number; reasons: string[] } => {
  const reasons: string[] = [];
  let score = 0;

  if (persona.producesArtifactTypes.includes(type)) {
    score += TYPE_MATCH_WEIGHT;
    reasons.push(`Declara ${type} entre los artefactos que produce.`);
  }

  const signal = DOMAIN_SIGNALS.find((candidate) => candidate.personaId === persona.id);
  if (signal && signalMatches(signal, normalizedBrief)) {
    score += signal.weight ?? DOMAIN_SIGNAL_WEIGHT;
    reasons.push(`La solicitud menciona su dominio (${persona.domains[0]}).`);
  }

  if (preferred.has(persona.id)) {
    score += 2;
    reasons.push('Ya participa en el encargo.');
  }

  if (persona.orchestrationRole === 'participant') {
    score += SPECIALIST_BIAS;
  }

  return { score, reasons };
};

/**
 * Picks the producer and the reviewer for one deliverable.
 *
 * Returns `null` only when no persona in the registry can produce the type —
 * a planner bug worth surfacing rather than silently assigning the generalist.
 *
 * The reviewer is always a **different** persona than the producer. That is the
 * separation-of-duties rule the whole review loop rests on: a persona must not
 * sign off its own output.
 */
export const assignDeliverable = (
  type: ArtifactType,
  brief: string,
  options: AssignmentOptions = {},
): OfficeAssignment | null => {
  const normalizedBrief = foldOfficeText(brief);
  const preferred = new Set(options.preferredIds ?? []);
  const excluded = new Set(options.excludeAssignees ?? []);

  const producers = findAgentsThatProduce(type)
    .filter((persona) => !excluded.has(persona.id))
    .map((persona) => ({ persona, ...scoreCandidate(persona, type, normalizedBrief, preferred) }))
    .sort((a, b) => b.score - a.score || a.persona.id.localeCompare(b.persona.id));

  if (producers.length === 0) return null;
  const winner = producers[0];

  const reviewers = findAgentsThatReview(type)
    .filter((persona) => persona.id !== winner.persona.id)
    .map((persona) => ({ persona, ...scoreCandidate(persona, type, normalizedBrief, preferred) }))
    .sort((a, b) => b.score - a.score || a.persona.id.localeCompare(b.persona.id));

  // Elena is the artifact steward and reviews nearly everything, so she is the
  // structural fallback when no domain reviewer declares the type. Alejandro
  // backs her up for the handful of types she authors herself.
  const reviewerId = reviewers[0]?.persona.id
    ?? (winner.persona.id === 'elena' ? 'alejandro' : 'elena');

  return {
    assigneeId: winner.persona.id,
    reviewerId,
    rationale: winner.reasons.length > 0
      ? winner.reasons.join(' ')
      : `${winner.persona.role} puede producir ${type}.`,
  };
};
