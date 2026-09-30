/**
 * What each catalogue document must contain, by its discipline — one source
 * for the prompt that writes it and the contract that checks it (plan de
 * calidad de artefactos, 7.4a).
 *
 * Eighteen catalogue documents — an ADR, a DRP, an SRS, a runbook, a security
 * control matrix… — were checked by one generic contract (objective, context,
 * scope, assumptions, risks), so an ADR with no decision and a DRP with no
 * RTO passed. And the prompt told the model to «respect the per-template
 * structure declared above» while no structure was declared for any of them.
 *
 * Each discipline declares its sections — with the words that detect them and
 * what each must say — and a few **content rules** a section title cannot
 * prove (a recovery objective with a number and a unit; an ADR status from
 * its lifecycle). The compiler turns them into the template's contract; the
 * prompt prints them as the structure to follow. They cannot drift, because
 * there is one list.
 *
 * Data with no behaviour, in a leaf: `services/artifactCompiler` and
 * `services/ai` both read it.
 */

export interface DisciplineSection {
  id: string;
  /** How the section is titled — also what the prompt asks for. */
  label: string;
  /** Normalised words that detect the section in a heading or a bold label. */
  keywords: readonly string[];
  /** What the section must say, in one line. */
  guidance: string;
  requirement: 'required' | 'recommended';
}

export interface DisciplineRule {
  id: string;
  /** What the rule asks for, as the prompt states it. */
  label: string;
  /** Satisfied when the document matches. */
  pattern: RegExp;
  /** Told when it does not — names what is missing. */
  message: string;
  recommendation: string;
  severity: 'high' | 'medium';
}

export interface DocumentDiscipline {
  /** The catalogue template it governs, by exact name. */
  templateName: string;
  label: string;
  /** The reference the structure follows, when there is one. */
  standard?: string;
  sections: readonly DisciplineSection[];
  rules: readonly DisciplineRule[];
}

const required = (id: string, label: string, keywords: string[], guidance: string): DisciplineSection =>
  ({ id, label, keywords, guidance, requirement: 'required' });
const recommended = (id: string, label: string, keywords: string[], guidance: string): DisciplineSection =>
  ({ id, label, keywords, guidance, requirement: 'recommended' });

const ADR_SECTIONS: readonly DisciplineSection[] = [
  required('status', 'Estado', ['estado', 'status'], 'Propuesta, Aceptada, Rechazada, Obsoleta o Sustituida (por qué ADR).'),
  required('context', 'Contexto', ['contexto', 'context', 'problema'], 'El problema, las fuerzas en juego y las restricciones que obligan a decidir.'),
  required('decision', 'Decisión', ['decision'], 'Lo que se decide, en voz activa y sin ambigüedad.'),
  required('alternatives', 'Alternativas consideradas', ['alternativas', 'opciones', 'options considered'], 'Cada opción con sus ventajas, inconvenientes y por qué se descartó.'),
  required('consequences', 'Consecuencias', ['consecuencias', 'consequences', 'implicaciones'], 'Lo que la decisión hace más fácil y más difícil, positivo y negativo.'),
];

const ADR_STATUS_RULE: DisciplineRule = {
  id: 'adr-status-value',
  label: 'El estado es uno del ciclo de vida del ADR',
  pattern: /\b(propuest[oa]|aceptad[oa]|rechazad[oa]|obsolet[oa]|sustituid[oa]|deprecad[oa]|proposed|accepted|rejected|superseded|deprecated)\b/i,
  message: 'El ADR no declara un estado de su ciclo de vida.',
  recommendation: 'Indica si está Propuesta, Aceptada, Rechazada, Obsoleta o Sustituida.',
  severity: 'medium',
};

