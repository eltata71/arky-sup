/**
 * The canonical vocabulary of the platform, in the language of enterprise
 * architecture.
 *
 * The product used to call its three levels "proyecto de negocio", "proyecto
 * de arquitectura" and "encargo". Those are project-management words, and they
 * hid what the levels actually are in the discipline:
 *
 * ```
 * Iniciativa de Negocio          ← the business driver: a need, not a project.
 *   └─ Proyecto de Arquitectura  ← how architecture responds to that need.
 *        └─ Solicitud de Entregable
 *                                ← one governed piece of work with an owner,
 *                                  a reviewer and quality gates.
 *             └─ Artefacto       ← the documents and diagrams it produces.
 * ```
 *
 * Every screen reads its labels from here, so a level can never be called two
 * different things in two places — the drift that made the old UI hard to talk
 * about in a steering meeting.
 *
 * ## Why an initiative is not a project
 *
 * In the motivation layer of enterprise architecture, an initiative expresses a
 * *driver* and the *goals* and *outcomes* the business expects from it. It is
 * deliberately independent of how it gets built: one initiative may be served
 * by several architecture engagements, and it stays open while its outcomes are
 * still being measured, long after the engagements close. Modelling it as a
 * project would force an end date onto something whose whole purpose is to
 * carry the business rationale across the projects that serve it.
 *
 * ## A word this file deliberately reclaims
 *
 * "Entregable" now names the third level. Inside an engagement's charter the
 * word already meant something else — the artifacts to produce — so those are
 * called **artefactos** throughout the UI, which is literally what they are
 * (`templateName` + `artifactType`). Never reintroduce "entregable" for a
 * charter item: nested entregables inside an entregable is exactly the
 * ambiguity this module exists to prevent.
 */

/**
 * How the product names itself. One constant so a rename never has to be
 * chased through page titles, the rail tooltip and the HTML `<title>`.
 */
export const PRODUCT_NAME = 'Arky · Oficina de Arquitectura';

/** Short form for dense surfaces where the full name would wrap. */
export const PRODUCT_SHORT_NAME = 'Arky';

/** The levels of the hierarchy, outermost first. */
export type EaLevel = 'initiative' | 'engagementProject' | 'deliverable' | 'artifact';

/**
 * Every level carries two registers, and which one a surface uses is a rule,
 * not a preference:
 *
 * - **`singular`/`plural` — the long name.** Page titles, headers, empty
 *   states, any first mention. It says what the level *is*.
 * - **`short`/`shortPlural` — the short name.** The navigation rail, chips,
 *   breadcrumbs, dense table rows. Room is scarce there and the reader already
 *   has the context.
 *
 * A screen that puts the short name in its title makes the product feel
 * abbreviated; a rail that carries the long one wraps to three lines. Neither
 * is a matter of taste, so neither is left to the individual component.
 */
export interface EaLevelTerms {
  /** Full name, for page titles and first mentions. */
  singular: string;
  plural: string;
  /** Compact form for the rail, breadcrumbs, chips and dense rows. */
  short: string;
  shortPlural: string;
  /** One sentence explaining what this level *is*, for tooltips and empty states. */
  definition: string;
  /** The discipline term, shown where the EA vocabulary itself is the point. */
  disciplineNote: string;
}

export const EA_LEVELS: Readonly<Record<EaLevel, EaLevelTerms>> = Object.freeze({
  initiative: {
    singular: 'Iniciativa de Negocio',
    plural: 'Iniciativas de Negocio',
    short: 'Iniciativa',
    shortPlural: 'Iniciativas',
    definition: 'La necesidad del negocio que motiva el trabajo de arquitectura: su driver, sus objetivos y los resultados que espera.',
    disciplineNote: 'Capa de motivación: driver, objetivos y resultados esperados.',
  },
  engagementProject: {
    singular: 'Proyecto de Arquitectura',
    plural: 'Proyectos de Arquitectura',
    short: 'Proyecto',
    shortPlural: 'Proyectos',
    definition: 'La respuesta de la Oficina a una iniciativa: el espacio donde se diseña la arquitectura y se producen sus artefactos.',
    disciplineNote: 'Respuesta arquitectónica a un driver de negocio.',
  },
  deliverable: {
    singular: 'Solicitud de Entregable',
    plural: 'Solicitudes de Entregables',
    short: 'Entregable',
    shortPlural: 'Entregables',
    definition: 'Una pieza de trabajo gobernada: con responsable, revisor distinto, quality gates y decisión del comité.',
    disciplineNote: 'Unidad de trabajo gobernada de la Oficina.',
  },
  artifact: {
    singular: 'Artefacto',
    plural: 'Artefactos',
    short: 'Artefacto',
    shortPlural: 'Artefactos',
    definition: 'El documento o diagrama concreto que produce y revisa un entregable.',
    disciplineNote: 'Producto de trabajo arquitectónico.',
  },
});

/** Order of the hierarchy, outermost first. Drives breadcrumbs and explorers. */
export const EA_LEVEL_ORDER: readonly EaLevel[] = Object.freeze([
  'initiative',
  'engagementProject',
  'deliverable',
  'artifact',
]);

