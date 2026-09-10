/**
 * Lo que el tablero *sabe* del portafolio, decidido fuera de la pantalla.
 *
 * El tablero abre el producto y responde una pregunta antes que ninguna otra:
 * **¿en qué estado está todo?** Esa respuesta es una regla de dominio —qué
 * cuenta como deteriorado, qué franja es «tensionado», qué hace bajar la
 * cifra— y hasta ahora no existía en ninguna parte: la pantalla mostraba
 * cuatro contadores y dejaba la síntesis al lector.
 *
 * Escribirla en el JSX habría repetido el error que este repositorio ya pagó
 * con la salud de un proyecto: una regla dentro de un componente no se puede
 * comprobar sin renderizar un proveedor, y acaba copiada en la segunda pantalla
 * que la necesita. Aquí es una función pura sobre resúmenes ya calculados.
 *
 * ## Las cuatro reglas de honestidad, las mismas del resto del producto
 *
 * - **Sin medir no es cero.** Un portafolio vacío devuelve `health: null`, no
 *   0 %. Un 0 % pintado sobre una organización que aún no ha registrado nada
 *   informa de un equipo que ha fracasado.
 * - **La franja se calcula, nunca se elige.** No hay ningún campo donde alguien
 *   escriba «vamos bien»: sale de los deterioros contados.
 * - **La cifra viene con su composición.** `drags` enumera exactamente qué la
 *   bajó y cuánto, porque un indicador de salud sin desglose es una opinión con
 *   forma de medición — y ésta, además, mezcla tres niveles.
 * - **Lo roto se informa, nunca se descarta.** Los enlaces que no resuelven son
 *   una señal propia, no un elemento que se omite del recuento.
 *
 * ## Qué cuenta como deteriorado, y por qué
 *
 * La población son los **tres niveles gobernados** —iniciativas, proyectos y
 * entregables—; los artefactos son producto, no unidades de gobierno, y
 * contarlos haría que publicar mucho tapara un portafolio bloqueado.
 *
 * Está deteriorado lo que **no puede avanzar sin que alguien intervenga**:
 *
 * | Deterioro | Nivel | Por qué cuenta |
 * |---|---|---|
 * | Iniciativa en riesgo | Iniciativa | Su propio modelo ya lo derivó de hitos y riesgos |
 * | Proyecto sin iniciativa | Proyecto | Trabajo real sin razón declarada: nadie sabe qué mueve |
 * | Entregable bloqueado | Entregable | Un gate o una tarea impide continuar |
 * | Entregable esperando decisión | Entregable | Parado a la espera de una persona |
 *
 * La cuarta fila es la discutible y por eso está escrita: esperar una decisión
 * del comité es gobierno normal, no una avería. Cuenta igualmente porque este
 * tablero mide **flujo**, y un entregable congelado no entrega — pero al
 * aparecer en `drags` con su nombre, el lector ve que parte de la cifra es
 * gobierno en curso y no deuda.
 */

/**
 * Lo que el centro de mando necesita saber del nivel de iniciativas.
 *
 * Es un **puerto**: `services/businessInitiatives` lo satisface con su propio
 * `InitiativePortfolioRollup` sin que ninguno de los dos módulos importe al
 * otro. Es el patrón que ya usan `initiativeDelivery` y `AgentPersonaBriefing`,
 * y existe por lo mismo: la Oficina no debe pasar a depender del contexto de
 * iniciativas para poder sumar un número suyo.
 */
export interface InitiativeSignalPort {
  /** Cuántas iniciativas hay en total. */
  total: number;
  /** Cuántas su propio modelo marca como `at-risk`. */
  atRisk: number;
  /** Cuántas esperan una decisión. */
  awaitingDecision: number;
  /** Abiertas cuya fecha objetivo ya pasó. */
  overdue: number;
  /** Hitos comprometidos que se incumplieron. */
  milestonesMissed: number;
}

/** Lo que el centro de mando necesita saber del nivel de proyectos. */
export interface AttentionSignalPort {
  /** Cuántos proyectos de arquitectura hay. */
  total: number;
  /** Proyectos que no responden a ninguna iniciativa. */
  withoutInitiative: number;
  /** Referencias del grafo que no resuelven. */
  brokenLinks: number;
}

