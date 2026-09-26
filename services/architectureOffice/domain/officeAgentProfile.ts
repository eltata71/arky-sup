/**
 * The configurable half of a specialist.
 *
 * `officeAgentPersonas.ts` declares what each agent *is* by default: its role,
 * its domains, the artifact types it may author or review, the standards it
 * upholds. That registry is frozen and shipped with the product — it is the
 * discipline the Office is built on, not a preference.
 *
 * What a customer legitimately wants to change is a different set of things:
 * how the agent is named and shown, what extra skills and knowledge it carries
 * for *their* organisation, what it must remember across engagements, how much
 * model it gets, and how much work it may take at once. That is this file.
 *
 * The split is the point. An override never removes a capability the router
 * depends on — `producesArtifactTypes`, `reviewsArtifactTypes` and
 * `orchestrationRole` are not overridable, because the separation of duties
 * between a producer and its reviewer and the "one coordinator, one
 * consolidator" rule are governance, not configuration. A screen that could
 * switch them off could switch off the reason the Office exists.
 *
 * Everything else is additive by construction: skills, knowledge and memory are
 * *appended* to the persona's own, never replaced. An organisation adding "our
 * broker channel runs on AS/400" to Sofía should not thereby delete what Sofía
 * knows about ACORD.
 */

import type { ModelTier } from '../../../lib/ai/modelCatalog';
import { listAgents } from './agentRegistry';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId, type OfficeAgentPersona } from './officeAgentPersonas';

export const OFFICE_AGENT_PROFILE_SCHEMA_VERSION = 1;

/** How many entries a single override list may hold. A profile is a card, not a corpus. */
export const MAX_PROFILE_ENTRIES = 12;
/** Longest single entry. Beyond this it is a document and belongs in the knowledge graph. */
export const MAX_PROFILE_ENTRY_LENGTH = 280;

/**
 * What a user may change about an agent, as it is stored.
 *
 * Every field is optional and absent means "keep the persona's default". A
 * profile that stores the defaults would silently freeze them: the next release
 * that improves Elena's instruction would not reach anyone who had ever opened
 * her card.
 */
export interface OfficeAgentProfileOverride {
  agentId: OfficeAgentId;
  userId: string;
  schemaVersion: number;
  /** Display name. The persona's alias is what mentions (`@Elena`) still resolve. */
  alias?: string;
  role?: string;
  /** One or two emoji shown as the agent's face. Nothing else is accepted. */
  avatar?: string;
  /** Extra domain skills this organisation expects from the agent. */
  skills?: string[];
  /** Organisation-specific knowledge the agent must apply. */
  knowledge?: string[];
  /** What the agent must carry across engagements — decisions, conventions, vetoes. */
  memory?: string[];
  /** Replaces the persona's own instruction when set. */
  instruction?: string;
  /** How much model this agent gets. */
  modelTier?: ModelTier;
  /** Upper bound of tasks the runner may schedule for it at once. */
  maxConcurrentTasks?: number;
  /**
   * A disabled agent is not offered to the router or the team. It is never
   * deleted: the personas are a fixed cast, and a deleted one would leave the
   * engagements that name it unreadable.
   */
  enabled?: boolean;
  updatedAt: string;
}

/**
 * A persona plus its overrides, resolved. This is what every consumer reads —
 * the UI, the briefing composer, the router — so nobody has to remember to
 * apply the overrides themselves.
 */