/**
 * `"3 Entregable"` reads wrong and `"3 Entregable(s)"` reads like a form.
 * Spanish plurals here are regular, so one helper covers every level.
 */
export const countOf = (level: EaLevel, count: number): string => {
  const terms = EA_LEVELS[level];
  return `${count} ${count === 1 ? terms.short.toLowerCase() : terms.shortPlural.toLowerCase()}`;
};

/**
 * El camino que recorre quien lee: `Iniciativa › Proyecto › Entregable`.
 *
 * El ejemplo decía «Atención», que es como el código llama al segundo nivel
 * (`components/attentions/`, `AttentionInitiativeGate`, `ProjectAttentionTracking`)
 * pero no lo que este fichero define ni lo que el usuario ve. Un ejemplo que
 * contradice a la constante de al lado es la forma más barata de que el
 * vocabulario se bifurque: alguien lo lee, lo cita y ya hay dos nombres.
 *
 * El nombre canónico es el de `EA_LEVELS.engagementProject`. Los identificadores
 * `Attention*` del código se quedan: `project.attention` es un campo guardado en
 * Firestore, así que renombrarlo sería una migración de datos y no un renombrado.
 */
export const EA_HIERARCHY_PATH = EA_LEVEL_ORDER
  .slice(0, 3)
  .map((level) => EA_LEVELS[level].short)
  .join(' › ');

/**
 * Business initiatives are referenced by code from the architecture projects
 * they justify (`Project.linkedBusinessProjects`). The code is the join key
 * and predates the initiative entity, so it is validated in one place.
 */
export const INITIATIVE_CODE_PATTERN = /^NEG-\d{4}-\d{3}$/;

/**
 * El código de una iniciativa, como objeto de valor.
 *
 * `NEG-YYYY-NNN` es lo que la gente cita en un comité de seguimiento, y hasta
 * la Ola 3 era un `string` cuyo formato se comprobaba en **dos** sitios con dos
 * expresiones regulares idénticas: aquí y en
 * `services/architectureOffice/officeShared.ts`. Dos definiciones del mismo
 * concepto es una que puede quedarse atrás.
 *
 * La marca no cambia nada en tiempo de ejecución —sigue siendo la misma
 * cadena— pero hace que el único modo de obtener una sea pasar por
 * `toInitiativeCode`, que normaliza antes de validar. Sin eso, `'neg-2026-001'`
 * y `' NEG-2026-001 '` son códigos distintos para el compilador y el mismo para
 * una persona, que es como un enlace se pierde en silencio.
 */
declare const initiativeCodeBrand: unique symbol;
export type BusinessInitiativeCode = string & { readonly [initiativeCodeBrand]: true };

export const isInitiativeCode = (value: unknown): value is BusinessInitiativeCode =>
  typeof value === 'string' && INITIATIVE_CODE_PATTERN.test(value);

/**
 * El único constructor. Normaliza —recorta y pasa a mayúsculas— y luego valida;
 * devuelve `null` para lo que no lo sea, en vez de lanzar, porque estas cadenas
 * llegan de documentos guardados por versiones anteriores y de lo que alguien
 * teclea en un formulario.
 */
export const toInitiativeCode = (value: unknown): BusinessInitiativeCode | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return isInitiativeCode(normalized) ? normalized : null;
};

/** `NEG-2026-007` for the seventh initiative opened in 2026. */
/**
 * Una lista de códigos, normalizada: sólo los válidos, sin repetir.
 *
 * Es el espejo derivado `Project.linkedBusinessProjects`. Vivía en
 * `services/architectureOffice/officeShared`, y `services/architectureProjects`
 * lo importaba de allí para leer sus propios documentos: una arista hacia la
 * Oficina que cerraba un ciclo en cuanto la Oficina nombraba `Project` desde su
 * dueño (F3-07). Sólo habla de códigos, así que su sitio es éste.
 */
export const toInitiativeCodes = (values: unknown): BusinessInitiativeCode[] => {
  if (!Array.isArray(values)) return [];
  const valid = values
    .map(toInitiativeCode)
    .filter((value): value is BusinessInitiativeCode => value !== null);
  return Array.from(new Set(valid));
};

export const formatInitiativeCode = (year: number, sequence: number): BusinessInitiativeCode =>
  `NEG-${String(year).padStart(4, '0')}-${String(sequence).padStart(3, '0')}` as BusinessInitiativeCode;

/**
 * Next free code for a year, given the codes already in use. Gaps are reused —
 * the code identifies an initiative, it does not count them.
 */
export const nextInitiativeCode = (existingCodes: readonly string[], year: number): BusinessInitiativeCode => {
  const prefix = `NEG-${String(year).padStart(4, '0')}-`;
  const taken = new Set(
    existingCodes
      .filter((code) => isInitiativeCode(code) && code.startsWith(prefix))
      .map((code) => Number(code.slice(prefix.length))),
  );
  let sequence = 1;
  while (taken.has(sequence)) sequence += 1;
  return formatInitiativeCode(year, sequence);
};
