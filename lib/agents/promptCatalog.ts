/**
 * Los prompts de los agentes, con nombre y versión (plan de agentes, 15.1 · A23).
 *
 * Ninguna respuesta de un agente decía qué prompt la produjo: mejorar una
 * instrucción no dejaba rastro comparable, y dos respuestas distintas a la
 * misma pregunta no se podían atribuir a un cambio de plantilla o a la
 * variabilidad del modelo. Cada plantilla de la Oficina tiene aquí su id, su
 * versión y la **huella** de su texto renderizado sobre un caso canónico
 * (`__tests__/lib/agents/promptCatalog.test.ts`): cambiar el texto sin subir la
 * versión hace fallar la suite, y cada invocación lleva su sello
 * `id@vN#hash` hasta la traza.
 *
 * Fundación sin comportamiento de dominio: lo leen la Oficina, el runner y el
 * banco de agentes, y no importa nada.
 */

export type AgentPromptId =
  | 'office.persona'
  | 'office.profile-briefing'
  | 'office.scope-briefing'
  | 'office.coordination'
  | 'office.workstream'
  | 'office.consolidation'
  | 'office.consolidation-refinement'
  | 'office.production'
  | 'office.review'
  | 'office.engagement-consolidation';

export interface AgentPromptEntry {
  /** Sube cada vez que cambia el texto que la plantilla produce. */
  version: number;
  /** Huella del texto renderizado sobre el caso canónico de la prueba. */
  fingerprint: string;
  /** Para qué sirve, en una frase: es lo que lee quien abre una traza. */
  description: string;
}

export const AGENT_PROMPTS: Readonly<Record<AgentPromptId, AgentPromptEntry>> = Object.freeze({
  'office.persona': {
    version: 2,
    fingerprint: '5f74d5ed',
    description: 'Persona especializada activa: rol, dominios, alcance, no-objetivos e instrucción.',
  },
  'office.profile-briefing': {
    version: 2,
    fingerprint: 'a26f12b0',
    description: 'La voz configurada de un agente en su ficha: conocimiento, memoria e instrucción de la organización.',
  },
  'office.scope-briefing': {
    version: 1,
    fingerprint: 'eceac265',
    description: 'El registro desde el que se pregunta (iniciativa, proyecto o entregable) y su ascendencia.',
  },
  'office.coordination': {
    version: 1,
    fingerprint: '007abd2f',
    description: 'El encargo a la coordinadora: revisar la descomposición y escribir el brief para los especialistas.',
  },
  'office.workstream': {
    version: 1,
    fingerprint: 'dac65580',
    description: 'El handoff de un workstream de la coordinadora a un especialista.',
  },
  'office.consolidation': {
    version: 1,
    fingerprint: '487729f4',
    description: 'El handoff de los análisis al consolidador para firmar la recomendación.',
  },
  'office.consolidation-refinement': {
    version: 1,
    fingerprint: '28dc53d3',
    description: 'La única pasada de corrección del consolidador, con los huecos que encontró el evaluador.',
  },
  'office.production': {
    version: 2,
    fingerprint: 'cd2e2516',
    description: 'La instrucción con la que un agente produce el artefacto de una tarea de encargo.',
  },
  'office.review': {
    version: 2,
    fingerprint: 'a5107613',
    description: 'La revisión de un artefacto por otro agente, con la evidencia determinista y el JSON esperado.',
  },
  'office.engagement-consolidation': {
    version: 2,
    fingerprint: '79826462',
    description: 'La consolidación final de un encargo sobre sus entregables y revisiones.',
  },
});

/** Qué plantilla, en qué versión. Lo que viaja con una invocación. */
export interface AgentPromptRef {
  id: AgentPromptId;
  version: number;
}

export const agentPromptRef = (id: AgentPromptId): AgentPromptRef => ({ id, version: AGENT_PROMPTS[id].version });

/**
 * Huella corta de un texto: FNV-1a de 32 bits en hexadecimal.
 *
 * No es criptográfica ni lo pretende: distingue dos versiones de una plantilla
 * y dos prompts renderizados, sin dependencias y sin `crypto`, que en el
 * navegador es asíncrono.
 */
export const fingerprintPrompt = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * El sello de una invocación: `office.review@v1#3f2a9c1e`.
 *
 * La versión dice qué plantilla; el hash, qué texto exacto llegó al modelo con
 * los datos de esa vez. Dos invocaciones con la misma versión y distinto hash
 * difieren en los datos, no en la plantilla.
 */
export const stampPrompt = (ref: AgentPromptRef, renderedText: string): string =>
  `${ref.id}@v${ref.version}#${fingerprintPrompt(renderedText)}`;

/** Lee un sello. `null` si no tiene la forma de uno. */
export const parsePromptStamp = (
  stamp: string,
): { id: string; version: number; hash: string } | null => {
  const match = /^([a-z.-]+)@v(\d+)#([0-9a-f]{8})$/.exec(stamp);
  return match ? { id: match[1], version: Number(match[2]), hash: match[3] } : null;
};
