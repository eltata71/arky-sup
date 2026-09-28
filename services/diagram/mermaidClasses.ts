/**
 * Las clases de Mermaid leídas por su significado (plan de diagramas, 2.1).
 *
 * Quien escribe `A:::db` o `class A,B external` está diciendo qué es ese nodo,
 * y el parser lo tiraba: las líneas `class`/`classDef` se saltaban, y
 * `A:::db --> B` creaba un nodo cuyo id y etiqueta eran literalmente
 * `A:::db`. Aquí el **nombre** de la clase se traduce a un rol semántico.
 *
 * Tres decisiones:
 *
 * 1. **El nombre, no el estilo.** `classDef db fill:#f96` aporta un nombre; el
 *    color lo decide el sistema de diseño, como en todo el pipeline (ADR-006).
 * 2. **Conservador.** Sólo se reconocen nombres de un vocabulario escrito
 *    aquí; lo demás se informa como no reconocido y no se adivina.
 * 3. **Lo declarado gana a lo inferido, pero no a lo estructural.** El rol se
 *    guarda como `semanticRole`, que el resolvedor respeta por encima de la
 *    forma y de la etiqueta y por debajo de un tipo C4 o del diccionario de
 *    personas (`lib/semanticRoleResolver`).
 */

import type { SemanticRole } from '../../lib/semanticRoleResolver';

const CLASS_ROLES: ReadonlyArray<readonly [SemanticRole, readonly string[]]> = [
  ['data', ['db', 'database', 'datastore', 'data', 'store', 'storage', 'sql', 'nosql', 'cache', 'repo', 'repository', 'bd', 'basedatos', 'datos']],
  ['messaging', ['queue', 'cola', 'bus', 'event', 'events', 'evento', 'eventos', 'topic', 'kafka', 'stream', 'messaging', 'broker', 'mq']],
  ['external', ['ext', 'external', 'externo', 'externa', 'thirdparty', 'saas', 'partner', 'tercero']],
  ['person', ['person', 'persona', 'user', 'usuario', 'actor', 'customer', 'cliente']],
  ['gateway', ['gateway', 'gw', 'apigw', 'proxy', 'lb', 'loadbalancer']],
  ['service', ['service', 'svc', 'servicio', 'microservice', 'microservicio', 'api', 'backend']],
  ['system', ['system', 'sistema']],
  ['process', ['process', 'proceso', 'step', 'paso', 'task', 'tarea']],
];

const ROLE_BY_WORD = new Map<string, SemanticRole>(
  CLASS_ROLES.flatMap(([role, words]) => words.map((word) => [word, role] as const)),
);

/**
 * El rol que nombra una clase, o `null`. Se parte el nombre en palabras
 * (`externalDb`, `ext-db`, `ext_db` → `ext`, `db`) y gana la primera que se
 * reconozca: el autor pone delante lo que más importa.
 */
export function roleForClassName(name: string): SemanticRole | null {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // El nombre entero primero: `thirdParty` es una palabra del vocabulario, no dos.
  const whole = ROLE_BY_WORD.get(words.join(''));
  if (whole) return whole;
  for (const word of words) {
    const role = ROLE_BY_WORD.get(word);
    if (role) return role;
  }
  return null;
}

/** `A[Etiqueta]:::db` → el token sin la clase, y la clase. */
export function takeClassSuffix(token: string): { token: string; classes: string[] } {
  const match = token.match(/^(.*?):::([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)\s*$/);
  if (!match) return { token, classes: [] };
  return { token: match[1].trim(), classes: match[2].split(',').map((c) => c.trim()).filter(Boolean) };
}

/** `class A,B db` → a qué nodos se asigna qué clase. `null` si la línea no es eso. */
export function parseClassStatement(line: string): { nodeIds: string[]; classes: string[] } | null {
  const match = line.match(/^class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)\s*;?$/);
  if (!match) return null;
  return {
    nodeIds: match[1].split(',').map((id) => id.trim()).filter(Boolean),
    classes: match[2].split(',').map((c) => c.trim()).filter(Boolean),
  };
}

export function recordClasses(assignments: Map<string, string[]>, nodeId: string, classes: readonly string[]): void {
  if (classes.length === 0) return;
  assignments.set(nodeId, [...(assignments.get(nodeId) ?? []), ...classes]);
}

/**
 * Aplica a los nodos el rol que nombran sus clases. Devuelve los nombres que
 * no se reconocieron, para el diagnóstico: una clase que no se entendió se
 * dice, no se adivina.
 */
export function applyClassRoles(
  nodes: ReadonlyMap<string, { semanticRole?: string; kind: string }>,
  assignments: ReadonlyMap<string, readonly string[]>,
  kindForRole: (role: SemanticRole) => string,
): string[] {
  const unmapped = new Set<string>();
  for (const [nodeId, classes] of assignments) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    const role = classes.map(roleForClassName).find((r): r is SemanticRole => r !== null);
    if (role) {
      node.semanticRole = role;
      node.kind = kindForRole(role);
    }
    for (const cls of classes) if (!roleForClassName(cls)) unmapped.add(cls);
  }
  return [...unmapped].sort();
}
