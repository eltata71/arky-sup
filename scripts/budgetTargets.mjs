/**
 * F3-04 — Presupuestos decrecientes, con objetivo y fecha.
 *
 * Todos los presupuestos de este repositorio tienen la misma forma: el número
 * de hoy puede bajar y no puede subir. Es lo que para la hemorragia, y no dice
 * nada de cuándo se cura. Un presupuesto que sólo prohíbe empeorar se queda
 * donde lo dejó la última mejora —y ese sitio suele ser «bastante bien»—.
 *
 * Aquí cada número que importa tiene **un objetivo, una fecha y la fase que lo
 * cumple**. Antes de la fecha el gate informa del progreso; después, un objetivo
 * no cumplido falla. Las fechas son la propuesta de la fase 3 sobre el plan
 * maestro, no un compromiso tomado: moverlas es legítimo, pero se hace aquí, en
 * una PR que se revisa, con la razón al lado — nunca desactivando la
 * comprobación.
 *
 * Puro: recibe las medidas y la fecha, devuelve lo que decir. Los dos gates que
 * ya calculan esas medidas (`checkModuleBoundaries`, `countAnyTokens`) lo llaman.
 */

/** @typedef {{ id: string, label: string, target: number, due: string, phase: string }} BudgetTarget */

/** @type {readonly BudgetTarget[]} */
export const BUDGET_TARGETS = Object.freeze([
  {
    id: 'domain-scc-modules',
    label: 'módulos de dominio mutuamente alcanzables',
    target: 0,
    due: '2027-03-31',
    phase: 'F5-03 — eliminar las aristas internas del componente',
  },
  {
    id: 'cycles',
    label: 'ciclos directos registrados',
    // Los tres de la UI (`components ↔ context ↔ hooks`) son la forma
    // ordinaria de React y no son objetivo de nadie.
    target: 3,
    due: '2027-03-31',
    phase: 'F5-01 — romper services/ai -> services (raíz)',
  },
  {
    id: 'loose-root-files',
    label: 'ficheros sueltos en la raíz de services/',
    target: 0,
    due: '2027-03-31',
    phase: 'F5-01 — el motor de Gemini entra en su módulo',
  },
  {
    id: 'ui-fanout-screens',
    label: 'pantallas por encima del fan-out por defecto',
    target: 0,
    due: '2027-01-31',
    // F4-05 sacó las cuatro pantallas de artefactos (10 → 6). Las seis que
    // quedan son de la Oficina, las iniciativas y el asistente: sus políticas
    // van a su contexto propietario, que es F5-02. La fecha no se movió.
    phase: 'F5-02 — políticas de negocio a su contexto propietario (F4-05 hizo las de artefactos)',
  },
  {
    id: 'deep-import-pairs',
    label: 'pares con import profundo',
    target: 30,
    due: '2027-06-30',
    phase: 'F6-02 — dependencias no autorizadas a cero',
  },
  {
    id: 'any-tokens',
    label: 'tipos `any`',
    // Los 16 de `geminiService.ts` desaparecen con él; quedan el borde sin
    // tipos de Excalidraw y el `ComponentType<any>` de React.
    target: 7,
    due: '2027-06-30',
    phase: 'F5-01 y F6-01 — el motor estrangulado',
  },
]);

/**
 * Evalúa las medidas dadas contra sus objetivos.
 *
 * @param {Record<string, number>} measured — medida actual por `id`; los ids
 *   que no aparecen no se evalúan (cada gate mide los suyos).
 * @param {string} today — `YYYY-MM-DD`.
 * @param {readonly BudgetTarget[]} targets
 * @returns {{ failures: string[], notes: string[] }}
 */
export function evaluateBudgetTargets(measured, today, targets = BUDGET_TARGETS) {
  const failures = [];
  const notes = [];
  for (const entry of targets) {
    if (!(entry.id in measured)) continue;
    const value = measured[entry.id];
    if (value <= entry.target) {
      notes.push(`objetivo: ${entry.label} = ${value}, cumplido (≤ ${entry.target}).`);
    } else if (today > entry.due) {
      failures.push(
        `objetivo vencido: ${entry.label} = ${value}, objetivo ${entry.target} para ${entry.due} (${entry.phase}). `
        + 'Cúmplelo, o mueve la fecha en scripts/budgetTargets.mjs con la razón al lado.',
      );
    } else {
      notes.push(`objetivo: ${entry.label} = ${value} → ${entry.target} antes de ${entry.due} (${entry.phase}).`);
    }
  }
  return { failures, notes };
}

/** La fecha de hoy, en UTC, sin hora. `BUDGET_TODAY` la fija en pruebas. */
export const todayIso = () => process.env.BUDGET_TODAY ?? new Date().toISOString().slice(0, 10);