export interface OfficeAgentProfile {
  agentId: OfficeAgentId;
  alias: string;
  role: string;
  avatar?: string;
  domains: string[];
  capabilities: OfficeAgentPersona['capabilities'];
  orchestrationRole: OfficeAgentPersona['orchestrationRole'];
  instruction: string;
  /** The persona's own standards plus any organisation skills added on top. */
  skills: string[];
  knowledge: string[];
  memory: string[];
  standardIds: string[];
  producesArtifactTypes: OfficeAgentPersona['producesArtifactTypes'];
  reviewsArtifactTypes: OfficeAgentPersona['reviewsArtifactTypes'];
  modelTier: ModelTier;
  maxConcurrentTasks: number;
  enabled: boolean;
  /**
   * Versión del contrato del agente con la que se resolvió esta ficha.
   *
   * Una organización que le enseñó a Sofía su canal de corredores bajo la v1
   * tiene derecho a saber que su instrucción se ha reescrito desde entonces:
   * el override es aditivo y sobrevive al cambio, que es justo lo que lo hace
   * difícil de detectar sin este número.
   */
  definitionVersion: number;
  /** True when a stored override contributes anything to this view. */
  customized: boolean;
}

const MODEL_TIERS: readonly ModelTier[] = ['quick', 'default', 'deep'];

/** Emoji only: an avatar is a glyph, and arbitrary text here would be markup in a badge. */
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}]{1,4}$/u;

export type OfficeAgentProfileRejectionCode =
  | 'unknown-agent'
  | 'empty-alias'
  | 'invalid-avatar'
  | 'invalid-model-tier'
  | 'invalid-concurrency';

export interface OfficeAgentProfileRejection {
  outcome: 'rejected';
  code: OfficeAgentProfileRejectionCode;
  /** Spanish, user-facing: the screen renders this next to the field. */
  message: string;
}

export type OfficeAgentProfileCreation =
  | { outcome: 'created'; override: OfficeAgentProfileOverride }
  | OfficeAgentProfileRejection;

/** What the editor submits. Every field optional; absent clears the override. */
export interface OfficeAgentProfileInput {
  agentId: OfficeAgentId;
  userId: string;
  alias?: string;
  role?: string;
  avatar?: string;
  skills?: string[];
  knowledge?: string[];
  memory?: string[];
  instruction?: string;
  modelTier?: ModelTier;
  maxConcurrentTasks?: number;
  enabled?: boolean;
}

const reject = (
  code: OfficeAgentProfileRejectionCode,
  message: string,
): OfficeAgentProfileRejection => ({ outcome: 'rejected', code, message });

const cleanList = (values: readonly string[] | undefined): string[] | undefined => {
  if (!values) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim().slice(0, MAX_PROFILE_ENTRY_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_PROFILE_ENTRIES) break;
  }
  return result.length > 0 ? result : undefined;
};

const cleanText = (value: string | undefined, limit: number): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
};

/**
 * The only way to build a stored override.
 *
 * Returns a typed rejection rather than throwing, for the reason the other four
 * aggregate factories do: a malformed avatar is an outcome the editor renders
 * next to the field, and a `throw` would push every caller into a `try` most
 * would write empty.
 */
export const createAgentProfileOverride = (
  input: OfficeAgentProfileInput,
  now: () => string = () => new Date().toISOString(),
): OfficeAgentProfileCreation => {
  if (!OFFICE_AGENT_PERSONAS[input.agentId]) {
    return reject('unknown-agent', 'Ese agente no existe en la Oficina de Arquitectura.');
  }
  // An alias that is present but blank is a different mistake from an absent
  // one: absent means "use the default", blank means the user emptied the field
  // and would end up with a nameless agent on every board.
  if (input.alias !== undefined && input.alias.trim().length === 0) {
    return reject('empty-alias', 'El nombre del agente no puede quedar vacío. Bórralo del formulario si quieres volver al nombre por defecto.');
  }
  if (input.avatar !== undefined && input.avatar.trim().length > 0 && !EMOJI_ONLY.test(input.avatar.trim())) {
    return reject('invalid-avatar', 'El avatar admite uno o dos emoji. Deja el campo vacío para usar el icono de su dominio.');
  }
  if (input.modelTier !== undefined && !MODEL_TIERS.includes(input.modelTier)) {
    return reject('invalid-model-tier', 'Ese nivel de modelo no existe.');
  }
  if (input.maxConcurrentTasks !== undefined
    && (!Number.isInteger(input.maxConcurrentTasks) || input.maxConcurrentTasks < 1 || input.maxConcurrentTasks > 5)) {
    return reject('invalid-concurrency', 'Las tareas simultáneas van de 1 a 5. Más no acelera nada: el límite existe para no agotar la cuota del proveedor.');
  }

  return {
    outcome: 'created',
    override: {
      agentId: input.agentId,
      userId: input.userId,
      schemaVersion: OFFICE_AGENT_PROFILE_SCHEMA_VERSION,
      alias: cleanText(input.alias, 40),
      role: cleanText(input.role, 120),
      avatar: cleanText(input.avatar, 8),
      skills: cleanList(input.skills),
      knowledge: cleanList(input.knowledge),
      memory: cleanList(input.memory),
      instruction: cleanText(input.instruction, 1200),
      modelTier: input.modelTier,
      maxConcurrentTasks: input.maxConcurrentTasks,
      enabled: input.enabled,
      updatedAt: now(),
    },
  };
};

