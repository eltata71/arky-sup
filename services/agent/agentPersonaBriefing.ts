/**
 * El puerto por el que el agente recibe una persona especialista, sin saber que
 * la Oficina existe (F6-03, corte 3).
 *
 * Vivía dentro de `agentContextComposer.ts`, que importa la capa de IA. Como el
 * dominio de la Oficina implementa este puerto, nombrar el tipo arrastraba —en
 * la comprobación de tipos— al agente entero, la capa de IA y el motor de
 * generación. Un contrato sin comportamiento baja a una hoja: este fichero no
 * importa nada.
 */
/**
 * A specialist persona for one turn, supplied by whoever knows about
 * specialists.
 *
 * The agent used to import the Architecture Office to look a persona up by id,
 * while the office imported the agent's planner and executor to run one: two
 * modules that could not be read or tested apart. The dependency now points one
 * way — the office drives the agent — and this is the shape the agent asks for.
 * `buildOfficePersonaBriefing` in `services/architectureOffice` is the adapter
 * that produces one; nothing here knows an office exists.
 */
export interface AgentPersonaBriefing {
  /** Given the agent's own base instruction, returns the persona-adjusted one. */
  composeInstruction: (baseInstruction: string) => string;
  /** Extra prompt sections the persona brings — standards, glossaries, rules. */
  readonly sections: readonly string[];
}