/** Lo que el centro de mando necesita saber del nivel de entregables. */
export interface DeliverableSignalPort {
  total: number;
  blocked: number;
  awaitingDecision: number;
  /** Tareas cuya fecha de compromiso ya pasó. */
  overdueTasks: number;
  /** Hallazgos críticos abiertos en las revisiones. */
  criticalFindings: number;
}

export type PortfolioHealthBand = 'strong' | 'steady' | 'strained' | 'critical';

/** Un deterioro concreto, con su cifra y el nivel del que viene. */
export interface PortfolioDrag {
  id: string;
  /** Etiqueta escrita. El color nunca lleva el significado solo. */
  label: string;
  count: number;
  level: 'initiative' | 'attention' | 'deliverable';
}

/** Una señal del centro de atención: qué está pasando y cuánto pesa. */
export interface PortfolioSignal {
  id: string;
  label: string;
  count: number;
  /** Qué es exactamente lo que se cuenta, en una frase. */
  hint: string;
  /** Gravedad, ya decidida aquí: la pantalla no vuelve a juzgarla. */
  severity: 'critical' | 'risk' | 'warning' | 'info';
  /** A dónde lleva resolverla, cuando hay un sitio al que ir. */
  destination?: 'initiatives' | 'projects' | 'office';
}

export interface PortfolioCommandCenter {
  /** 0..1, o `null` cuando no hay nada gobernado que medir. */
  health: number | null;
  /** La franja en palabras. `null` cuando la salud lo es. */
  band: PortfolioHealthBand | null;
  /** Elementos gobernados considerados: el denominador, dicho en voz alta. */
  governed: number;
  /** Cuántos de ellos están deteriorados. */
  impaired: number;
  /** Qué bajó la cifra, de mayor a menor. Vacío cuando nada la bajó. */
  drags: PortfolioDrag[];
  /** El centro de riesgo y atención, ordenado por gravedad y cantidad. */
  signals: PortfolioSignal[];
  /** Cuántas señales exigen a una persona ahora mismo (crítica o riesgo). */
  urgentSignals: number;
}

/** Las cuatro franjas. Los cortes están aquí y en ningún otro sitio. */
export const bandOf = (health: number): PortfolioHealthBand => {
  if (health >= 0.9) return 'strong';
  if (health >= 0.75) return 'steady';
  if (health >= 0.5) return 'strained';
  return 'critical';
};

/** El nombre en español de cada franja, para la pantalla y para el lector. */
export const PORTFOLIO_BAND_LABELS: Readonly<Record<PortfolioHealthBand, string>> = Object.freeze({
  strong: 'Saludable',
  steady: 'Estable',
  strained: 'Tensionado',
  critical: 'Crítico',
});

/**
 * Compone el centro de mando a partir de los tres resúmenes ya calculados.
 *
 * Pura y sin dependencias: recibe números, devuelve números y frases. Eso es lo
 * que permite comprobar la regla —«dos entregables bloqueados sobre diez
 * elementos son un 80 %»— sin montar un proveedor de React.
 */