/** The persona's own skills, expressed as text: its domains and its capabilities. */
const personaSkills = (persona: OfficeAgentPersona): string[] => [
  ...persona.domains,
  ...persona.capabilities,
];

/**
 * Persona + override → the profile every consumer reads.
 *
 * Additive on purpose for the three lists: an organisation that teaches Sofía
 * about its broker channel has not thereby made her forget ACORD.
 */
export const resolveAgentProfile = (
  agentId: OfficeAgentId,
  override?: OfficeAgentProfileOverride,
): OfficeAgentProfile => {
  const persona = OFFICE_AGENT_PERSONAS[agentId];
  const applied = override && override.agentId === agentId ? override : undefined;
  const extraSkills = applied?.skills ?? [];
  return {
    agentId,
    alias: applied?.alias ?? persona.alias,
    role: applied?.role ?? persona.role,
    avatar: applied?.avatar,
    domains: [...persona.domains],
    capabilities: persona.capabilities,
    orchestrationRole: persona.orchestrationRole,
    instruction: applied?.instruction ?? persona.instruction,
    skills: [...personaSkills(persona), ...extraSkills],
    knowledge: applied?.knowledge ?? [],
    memory: applied?.memory ?? [],
    standardIds: [...persona.standardIds],
    producesArtifactTypes: persona.producesArtifactTypes,
    reviewsArtifactTypes: persona.reviewsArtifactTypes,
    // La definición decide el nivel por defecto, no un literal: una revisión
    // regulatoria y un informe de estado no necesitan el mismo modelo, y hasta
    // ahora los trece agentes resolvían `'default'` pasara lo que pasara.
    modelTier: applied?.modelTier ?? persona.modelTier,
    maxConcurrentTasks: applied?.maxConcurrentTasks ?? persona.maxConcurrentTasks,
    enabled: applied?.enabled ?? true,
    definitionVersion: persona.version,
    customized: Boolean(applied),
  };
};

/**
 * Cuánto de cada lista del perfil resuelto viene del producto.
 *
 * La ficha tiene que poder distinguir lo heredado de lo añadido —un lector que
 * no sabe si una regla la trae el producto o la escribió un compañero suyo no
 * puede juzgar la respuesta que el agente firme con ella— y quien sabe dónde
 * está la costura es `resolveAgentProfile`, que concatena en ese orden. Que lo
 * dedujera la pantalla sería una segunda definición de la misma regla.
 */
export interface InheritedProfileEntries {
  skills: number;
  knowledge: number;
  memory: number;
}

export const inheritedProfileEntries = (agentId: OfficeAgentId): InheritedProfileEntries => ({
  skills: personaSkills(OFFICE_AGENT_PERSONAS[agentId]).length,
  // El conocimiento y la memoria no vienen de la persona: son enteramente lo
  // que esta organización le ha enseñado.
  knowledge: 0,
  memory: 0,
});

