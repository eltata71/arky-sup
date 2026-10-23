import type { ToolExecution, ToolRegistry } from './registry';

export interface DeniedToolCall {
  name: string;
  /** Herramientas que este agente sí puede usar, para el mensaje al modelo. */
  allowed: readonly string[];
}

export interface GovernedTools {
  execute(name: string, input: unknown): Promise<ToolExecution>;
  /** Lo que se ofrece al modelo: sólo lo permitido. */
  definitions: ToolRegistry['definitions'];
  denied(): readonly DeniedToolCall[];
}

/**
 * Aplica la política de herramientas de un agente sobre un registro.
 *
 * Una llamada fuera de la lista no llega a la herramienta: se rechaza con un
 * error que dice qué sí puede usar, y queda registrada para la traza.
 */
export const governTools = (registry: ToolRegistry, allowedTools: readonly string[]): GovernedTools => {
  const allowed = new Set(allowedTools);
  const denied: DeniedToolCall[] = [];
  return {
    definitions: () => registry.definitions().filter((definition) => allowed.has(definition.name)),
    denied: () => denied,
    async execute(name, input) {
      if (!allowed.has(name)) {
        denied.push({ name, allowed: [...allowed] });
        return {
          name,
          ok: false,
          truncated: false,
          text: `«${name}» no está permitida para este agente. Herramientas permitidas: ${allowedTools.length > 0 ? allowedTools.join(', ') : 'ninguna'}.`,
        };
      }
      return registry.execute(name, input);
    },
  };
};
