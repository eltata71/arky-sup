/**
 * What each section of a catalogue document must say, as the prompt tells the
 * model (plan de calidad de artefactos, 7.4a).
 *
 * The sections themselves — their titles, the words that detect them, the
 * content rules — are `lib/artifacts/documentDisciplines`, the one list the
 * contract checks. This is only the prose the prompt adds to each of them,
 * kept here because the compiler that reads the list is on the boot path and
 * a validation never reads a sentence of guidance. `documentDisciplinePrompt.test`
 * holds the two halves together: every section has its line, and no line
 * names a section that does not exist.
 */
import { disciplineForTemplate } from '../../../lib/artifacts';

/** Template name → section id → what the section must say. */
export const DISCIPLINE_GUIDANCE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'Registro de Decisiones Arquitectónicas (ADR)': {
    status: 'Propuesta, Aceptada, Rechazada, Obsoleta o Sustituida (por qué ADR).',
    context: 'El problema, las fuerzas en juego y las restricciones que obligan a decidir.',
    decision: 'Lo que se decide, en voz activa y sin ambigüedad.',
    alternatives: 'Cada opción con sus ventajas, inconvenientes y por qué se descartó.',
    consequences: 'Lo que la decisión hace más fácil y más difícil, positivo y negativo.',
  },
  'Plan de Recuperación ante Desastres (DRP)': {
    scope: 'Qué sistemas y procesos cubre y cuáles no.',
    objectives: 'RTO y RPO por sistema, con cifra y unidad.',
    scenarios: 'Cada escenario con probabilidad, impacto y estrategia.',
    procedure: 'Pasos numerados, quién los ejecuta y cómo se verifica cada uno.',
    tests: 'Frecuencia de los ensayos y cómo se registran los resultados.',
    owners: 'Quién declara el desastre, quién ejecuta y quién comunica.',
  },
  'Especificación de Requerimientos (SRS)': {
    purpose: 'Qué especifica el documento y para quién.',
    scope: 'Qué entra y qué queda fuera.',
    functional: 'Tabla con ID, requisito, criterio de aceptación y prioridad.',
    nonFunctional: 'Rendimiento, disponibilidad, seguridad y cumplimiento, cada uno medible.',
    rules: 'Las reglas que el sistema debe hacer cumplir.',
    assumptions: 'Lo que se da por cierto y de qué depende.',
  },
  'Manual de Operaciones / Runbook': {
    purpose: 'Qué servicio opera y para qué incidentes.',
    alerts: 'Cada alerta con umbral y severidad.',
    procedures: 'Pasos numerados por incidente, ejecutables por quien esté de guardia.',
    escalation: 'A quién se escala, cuándo y por qué canal.',
    verification: 'Cómo se comprueba que el servicio volvió a la normalidad.',
  },
  'Matriz de Controles de Seguridad': {
    objective: 'Qué flujo o sistema protegen los controles.',
    controls: 'Tabla con ID, control, riesgo que mitiga, tipo, frecuencia, responsable y evidencia.',
    owners: 'Cada control con su dueño, persona o rol.',
    evidence: 'Qué prueba que cada control opera y dónde se conserva.',
    gaps: 'Lo que aún no está cubierto y cómo se cubrirá.',
  },
  'Visión de la Arquitectura': {
    summary: 'El problema de negocio y la arquitectura objetivo en pocas líneas.',
    drivers: 'Por qué ahora, ligado a las iniciativas.',
    target: 'El estado futuro y sus capacidades clave.',
    scope: 'Qué dominios y sistemas entran.',
    stakeholders: 'Quién decide y quién se ve afectado.',
    risks: 'Riesgos principales con su mitigación.',
  },
  'Principios de Arquitectura': {
    principles: 'Cada principio con enunciado, fundamento e implicaciones.',
    rationale: 'Por qué el principio sirve al negocio.',
    implications: 'Qué obliga a hacer y qué impide.',
  },
  'Análisis de Stakeholders': {
    map: 'Tabla con stakeholder, interés, influencia y postura.',
    concerns: 'Lo que cada uno necesita que la arquitectura resuelva.',
    engagement: 'Cómo y con qué frecuencia se involucra a cada uno.',
  },
  'Diccionario de Datos': {
    entities: 'Cada entidad con su propósito y su dueño.',
    attributes: 'Tabla con atributo, tipo, obligatoriedad y descripción.',
    classification: 'PII, PHI, PCI o público por atributo.',
    rules: 'Formatos, rangos y dominios válidos.',
  },
  'Estrategia de Migración de Datos': {
    scope: 'Qué datos se migran, desde dónde y hacia dónde.',
    approach: 'Big bang, por fases o en paralelo, y por qué.',
    mapping: 'Correspondencia origen → destino y reglas de transformación.',
    validation: 'Cómo se comprueba que no se perdió ni alteró nada.',
    rollback: 'Cómo se vuelve atrás si la migración falla.',
  },
  'Modelo de Costos de Infraestructura': {
    assumptions: 'Volúmenes, precios y tipo de cambio de los que depende el cálculo.',
    breakdown: 'Tabla por componente con costo mensual y anual.',
    scenarios: 'Costo en escenario bajo, esperado y alto.',
    optimization: 'Palancas de ahorro y su impacto.',
  },
  'Casos de Prueba': {
    cases: 'Tabla con ID, requisito que verifica, precondiciones, pasos y resultado esperado.',
    expected: 'Lo que debe ocurrir, verificable.',
    traceability: 'Cada caso ligado al requisito que prueba.',
  },
  'README del Proyecto': {
    description: 'Qué es y para qué sirve.',
    setup: 'Pasos para ponerlo en marcha.',
    usage: 'Cómo se usa, con un ejemplo.',
    architecture: 'Los componentes y cómo se relacionan.',
  },
  'Informe de Revisión de Arquitectura': {
    scope: 'Qué se revisó y con qué criterios.',
    findings: 'Tabla con hallazgo, severidad y evidencia.',
    recommendations: 'Qué hacer con cada hallazgo, con responsable.',
    verdict: 'Aprobado, aprobado con condiciones o rechazado.',
  },
  'Matriz de Tácticas de Arquitectura': {
    attributes: 'Los atributos que importan y su escenario.',
    tactics: 'Tabla con atributo, táctica, componente donde se aplica y efecto.',
    tradeoffs: 'Qué atributo cede cada táctica.',
  },
  'Análisis de Compromisos (Trade-offs)': {
    options: 'Las alternativas que se comparan.',
    criteria: 'Los criterios y su peso.',
    comparison: 'Tabla de opciones contra criterios.',
    recommendation: 'La opción recomendada y lo que se sacrifica.',
  },
  'Contrato de Arquitectura': {
    parties: 'Quién entrega y quién gobierna, con su rol.',
    scope: 'Qué solución y qué límites cubre el contrato.',
    obligations: 'Lo que la implementación debe respetar (estándares, patrones, restricciones).',
    criteria: 'Criterios verificables con cifra o condición comprobable.',
    compliance: 'Cómo y cuándo se revisa el cumplimiento, y quién decide.',
    deviations: 'Cómo se solicita y registra una excepción.',
  },
  'Evaluación de Cumplimiento': {
    scope: 'La implementación evaluada y el contrato contra el que se mide.',
    criteria: 'Los criterios del contrato que se comprobaron.',
    findings: 'Tabla con criterio, resultado y evidencia.',
    verdict: 'Conforme, conforme con condiciones o no conforme.',
    actions: 'Acciones correctivas con responsable y fecha.',
  },
  'Definición de Fitness Functions': {
    functions: 'Tabla con atributo que protege, métrica, umbral y cómo se ejecuta.',
    thresholds: 'El valor que hace fallar cada función.',
    automation: 'Dónde corre cada función y con qué frecuencia.',
  },
};

/** The structure a model must follow, as one prompt block; `''` without a discipline. */
export function describeDisciplineForPrompt(templateName: string | undefined | null): string {
  const discipline = disciplineForTemplate(templateName);
  if (!discipline) return '';
  const guidance = DISCIPLINE_GUIDANCE[discipline.templateName] ?? {};
  const sections = discipline.sections.map((section, index) =>
    `${index + 1}. ## ${section.label}${section.requirement === 'recommended' ? ' (recomendada)' : ''}${guidance[section.id] ? ` — ${guidance[section.id]}` : ''}`);
  const rules = discipline.rules.map((rule) => `- ${rule.label}.`);
  return [
    `ESTRUCTURA OBLIGATORIA — ${discipline.label}${discipline.standard ? ` (${discipline.standard})` : ''}. Usa estos encabezados, en este orden; el contrato de la plantilla comprueba cada uno:`,
    ...sections,
    ...(rules.length ? ['Reglas de contenido:', ...rules] : []),
  ].join('\n');
}
