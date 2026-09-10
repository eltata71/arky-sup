/**
 * Every field the assistant may help fill in, and the rules it must respect
 * for each one.
 *
 * This is a catalogue rather than prompt strings scattered through six screens,
 * and that is the whole point: `InitiativeIntakeWizard` and `InitiativeRoom`
 * ask for the same driver, in creation and in maintenance, and they must ask
 * for it in the same words. When the two drifted the user got one answer while
 * creating and a differently-shaped one while editing, from the same assistant.
 *
 * The `constraints` are not tone-of-voice notes. They are the rules of the
 * discipline — an objective that names a technology has silently moved a
 * decision from the business layer to the architecture layer, and the whole
 * `Iniciativa → Proyecto → Entregable` vocabulary exists to keep those apart.
 */

import type { CaptureFieldId, CaptureFieldSpec, CaptureLevel } from './captureContracts';

const field = (spec: CaptureFieldSpec): CaptureFieldSpec => Object.freeze({
  ...spec,
  constraints: Object.freeze([...spec.constraints]) as string[],
});

/** Rules every suggestion obeys, whatever the field. */
export const CAPTURE_GLOBAL_RULES: readonly string[] = Object.freeze([
  'No inventes hechos: si algo no se deduce del contexto recibido, va en "openQuestions", no en una sugerencia.',
  'No reescribas lo que la persona ya escribió salvo que te lo pida explícitamente en "current".',
  'Escribe en español, en el registro del negocio, sin adornos ni preámbulos.',
]);

