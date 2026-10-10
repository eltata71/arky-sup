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
 * `services/ai` both read it. What each section must SAY — the guidance the
 * prompt prints — lives with the prompt, in
 * `services/ai/prompts/documentDisciplinePrompt.ts`: the compiler is on the
 * boot path and would carry the prose of eighteen disciplines into the eager
 * payload for a validation that never reads it (+4,8 KB gz, measured).
 */

export interface DisciplineSection {
  id: string;
  /** How the section is titled — also what the prompt asks for. */
  label: string;
  /** Normalised words that detect the section in a heading or a bold label. */
  keywords: readonly string[];
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

const required = (id: string, label: string, keywords: string[]): DisciplineSection =>
  ({ id, label, keywords, requirement: 'required' });
const recommended = (id: string, label: string, keywords: string[]): DisciplineSection =>
  ({ id, label, keywords, requirement: 'recommended' });

const ADR_SECTIONS: readonly DisciplineSection[] = [
  required('status', 'Estado', ['estado', 'status']),
  required('context', 'Contexto', ['contexto', 'context', 'problema']),
  required('decision', 'Decisión', ['decision']),
  required('alternatives', 'Alternativas consideradas', ['alternativas', 'opciones', 'options considered']),
  required('consequences', 'Consecuencias', ['consecuencias', 'consequences', 'implicaciones']),
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
    templateName: 'Plan de Recuperación ante Desastres (DRP)',
    label: 'Plan de Recuperación ante Desastres',
    standard: 'ISO 22301',
    sections: [
      required('scope', 'Alcance', ['alcance', 'scope']),
      required('objectives', 'Objetivos de recuperación (RTO/RPO)', ['rto', 'rpo', 'objetivos de recuperacion']),
      required('scenarios', 'Escenarios de desastre', ['escenarios', 'scenarios', 'amenazas']),
      required('procedure', 'Procedimiento de recuperación', ['procedimiento', 'conmutacion', 'failover', 'recuperacion']),
      required('tests', 'Pruebas del plan', ['pruebas', 'ensayos', 'simulacros', 'testing']),
      required('owners', 'Responsables', ['responsables', 'roles', 'owners']),
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
      required('purpose', 'Propósito', ['proposito', 'purpose', 'objetivo']),
      required('scope', 'Alcance', ['alcance', 'scope']),
      required('functional', 'Requisitos funcionales', ['requisitos funcionales', 'requerimientos funcionales', 'functional requirements']),
      required('nonFunctional', 'Requisitos no funcionales', ['no funcionales', 'non-functional', 'nfr', 'atributos de calidad']),
      recommended('rules', 'Reglas de negocio', ['reglas de negocio', 'business rules']),
      recommended('assumptions', 'Supuestos y dependencias', ['supuestos', 'dependencias', 'assumptions']),
    ],
    rules: [],
  },
  {
    templateName: 'Manual de Operaciones / Runbook',
    label: 'Runbook operativo',
    sections: [
      required('purpose', 'Propósito', ['proposito', 'purpose', 'objetivo']),
      required('alerts', 'Indicadores y alertas', ['indicadores', 'alertas', 'alerts', 'monitorizacion', 'monitoreo']),
      required('procedures', 'Procedimientos', ['procedimientos', 'procedures', 'playbook']),
      required('escalation', 'Escalamiento', ['escalamiento', 'escalado', 'escalation', 'contactos']),
      required('verification', 'Verificación', ['verificacion', 'verification', 'validacion']),
    ],
    rules: [],
  },
  {
    templateName: 'Matriz de Controles de Seguridad',
    label: 'Matriz de controles de seguridad',
    standard: 'ISO 27001 Anexo A',
    sections: [
      required('objective', 'Objetivo', ['objetivo', 'objective', 'proposito']),
      required('controls', 'Controles', ['controles', 'controls', 'matriz']),
      required('owners', 'Responsables de los controles', ['responsable', 'responsables', 'dueno', 'owner']),
      required('evidence', 'Evidencia', ['evidencia', 'evidence']),
      recommended('gaps', 'Brechas y plan', ['brechas', 'gaps', 'plan de remediacion']),
    ],
    rules: [],
  },
  {
    templateName: 'Visión de la Arquitectura',
    label: 'Visión de la arquitectura',
    standard: 'TOGAF ADM, fase A',
    sections: [
      required('summary', 'Resumen ejecutivo', ['resumen', 'executive summary']),
      required('drivers', 'Impulsores de negocio', ['impulsores', 'drivers', 'motivacion', 'objetivos de negocio']),
      required('target', 'Arquitectura objetivo', ['arquitectura objetivo', 'target', 'vision']),
      required('scope', 'Alcance', ['alcance', 'scope']),
      recommended('stakeholders', 'Stakeholders', ['stakeholders', 'interesados']),
      recommended('risks', 'Riesgos', ['riesgos', 'risks']),
    ],
    rules: [],
  },
  {
    templateName: 'Principios de Arquitectura',
    label: 'Principios de arquitectura',
    standard: 'TOGAF (enunciado, fundamento, implicaciones)',
    sections: [
      required('principles', 'Principios', ['principios', 'principles']),
      required('rationale', 'Fundamento', ['fundamento', 'rationale', 'justificacion']),
      required('implications', 'Implicaciones', ['implicaciones', 'implications', 'consecuencias']),
    ],
    rules: [],
  },
  {
    templateName: 'Análisis de Stakeholders',
    label: 'Análisis de stakeholders',
    sections: [
      required('map', 'Mapa de stakeholders', ['mapa', 'stakeholders', 'interesados']),
      required('concerns', 'Preocupaciones', ['preocupaciones', 'concerns', 'intereses']),
      required('engagement', 'Estrategia de involucramiento', ['estrategia', 'engagement', 'comunicacion', 'involucramiento']),
    ],
    rules: [],
  },
  {
    templateName: 'Diccionario de Datos',
    label: 'Diccionario de datos',
    sections: [
      required('entities', 'Entidades', ['entidades', 'entities', 'tablas']),
      required('attributes', 'Atributos', ['atributos', 'campos', 'attributes', 'fields']),
      required('classification', 'Clasificación de datos', ['clasificacion', 'classification', 'pii', 'phi', 'sensibilidad']),
      recommended('rules', 'Reglas de validación', ['reglas', 'validacion', 'validation']),
    ],
    rules: [],
  },
  {
    templateName: 'Estrategia de Migración de Datos',
    label: 'Estrategia de migración de datos',
    sections: [
      required('scope', 'Alcance', ['alcance', 'scope']),
      required('approach', 'Estrategia', ['estrategia', 'approach', 'enfoque']),
      required('mapping', 'Mapeo y transformación', ['mapeo', 'mapping', 'transformacion']),
      required('validation', 'Validación y reconciliación', ['validacion', 'reconciliacion', 'validation', 'reconciliation']),
      required('rollback', 'Plan de reversión', ['reversion', 'rollback', 'marcha atras']),
    ],
    rules: [],
  },
  {
    templateName: 'Modelo de Costos de Infraestructura',
    label: 'Modelo de costos de infraestructura',
    sections: [
      required('assumptions', 'Supuestos', ['supuestos', 'assumptions', 'premisas']),
      required('breakdown', 'Desglose de costos', ['desglose', 'costos', 'costes', 'breakdown']),
      recommended('scenarios', 'Escenarios', ['escenarios', 'scenarios', 'sensibilidad']),
      recommended('optimization', 'Optimización', ['optimizacion', 'optimization', 'ahorro']),
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
      required('cases', 'Casos', ['casos', 'test cases', 'escenarios']),
      required('expected', 'Resultado esperado', ['resultado esperado', 'expected result', 'resultados esperados']),
      recommended('traceability', 'Trazabilidad', ['trazabilidad', 'traceability', 'requisito']),
    ],
    rules: [],
  },
  {
    templateName: 'README del Proyecto',
    label: 'README del proyecto',
    sections: [
      required('description', 'Descripción', ['descripcion', 'description', 'acerca']),
      required('setup', 'Instalación', ['instalacion', 'installation', 'setup', 'configuracion']),
      required('usage', 'Uso', ['uso', 'usage', 'ejecucion']),
      recommended('architecture', 'Arquitectura', ['arquitectura', 'architecture', 'estructura']),
    ],
    rules: [],
  },
  {
    templateName: 'Informe de Revisión de Arquitectura',
    label: 'Informe de revisión de arquitectura',
    sections: [
      required('scope', 'Alcance de la revisión', ['alcance', 'scope']),
      required('findings', 'Hallazgos', ['hallazgos', 'findings', 'observaciones']),
      required('recommendations', 'Recomendaciones', ['recomendaciones', 'recommendations', 'acciones']),
      required('verdict', 'Dictamen', ['dictamen', 'veredicto', 'conclusion', 'verdict']),
    ],
    rules: [],
  },
  {
    templateName: 'Matriz de Tácticas de Arquitectura',
    label: 'Matriz de tácticas de arquitectura',
    standard: 'SEI, tácticas por atributo de calidad',
    sections: [
      required('attributes', 'Atributos de calidad', ['atributos de calidad', 'quality attributes', 'atributos']),
      required('tactics', 'Tácticas', ['tacticas', 'tactics']),
      recommended('tradeoffs', 'Compromisos', ['compromisos', 'tradeoffs', 'trade-offs']),
    ],
    rules: [],
  },
  {
    templateName: 'Análisis de Compromisos (Trade-offs)',
    label: 'Análisis de compromisos',
    standard: 'ATAM',
    sections: [
      required('options', 'Opciones', ['opciones', 'alternativas', 'options']),
      required('criteria', 'Criterios', ['criterios', 'criteria', 'atributos']),
      required('comparison', 'Comparación', ['comparacion', 'comparison', 'matriz']),
      required('recommendation', 'Recomendación', ['recomendacion', 'recommendation', 'decision']),
    ],
    rules: [],
  },
  {
    templateName: 'Definición de Fitness Functions',
    label: 'Fitness functions',
    standard: 'Building Evolutionary Architectures',
    sections: [
      required('functions', 'Fitness functions', ['fitness', 'funciones']),
      required('thresholds', 'Umbrales', ['umbrales', 'thresholds', 'limites']),
      required('automation', 'Automatización', ['automatizacion', 'automation', 'pipeline', 'integracion continua']),
    ],
    rules: [],
  },
  {
    templateName: 'Contrato de Arquitectura',
    label: 'Contrato de arquitectura',
    standard: 'TOGAF · Contrato de Arquitectura',
    sections: [
      required('parties', 'Partes', ['partes', 'parties', 'firmantes']),
      required('scope', 'Alcance', ['alcance', 'scope']),
      required('obligations', 'Obligaciones de arquitectura', ['obligaciones', 'obligations', 'compromisos']),
      required('criteria', 'Criterios de aceptación', ['criterios de aceptacion', 'aceptacion', 'acceptance']),
      required('compliance', 'Gobierno y cumplimiento', ['cumplimiento', 'gobierno', 'compliance', 'governance']),
      recommended('deviations', 'Desviaciones y excepciones', ['desviaciones', 'excepciones', 'dispensas']),
    ],
    rules: [{
      id: 'contract-acceptance-measurable',
      label: 'Cada criterio de aceptación es verificable (cifra, umbral o condición comprobable)',
      pattern: /(\d|\b(debe|deber[aá]|cumple|no (?:debe|puede)|m[aá]ximo|m[ií]nimo|exactamente)\b)/i,
      message: 'El contrato no declara criterios de aceptación verificables.',
      recommendation: 'Redacta cada criterio de modo que pueda comprobarse, p. ej. «Disponibilidad ≥ 99,9 %» o «Todo acceso debe autenticarse».',
      severity: 'medium',
    }],
  },
  {
    templateName: 'Evaluación de Cumplimiento',
    label: 'Evaluación de cumplimiento de arquitectura',
    standard: 'TOGAF · Revisión de cumplimiento',
    sections: [
      required('scope', 'Alcance y contrato evaluado', ['alcance', 'contrato', 'scope']),
      required('criteria', 'Criterios evaluados', ['criterios', 'criteria']),
      required('findings', 'Hallazgos', ['hallazgos', 'findings', 'resultados']),
      required('verdict', 'Veredicto de cumplimiento', ['veredicto', 'conclusion', 'verdict']),
      required('actions', 'Acciones correctivas', ['acciones', 'correctivas', 'plan de accion', 'remediation']),
    ],
    rules: [{
      id: 'compliance-verdict-value',
      label: 'El veredicto es uno de: conforme, conforme con condiciones o no conforme',
      pattern: /\b(no conforme|conforme con condiciones|conforme|cumple|no cumple|cumple parcialmente|compliant|non-compliant)\b/i,
      message: 'La evaluación no declara un veredicto de cumplimiento.',
      recommendation: 'Indica si la solución es Conforme, Conforme con condiciones o No conforme.',
      severity: 'high',
    }],
  },
];

const normalizeName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const BY_NAME = new Map(DOCUMENT_DISCIPLINES.map((discipline) => [normalizeName(discipline.templateName), discipline]));

/** Names of templates merged into another (11.0): artifacts saved under them still resolve. */
export const LEGACY_TEMPLATE_NAMES: Readonly<Record<string, string>> = {
  'Catálogo de Decisiones (ADR)': 'Registro de Decisiones Arquitectónicas (ADR)',
};

const LEGACY_BY_NAME = new Map(Object.entries(LEGACY_TEMPLATE_NAMES).map(([from, to]) => [normalizeName(from), to]));

/** The current name of a template, migrating a merged one on read. */
export const currentTemplateName = (templateName: string): string =>
  LEGACY_BY_NAME.get(normalizeName(templateName)) ?? templateName;

/** The discipline of a catalogue template, by its name; `undefined` when it has none. */
export const disciplineForTemplate = (templateName: string | undefined | null): DocumentDiscipline | undefined =>
  templateName ? BY_NAME.get(normalizeName(currentTemplateName(templateName))) : undefined;