/** The whole cast, resolved against the overrides a user has stored. */
export const resolveAgentProfiles = (
  overrides: readonly OfficeAgentProfileOverride[] = [],
): OfficeAgentProfile[] => {
  const byId = new Map(overrides.map((entry) => [entry.agentId, entry]));
  // El roster lo da el registro. Leer las claves del record es la misma
  // consulta escrita otra vez, y la copia es la que se queda atrás.
  return listAgents().map((agent) => resolveAgentProfile(agent.id, byId.get(agent.id)));
};

/**
 * The persona's configured voice, as the lines a prompt carries.
 *
 * One composer, used by the coordinated team and by the single-agent capture
 * assistant alike, so a customisation the user made on the agent's card reaches
 * every place that agent speaks. A second composer somewhere else is how "I
 * changed Elena's instruction and nothing happened" becomes a support ticket.
 */
export const buildAgentProfileBriefing = (profile: OfficeAgentProfile): string[] => {
  const lines = [
    `Eres ${profile.alias}, ${profile.role}, agente de la Oficina de Arquitectura de Arky.`,
    `Dominios: ${profile.domains.join(', ')}.`,
    `Capacidades: ${profile.capabilities.join(', ')}.`,
    profile.instruction,
  ];
  if (profile.skills.length > 0) {
    lines.push(`Habilidades declaradas: ${profile.skills.join(', ')}.`);
  }
  if (profile.knowledge.length > 0) {
    lines.push('Conocimiento de la organización que debes aplicar:');
    lines.push(...profile.knowledge.map((entry) => `- ${entry}`));
  }
  if (profile.memory.length > 0) {
    lines.push('Memoria de trabajo que debes respetar en cada respuesta:');
    lines.push(...profile.memory.map((entry) => `- ${entry}`));
  }
  return lines.filter((line) => line.trim().length > 0);
};

/**
 * Las líneas de prompt de los agentes **personalizados**, y sólo de ésos.
 *
 * Un agente sin ficha guardada ya recibe su instrucción de fábrica por el
 * camino de siempre (`buildOfficePersonaInstruction`, dentro del motor).
 * Mandarle además estas líneas sería decirle dos veces lo mismo, y un prompt
 * que se repite a sí mismo enseña al modelo que la repetición es la señal.
 */
export const customizedAgentBriefings = (
  profiles: readonly OfficeAgentProfile[],
): Partial<Record<OfficeAgentId, string[]>> => {
  const briefings: Partial<Record<OfficeAgentId, string[]>> = {};
  for (const profile of profiles) {
    if (!profile.customized) continue;
    briefings[profile.agentId] = buildAgentProfileBriefing(profile);
  }
  return briefings;
};

/**
 * El nivel de modelo que cada agente tiene configurado en su ficha.
 *
 * La ficha deja elegirlo desde el principio y la Oficina no lo leía: todos los
 * agentes corrían con el modelo por defecto, así que subir a Carmen a un nivel
 * superior para una revisión regulatoria cambiaba un desplegable y nada más.
 * Sólo la captura asistida lo aplicaba.
 *
 * Se devuelve el mapa completo —no sólo lo personalizado— porque quien invoca
 * necesita un nivel para cada agente, y el de fábrica es una respuesta tan
 * válida como el configurado.
 */
export const configuredModelTiers = (
  profiles: readonly OfficeAgentProfile[],
): Partial<Record<OfficeAgentId, ModelTier>> => {
  const tiers: Partial<Record<OfficeAgentId, ModelTier>> = {};
  for (const profile of profiles) tiers[profile.agentId] = profile.modelTier;
  return tiers;
};

/** Los agentes que el usuario ha desactivado. La Oficina no los convoca. */
export const disabledAgentIds = (
  profiles: readonly OfficeAgentProfile[],
): OfficeAgentId[] => profiles.filter((profile) => !profile.enabled).map((profile) => profile.agentId);