export const buildPortfolioCommandCenter = (
  initiatives: InitiativeSignalPort,
  attentions: AttentionSignalPort,
  deliverables: DeliverableSignalPort,
): PortfolioCommandCenter => {
  const governed = initiatives.total + attentions.total + deliverables.total;

  const drags: PortfolioDrag[] = ([
    { id: 'initiatives-at-risk', label: 'Iniciativas en riesgo', count: initiatives.atRisk, level: 'initiative' },
    { id: 'attentions-orphan', label: 'Proyectos sin iniciativa', count: attentions.withoutInitiative, level: 'attention' },
    { id: 'deliverables-blocked', label: 'Entregables bloqueados', count: deliverables.blocked, level: 'deliverable' },
    { id: 'deliverables-awaiting', label: 'Entregables esperando decisión', count: deliverables.awaitingDecision, level: 'deliverable' },
  ] satisfies PortfolioDrag[])
    .filter((drag) => drag.count > 0)
    .sort((a, b) => b.count - a.count);

  const impaired = drags.reduce((total, drag) => total + drag.count, 0);

  // Sin nada gobernado no hay nada que medir, y decirlo es la respuesta
  // correcta. `Math.min` protege del caso en que un mismo entregable esté
  // contado por dos deterioros: la salud llega a cero, nunca a negativo.
  const health = governed === 0 ? null : Math.max(0, 1 - Math.min(1, impaired / governed));

  const signals: PortfolioSignal[] = ([
    {
      id: 'deliverables-blocked',
      label: 'Entregables bloqueados',
      count: deliverables.blocked,
      hint: 'Un gate o una tarea detenida impide continuar.',
      severity: 'critical',
      destination: 'office',
    },
    {
      id: 'critical-findings',
      label: 'Hallazgos críticos abiertos',
      count: deliverables.criticalFindings,
      hint: 'Revisiones que encontraron algo que no puede publicarse así.',
      severity: 'critical',
      destination: 'office',
    },
    {
      id: 'initiatives-at-risk',
      label: 'Iniciativas en riesgo',
      count: initiatives.atRisk,
      hint: 'Su propio seguimiento las marca en riesgo por hitos o riesgos severos.',
      severity: 'risk',
      destination: 'initiatives',
    },
    {
      id: 'initiatives-overdue',
      label: 'Iniciativas fuera de plazo',
      count: initiatives.overdue,
      hint: 'Siguen abiertas y su fecha objetivo ya pasó.',
      severity: 'risk',
      destination: 'initiatives',
    },
    {
      id: 'milestones-missed',
      label: 'Hitos incumplidos',
      count: initiatives.milestonesMissed,
      hint: 'Compromisos con el negocio que no se cumplieron en fecha.',
      severity: 'risk',
      destination: 'initiatives',
    },
    {
      id: 'overdue-tasks',
      label: 'Tareas fuera de plazo',
      count: deliverables.overdueTasks,
      hint: 'Tareas de la Oficina cuya fecha de compromiso ya pasó.',
      severity: 'warning',
      destination: 'office',
    },
    {
      id: 'attentions-orphan',
      label: 'Proyectos sin iniciativa',
      count: attentions.withoutInitiative,
      hint: 'Trabajo de arquitectura que no declara a qué necesidad responde.',
      severity: 'warning',
      destination: 'projects',
    },
    {
      id: 'broken-links',
      label: 'Vínculos rotos',
      count: attentions.brokenLinks,
      hint: 'Referencias entre niveles que ya no resuelven a ningún registro.',
      severity: 'warning',
      destination: 'projects',
    },
    {
      id: 'awaiting-decision',
      label: 'Esperando una decisión',
      count: deliverables.awaitingDecision + initiatives.awaitingDecision,
      hint: 'Parado hasta que una persona apruebe o decida.',
      severity: 'info',
      destination: 'office',
    },
  ] satisfies PortfolioSignal[]).filter((signal) => signal.count > 0);

  const SEVERITY_ORDER: Record<PortfolioSignal['severity'], number> = {
    critical: 0,
    risk: 1,
    warning: 2,
    info: 3,
  };
  signals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);

  return {
    health,
    band: health === null ? null : bandOf(health),
    governed,
    impaired,
    drags,
    signals,
    urgentSignals: signals.filter((signal) => signal.severity === 'critical' || signal.severity === 'risk').length,
  };
};

/**
 * La suma de una ventana de la serie de actividad, y la de la ventana anterior.
 *
 * Es lo que convierte un KPI en un KPI: «12 tareas» es un número, «12 tareas,
 * +5 frente a los 7 días anteriores» es una noticia. Las dos ventanas tienen
 * exactamente el mismo ancho — comparar siete días contra tres inventaría una
 * tendencia — y cuando la serie no da para dos ventanas completas devuelve
 * `previous: null`, porque no hay con qué comparar y fingir un cero diría que
 * la semana pasada no se hizo nada.
 */
export interface WindowedDelta {
  current: number;
  previous: number | null;
  /** `current - previous`, o `null` cuando no hay ventana anterior. */
  delta: number | null;
}

export const windowedDelta = (
  values: readonly number[],
  windowSize: number,
): WindowedDelta => {
  const span = Math.max(1, Math.floor(windowSize));
  const current = values.slice(-span).reduce((total, value) => total + value, 0);
  if (values.length < span * 2) return { current, previous: null, delta: null };
  const previous = values.slice(-span * 2, -span).reduce((total, value) => total + value, 0);
  return { current, previous, delta: current - previous };
};