export const DOCUMENT_DISCIPLINES: readonly DocumentDiscipline[] = [
  {
    templateName: 'Registro de Decisiones Arquitectónicas (ADR)',
    label: 'Registro de Decisión Arquitectónica',
    standard: 'formato de Michael Nygard',
    sections: ADR_SECTIONS,
    rules: [ADR_STATUS_RULE],
  },
  {
    templateName: 'Catálogo de Decisiones (ADR)',
    label: 'Catálogo de decisiones arquitectónicas',
    standard: 'un registro por decisión, formato de Michael Nygard',
    sections: [
      required('index', 'Índice de decisiones', ['indice', 'catalogo', 'decisiones'], 'Tabla con ID, título, estado y fecha de cada decisión.'),
      ...ADR_SECTIONS.slice(1),
    ],
    rules: [ADR_STATUS_RULE],
  },
  {
    templateName: 'Plan de Recuperación ante Desastres (DRP)',
    label: 'Plan de Recuperación ante Desastres',
    standard: 'ISO 22301',
    sections: [
      required('scope', 'Alcance', ['alcance', 'scope'], 'Qué sistemas y procesos cubre y cuáles no.'),
      required('objectives', 'Objetivos de recuperación (RTO/RPO)', ['rto', 'rpo', 'objetivos de recuperacion'], 'RTO y RPO por sistema, con cifra y unidad.'),
      required('scenarios', 'Escenarios de desastre', ['escenarios', 'scenarios', 'amenazas'], 'Cada escenario con probabilidad, impacto y estrategia.'),
      required('procedure', 'Procedimiento de recuperación', ['procedimiento', 'conmutacion', 'failover', 'recuperacion'], 'Pasos numerados, quién los ejecuta y cómo se verifica cada uno.'),
      required('tests', 'Pruebas del plan', ['pruebas', 'ensayos', 'simulacros', 'testing'], 'Frecuencia de los ensayos y cómo se registran los resultados.'),
      required('owners', 'Responsables', ['responsables', 'roles', 'owners'], 'Quién declara el desastre, quién ejecuta y quién comunica.'),
    ],
    rules: [{
      id: 'drp-rto-rpo-values',
      label: 'RTO y RPO con cifra y unidad',
      pattern: /\bRTO\b[\s\S]{0,120}?\d+\s*(min|minutos?|h|horas?|s|segundos?|d[ií]as?)\b[\s\S]*\bRPO\b[\s\S]{0,120}?\d+\s*(min|minutos?|h|horas?|s|segundos?|d[ií]as?)\b|\bRPO\b[\s\S]{0,120}?\d+\s*(min|minutos?|h|horas?|s|segundos?|d[ií]as?)\b[\s\S]*\bRTO\b[\s\S]{0,120}?\d+\s*(min|minutos?|h|horas?|s|segundos?|d[ií]as?)\b/i,
      message: 'El plan no declara el RTO y el RPO con cifra y unidad.',
      recommendation: 'Fija el RTO (tiempo máximo de recuperación) y el RPO (pérdida máxima de datos) por sistema, p. ej. «RTO 4 horas · RPO 15 minutos».',
      severity: 'high',
    }],
  },
  {
    templateName: 'Especificación de Requerimientos (SRS)',
    label: 'Especificación de Requerimientos de Software',
    standard: 'IEEE 830 / ISO 29148',
    sections: [
      required('purpose', 'Propósito', ['proposito', 'purpose', 'objetivo'], 'Qué especifica el documento y para quién.'),
      required('scope', 'Alcance', ['alcance', 'scope'], 'Qué entra y qué queda fuera.'),
      required('functional', 'Requisitos funcionales', ['requisitos funcionales', 'requerimientos funcionales', 'functional requirements'], 'Tabla con ID, requisito, criterio de aceptación y prioridad.'),
      required('nonFunctional', 'Requisitos no funcionales', ['no funcionales', 'non-functional', 'nfr', 'atributos de calidad'], 'Rendimiento, disponibilidad, seguridad y cumplimiento, cada uno medible.'),
      recommended('rules', 'Reglas de negocio', ['reglas de negocio', 'business rules'], 'Las reglas que el sistema debe hacer cumplir.'),
      recommended('assumptions', 'Supuestos y dependencias', ['supuestos', 'dependencias', 'assumptions'], 'Lo que se da por cierto y de qué depende.'),
    ],
    rules: [],
  },
  {
    templateName: 'Manual de Operaciones / Runbook',
    label: 'Runbook operativo',
    sections: [
      required('purpose', 'Propósito', ['proposito', 'purpose', 'objetivo'], 'Qué servicio opera y para qué incidentes.'),
      required('alerts', 'Indicadores y alertas', ['indicadores', 'alertas', 'alerts', 'monitorizacion', 'monitoreo'], 'Cada alerta con umbral y severidad.'),
      required('procedures', 'Procedimientos', ['procedimientos', 'procedures', 'playbook'], 'Pasos numerados por incidente, ejecutables por quien esté de guardia.'),
      required('escalation', 'Escalamiento', ['escalamiento', 'escalado', 'escalation', 'contactos'], 'A quién se escala, cuándo y por qué canal.'),
      required('verification', 'Verificación', ['verificacion', 'verification', 'validacion'], 'Cómo se comprueba que el servicio volvió a la normalidad.'),
    ],
    rules: [],
  },
  {
    templateName: 'Matriz de Controles de Seguridad',
    label: 'Matriz de controles de seguridad',
    standard: 'ISO 27001 Anexo A',
    sections: [
      required('objective', 'Objetivo', ['objetivo', 'objective', 'proposito'], 'Qué flujo o sistema protegen los controles.'),
      required('controls', 'Controles', ['controles', 'controls', 'matriz'], 'Tabla con ID, control, riesgo que mitiga, tipo, frecuencia, responsable y evidencia.'),
      required('owners', 'Responsables de los controles', ['responsable', 'responsables', 'dueno', 'owner'], 'Cada control con su dueño, persona o rol.'),
      required('evidence', 'Evidencia', ['evidencia', 'evidence'], 'Qué prueba que cada control opera y dónde se conserva.'),
      recommended('gaps', 'Brechas y plan', ['brechas', 'gaps', 'plan de remediacion'], 'Lo que aún no está cubierto y cómo se cubrirá.'),
    ],
    rules: [],
  },
  {
    templateName: 'Visión de la Arquitectura',
    label: 'Visión de la arquitectura',
    standard: 'TOGAF ADM, fase A',
    sections: [
      required('summary', 'Resumen ejecutivo', ['resumen', 'executive summary'], 'El problema de negocio y la arquitectura objetivo en pocas líneas.'),
      required('drivers', 'Impulsores de negocio', ['impulsores', 'drivers', 'motivacion', 'objetivos de negocio'], 'Por qué ahora, ligado a las iniciativas.'),
      required('target', 'Arquitectura objetivo', ['arquitectura objetivo', 'target', 'vision'], 'El estado futuro y sus capacidades clave.'),
      required('scope', 'Alcance', ['alcance', 'scope'], 'Qué dominios y sistemas entran.'),
      recommended('stakeholders', 'Stakeholders', ['stakeholders', 'interesados'], 'Quién decide y quién se ve afectado.'),
      recommended('risks', 'Riesgos', ['riesgos', 'risks'], 'Riesgos principales con su mitigación.'),
    ],
    rules: [],
  },
  {
    templateName: 'Principios de Arquitectura',
    label: 'Principios de arquitectura',
    standard: 'TOGAF (enunciado, fundamento, implicaciones)',
    sections: [
      required('principles', 'Principios', ['principios', 'principles'], 'Cada principio con enunciado, fundamento e implicaciones.'),
      required('rationale', 'Fundamento', ['fundamento', 'rationale', 'justificacion'], 'Por qué el principio sirve al negocio.'),
      required('implications', 'Implicaciones', ['implicaciones', 'implications', 'consecuencias'], 'Qué obliga a hacer y qué impide.'),
    ],
    rules: [],
  },
  {
    templateName: 'Análisis de Stakeholders',
    label: 'Análisis de stakeholders',
    sections: [
      required('map', 'Mapa de stakeholders', ['mapa', 'stakeholders', 'interesados'], 'Tabla con stakeholder, interés, influencia y postura.'),
      required('concerns', 'Preocupaciones', ['preocupaciones', 'concerns', 'intereses'], 'Lo que cada uno necesita que la arquitectura resuelva.'),
      required('engagement', 'Estrategia de involucramiento', ['estrategia', 'engagement', 'comunicacion', 'involucramiento'], 'Cómo y con qué frecuencia se involucra a cada uno.'),
    ],
    rules: [],
  },
  {
    templateName: 'Diccionario de Datos',
    label: 'Diccionario de datos',
    sections: [
      required('entities', 'Entidades', ['entidades', 'entities', 'tablas'], 'Cada entidad con su propósito y su dueño.'),
      required('attributes', 'Atributos', ['atributos', 'campos', 'attributes', 'fields'], 'Tabla con atributo, tipo, obligatoriedad y descripción.'),
      required('classification', 'Clasificación de datos', ['clasificacion', 'classification', 'pii', 'phi', 'sensibilidad'], 'PII, PHI, PCI o público por atributo.'),
      recommended('rules', 'Reglas de validación', ['reglas', 'validacion', 'validation'], 'Formatos, rangos y dominios válidos.'),
    ],
    rules: [],
  },
  {
    templateName: 'Estrategia de Migración de Datos',
    label: 'Estrategia de migración de datos',
    sections: [
      required('scope', 'Alcance', ['alcance', 'scope'], 'Qué datos se migran, desde dónde y hacia dónde.'),
      required('approach', 'Estrategia', ['estrategia', 'approach', 'enfoque'], 'Big bang, por fases o en paralelo, y por qué.'),
      required('mapping', 'Mapeo y transformación', ['mapeo', 'mapping', 'transformacion'], 'Correspondencia origen → destino y reglas de transformación.'),
      required('validation', 'Validación y reconciliación', ['validacion', 'reconciliacion', 'validation', 'reconciliation'], 'Cómo se comprueba que no se perdió ni alteró nada.'),
      required('rollback', 'Plan de reversión', ['reversion', 'rollback', 'marcha atras'], 'Cómo se vuelve atrás si la migración falla.'),
    ],
    rules: [],
  },
  {
    templateName: 'Modelo de Costos de Infraestructura',
    label: 'Modelo de costos de infraestructura',
    sections: [
      required('assumptions', 'Supuestos', ['supuestos', 'assumptions', 'premisas'], 'Volúmenes, precios y tipo de cambio de los que depende el cálculo.'),
      required('breakdown', 'Desglose de costos', ['desglose', 'costos', 'costes', 'breakdown'], 'Tabla por componente con costo mensual y anual.'),
      recommended('scenarios', 'Escenarios', ['escenarios', 'scenarios', 'sensibilidad'], 'Costo en escenario bajo, esperado y alto.'),
      recommended('optimization', 'Optimización', ['optimizacion', 'optimization', 'ahorro'], 'Palancas de ahorro y su impacto.'),
    ],
    rules: [{
      id: 'cost-figures',
      label: 'Cifras con moneda',
      pattern: /(USD|EUR|MXN|COP|CLP|PEN|US\$|\$|€)\s?\d|\d[\d.,]*\s?(USD|EUR|MXN|COP|CLP|PEN|€)/,
      message: 'El modelo de costos no trae cifras con su moneda.',
      recommendation: 'Expresa cada costo con cifra y moneda, p. ej. «1 200 USD/mes».',
      severity: 'high',
    }],
  },
  {
    templateName: 'Casos de Prueba',
    label: 'Casos de prueba',
    sections: [
      required('cases', 'Casos', ['casos', 'test cases', 'escenarios'], 'Tabla con ID, requisito que verifica, precondiciones, pasos y resultado esperado.'),
      required('expected', 'Resultado esperado', ['resultado esperado', 'expected result', 'resultados esperados'], 'Lo que debe ocurrir, verificable.'),
      recommended('traceability', 'Trazabilidad', ['trazabilidad', 'traceability', 'requisito'], 'Cada caso ligado al requisito que prueba.'),
    ],
    rules: [],
  },
  {
    templateName: 'README del Proyecto',
    label: 'README del proyecto',
    sections: [
      required('description', 'Descripción', ['descripcion', 'description', 'acerca'], 'Qué es y para qué sirve.'),
      required('setup', 'Instalación', ['instalacion', 'installation', 'setup', 'configuracion'], 'Pasos para ponerlo en marcha.'),
      required('usage', 'Uso', ['uso', 'usage', 'ejecucion'], 'Cómo se usa, con un ejemplo.'),
      recommended('architecture', 'Arquitectura', ['arquitectura', 'architecture', 'estructura'], 'Los componentes y cómo se relacionan.'),
    ],
    rules: [],
  },
  {
    templateName: 'Informe de Revisión de Arquitectura',
    label: 'Informe de revisión de arquitectura',
    sections: [
      required('scope', 'Alcance de la revisión', ['alcance', 'scope'], 'Qué se revisó y con qué criterios.'),
      required('findings', 'Hallazgos', ['hallazgos', 'findings', 'observaciones'], 'Tabla con hallazgo, severidad y evidencia.'),
      required('recommendations', 'Recomendaciones', ['recomendaciones', 'recommendations', 'acciones'], 'Qué hacer con cada hallazgo, con responsable.'),
      required('verdict', 'Dictamen', ['dictamen', 'veredicto', 'conclusion', 'verdict'], 'Aprobado, aprobado con condiciones o rechazado.'),
    ],
    rules: [],
  },
  {
    templateName: 'Matriz de Tácticas de Arquitectura',
    label: 'Matriz de tácticas de arquitectura',
    standard: 'SEI, tácticas por atributo de calidad',
    sections: [
      required('attributes', 'Atributos de calidad', ['atributos de calidad', 'quality attributes', 'atributos'], 'Los atributos que importan y su escenario.'),
      required('tactics', 'Tácticas', ['tacticas', 'tactics'], 'Tabla con atributo, táctica, componente donde se aplica y efecto.'),
      recommended('tradeoffs', 'Compromisos', ['compromisos', 'tradeoffs', 'trade-offs'], 'Qué atributo cede cada táctica.'),
    ],
    rules: [],
  },
  {
    templateName: 'Análisis de Compromisos (Trade-offs)',
    label: 'Análisis de compromisos',
    standard: 'ATAM',
    sections: [
      required('options', 'Opciones', ['opciones', 'alternativas', 'options'], 'Las alternativas que se comparan.'),
      required('criteria', 'Criterios', ['criterios', 'criteria', 'atributos'], 'Los criterios y su peso.'),
      required('comparison', 'Comparación', ['comparacion', 'comparison', 'matriz'], 'Tabla de opciones contra criterios.'),
      required('recommendation', 'Recomendación', ['recomendacion', 'recommendation', 'decision'], 'La opción recomendada y lo que se sacrifica.'),
    ],
    rules: [],
  },
  {
    templateName: 'Definición de Fitness Functions',
    label: 'Fitness functions',
    standard: 'Building Evolutionary Architectures',
    sections: [
      required('functions', 'Fitness functions', ['fitness', 'funciones'], 'Tabla con atributo que protege, métrica, umbral y cómo se ejecuta.'),
      required('thresholds', 'Umbrales', ['umbrales', 'thresholds', 'limites'], 'El valor que hace fallar cada función.'),
      required('automation', 'Automatización', ['automatizacion', 'automation', 'pipeline', 'integracion continua'], 'Dónde corre cada función y con qué frecuencia.'),
    ],
    rules: [],
  },
];

const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const BY_NAME = new Map(DOCUMENT_DISCIPLINES.map((discipline) => [normalizeName(discipline.templateName), discipline]));

/** The discipline of a catalogue template, by its name; `undefined` when it has none. */
export const disciplineForTemplate = (templateName: string | undefined | null): DocumentDiscipline | undefined =>
  templateName ? BY_NAME.get(normalizeName(templateName)) : undefined;

/** The structure a model must follow, as one prompt block; `''` without a discipline. */
export function describeDisciplineForPrompt(templateName: string | undefined | null): string {
  const discipline = disciplineForTemplate(templateName);
  if (!discipline) return '';
  const sections = discipline.sections.map((section, index) =>
    `${index + 1}. ## ${section.label}${section.requirement === 'recommended' ? ' (recomendada)' : ''} — ${section.guidance}`);
  const rules = discipline.rules.map((rule) => `- ${rule.label}.`);
  return [
    `ESTRUCTURA OBLIGATORIA — ${discipline.label}${discipline.standard ? ` (${discipline.standard})` : ''}. Usa estos encabezados, en este orden; el contrato de la plantilla comprueba cada uno:`,
    ...sections,
    ...(rules.length ? ['Reglas de contenido:', ...rules] : []),
  ].join('\n');
}