export const CAPTURE_FIELDS: Readonly<Record<CaptureFieldId, CaptureFieldSpec>> = Object.freeze({
  // -------------------------------------------------------------- iniciativa
  'initiative.title': field({
    id: 'initiative.title',
    level: 'initiative',
    label: 'Título de la iniciativa',
    question: '¿Cómo se llama esta iniciativa de negocio?',
    shape: 'text',
    guidance: 'Un título corto y específico que nombre el cambio de negocio, no el proyecto que lo construye.',
    constraints: [
      'Máximo doce palabras.',
      'Sin nombres de tecnologías, productos ni proveedores.',
    ],
    maxSuggestions: 1,
  }),
  'initiative.need': field({
    id: 'initiative.need',
    level: 'initiative',
    label: 'Necesidad del negocio',
    question: '¿Qué necesita el negocio?',
    shape: 'text',
    guidance: 'Un párrafo con las palabras del negocio: qué duele hoy, a quién y desde cuándo.',
    constraints: [
      'Describe la necesidad, nunca la solución.',
      'Si el texto actual ya la describe, propón sólo lo que falta y dilo en la justificación.',
    ],
    maxSuggestions: 1,
  }),
  'initiative.driver': field({
    id: 'initiative.driver',
    level: 'initiative',
    label: 'Driver / motivación',
    question: '¿Qué presión de negocio origina esta necesidad?',
    shape: 'text',
    guidance: 'Una o dos frases con la presión que origina la necesidad: regulación, competencia, coste, riesgo o crecimiento.',
    constraints: [
      'El driver es la causa, no el objetivo ni el resultado.',
      'No cites marcos regulatorios que el contexto no mencione.',
    ],
    maxSuggestions: 1,
  }),
  'initiative.objectives': field({
    id: 'initiative.objectives',
    level: 'initiative',
    label: 'Objetivos',
    question: '¿Qué se quiere lograr?',
    shape: 'list',
    guidance: 'Objetivos verificables, cada uno en una frase que empiece por un verbo.',
    constraints: [
      'Un objetivo dice QUÉ se quiere lograr, nunca CÓMO construirlo.',
      'Sin tecnologías, componentes ni decisiones de arquitectura.',
    ],
    maxSuggestions: 5,
  }),
  'initiative.outcomes': field({
    id: 'initiative.outcomes',
    level: 'initiative',
    label: 'Resultados esperados',
    question: '¿Qué resultado espera el negocio y cómo se evidenciará?',
    shape: 'list',
    guidance: 'Resultados observables. Cada uno en una frase; si sabes cómo se evidencia, añádelo tras un guion.',
    constraints: [
      'Un resultado es un cambio en el negocio, no una entrega de un equipo.',
    ],
    maxSuggestions: 5,
  }),
  'initiative.kpis': field({
    id: 'initiative.kpis',
    level: 'initiative',
    label: 'Indicadores',
    question: '¿Con qué indicadores se medirá?',
    shape: 'list',
    guidance: 'Nombre del indicador seguido de su unidad entre paréntesis. Ejemplo: «Tiempo de ciclo de siniestro (horas)».',
    constraints: [
      'Un indicador sin unidad no sirve: si no puedes inferir la unidad, no lo propongas.',
      'No inventes líneas base ni metas numéricas.',
    ],
    maxSuggestions: 5,
  }),
  'initiative.risks': field({
    id: 'initiative.risks',
    level: 'initiative',
    label: 'Riesgos',
    question: '¿Qué puede impedir que esta iniciativa consiga su resultado?',
    shape: 'list',
    guidance: 'Riesgos concretos para ESTA iniciativa, cada uno en una frase que diga qué pasaría y a qué afectaría.',
    constraints: [
      'Nada de riesgos genéricos de proyecto («falta de presupuesto», «resistencia al cambio») salvo que el contexto los sustente.',
    ],
    maxSuggestions: 5,
  }),
  'initiative.milestones': field({
    id: 'initiative.milestones',
    level: 'initiative',
    label: 'Hitos',
    question: '¿Qué hitos marcan el avance?',
    shape: 'list',
    guidance: 'Hitos verificables por su resultado, no por su actividad. Cada uno en una frase.',
    constraints: [
      'No propongas fechas: las decide quien planifica, no el asistente.',
    ],
    maxSuggestions: 5,
  }),
  'initiative.stakeholders': field({
    id: 'initiative.stakeholders',
    level: 'initiative',
    label: 'Personas implicadas',
    question: '¿Qué roles hay que involucrar?',
    shape: 'list',
    guidance: 'Roles organizativos afectados o necesarios, no nombres propios.',
    constraints: [
      'Nunca inventes nombres de personas: propón el rol.',
    ],
    maxSuggestions: 5,
  }),

  // ---------------------------------------------------------------- atención
  'attention.name': field({
    id: 'attention.name',
    level: 'attention',
    label: 'Nombre del proyecto de arquitectura',
    question: '¿Cómo se llama la respuesta de arquitectura a esta iniciativa?',
    shape: 'text',
    guidance: 'Un nombre corto que diga qué se está diseñando, ligado a la iniciativa que atiende.',
    constraints: [
      'Máximo doce palabras.',
      'No repitas literalmente el título de la iniciativa: este nivel es la respuesta, no la necesidad.',
    ],
    maxSuggestions: 1,
  }),
  'attention.description': field({
    id: 'attention.description',
    level: 'attention',
    label: 'Descripción',
    question: '¿Qué alcance tiene este proyecto de arquitectura?',
    shape: 'text',
    guidance: 'Dos o tres frases: qué se va a diseñar, para qué iniciativa y qué queda fuera.',
    constraints: [
      'Alcance, no plan de trabajo.',
    ],
    maxSuggestions: 1,
  }),
  'attention.context': field({
    id: 'attention.context',
    level: 'attention',
    label: 'Contexto del proyecto',
    question: '¿Qué debe saber el equipo antes de diseñar?',
    shape: 'list',
    guidance: 'Hechos del entorno que condicionan el diseño: sistemas existentes, restricciones, integraciones, cumplimiento.',
    constraints: [
      'Cada línea es un hecho verificable, no una recomendación.',
      'Si un hecho no está en el contexto recibido, pregúntalo en vez de afirmarlo.',
    ],
    maxSuggestions: 6,
  }),

  // -------------------------------------------------------------- entregable
  'deliverable.title': field({
    id: 'deliverable.title',
    level: 'deliverable',
    label: 'Título del entregable',
    question: '¿Qué entregable se solicita?',
    shape: 'text',
    guidance: 'Un título que nombre el producto de trabajo solicitado y su alcance.',
    constraints: [
      'Máximo doce palabras.',
    ],
    maxSuggestions: 1,
  }),
  'deliverable.brief': field({
    id: 'deliverable.brief',
    level: 'deliverable',
    label: 'Brief',
    question: '¿Qué hay que producir, para quién y con qué criterio de aceptación?',
    shape: 'text',
    guidance: 'Un párrafo: qué se pide, quién lo consume, qué decisiones debe permitir tomar y cuándo estaría aceptado.',
    constraints: [
      'El brief encarga trabajo; no lo ejecuta. No propongas ya la solución técnica.',
    ],
    maxSuggestions: 1,
  }),
});

const ALL_FIELDS: readonly CaptureFieldSpec[] = Object.freeze(Object.values(CAPTURE_FIELDS));

export const captureField = (id: CaptureFieldId): CaptureFieldSpec => CAPTURE_FIELDS[id];

/** The fields the whole-form button offers at a given level, in form order. */
export const captureFieldsForLevel = (level: CaptureLevel): CaptureFieldSpec[] =>
  ALL_FIELDS.filter((spec) => spec.level === level);
