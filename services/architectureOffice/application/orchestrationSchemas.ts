/**
 * Los esquemas que se le piden al modelo en la orquestación (plan de agentes,
 * 18.0). Describen la forma; `domain/orchestrationContracts` la lee con
 * tolerancia, porque un esquema pedido no es un esquema cumplido.
 */

import type { AIJsonSchema } from '../../ai';

const str = (description: string): AIJsonSchema => ({ type: 'string', description });
const strList = (description: string): AIJsonSchema => ({ type: 'array', description, items: { type: 'string' } });

export const COORDINATION_BRIEF_SCHEMA: AIJsonSchema = {
  type: 'object',
  properties: {
    summary: str('Plan de coordinación en pocas frases.'),
    order: strList('Orden recomendado de los especialistas, por alias.'),
    dependencies: strList('Dependencias entre workstreams, una por entrada.'),
    dropWorkstreams: strList('Alias o ids de especialistas que NO hacen falta en esta petición.'),
    extraConstraints: strList('Restricciones adicionales para los especialistas (máximo 5).'),
  },
  required: ['summary'],
};

export const SPECIALIST_ANALYSIS_SCHEMA: AIJsonSchema = {
  type: 'object',
  properties: {
    summary: str('Conclusión del análisis en pocas frases.'),
    findings: {
      type: 'array',
      description: 'Hallazgos con su severidad.',
      items: {
        type: 'object',
        properties: { text: str('El hallazgo.'), severity: { type: 'string', enum: ['low', 'medium', 'high'] } },
        required: ['text', 'severity'],
      },
    },
    assumptions: strList('Supuestos explícitos.'),
    risks: strList('Riesgos.'),
    decisions: strList('Decisiones que propones.'),
    outOfScope: {
      type: 'array',
      description: 'Lo que queda fuera de tu dominio y a quién pertenece.',
      items: {
        type: 'object',
        properties: { text: str('Lo que queda fuera.'), belongsTo: str('Alias del agente al que pertenece.') },
        required: ['text', 'belongsTo'],
      },
    },
    evidence: strList('Referencias de contexto [ctx:*] en las que te apoyas.'),
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['summary'],
};

export const RECOMMENDATION_SCHEMA: AIJsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ready', 'conditional', 'blocked'] },
    rationale: str('Justificación del veredicto.'),
    contributions: {
      type: 'array',
      description: 'Una entrada por especialista: si se usó o se descartó, y por qué.',
      items: {
        type: 'object',
        properties: {
          agent: str('Alias del especialista.'),
          use: { type: 'string', enum: ['used', 'discarded'] },
          note: str('Por qué.'),
        },
        required: ['agent', 'use'],
      },
    },
    contradictions: {
      type: 'array',
      description: 'Contradicciones entre especialistas, cada una con responsable.',
      items: {
        type: 'object',
        properties: { text: str('La contradicción.'), owner: str('Quién debe resolverla.') },
        required: ['text', 'owner'],
      },
    },
    conditions: strList('Condiciones para que la recomendación se sostenga.'),
    openQuestions: strList('Preguntas abiertas, incluida cualquier parcialidad.'),
  },
  required: ['verdict', 'rationale'],
};

/**
 * La crítica del revisor de un encargo (plan de agentes, 18.1). Cada hallazgo
 * declara qué criterio de aceptación numerado incumple, para que el productor
 * sepa qué corregir exactamente.
 */
export const REVIEW_CRITIQUE_SCHEMA: AIJsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approved', 'changes-requested', 'rejected'] },
    summary: str('Resumen de la revisión en pocas frases.'),
    findings: {
      type: 'array',
      description: 'Hallazgos con severidad, el criterio numerado que incumplen y su evidencia.',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          message: str('El hallazgo, citando algo presente o ausente en el contenido.'),
          criterion: { type: 'integer', description: 'El número del criterio de aceptación incumplido (los criterios van numerados en el prompt).' },
          evidence: str('La cita textual o el validator que respalda el hallazgo. Nunca inventado.'),
        },
        required: ['severity', 'message'],
      },
    },
  },
  required: ['verdict', 'summary'],
};
