/**
 * The intake assistant for business initiatives.
 *
 * A business stakeholder arrives with a paragraph of need, not with a
 * motivation model. This service turns that paragraph into the structure the
 * discipline asks for — driver, objectives, measurable outcomes, KPIs, risks,
 * affected capabilities — so the architect edits a draft instead of facing an
 * empty form.
 *
 * Three rules keep it honest:
 *
 *  1. **It never rewrites the need.** The stakeholder's words are the record;
 *     the assistant only proposes structure *around* them.
 *  2. **It degrades, never blocks.** If the model is unavailable, malformed or
 *     slow, the caller gets `ok: false` and the wizard continues by hand. An
 *     initiative must be creatable with no AI at all.
 *  3. **Nothing it proposes is saved without a human.** The wizard shows the
 *     draft for review; `provenance: 'ai-assisted'` records that it helped.
 *
 * Lives here rather than in `geminiService` because `CLAUDE.md` freezes that
 * file: new capabilities belong in `services/ai/generation/`.
 */

import { aiGateway } from './aiGateway';
import { resolveEffectiveModel } from '../../../lib/ai/modelCatalog';
import { defineSchema, parseStructured } from '../structuredOutput';
import type { Settings } from '../../../types';
import type {
  InitiativePriority,
  InitiativeRiskLevel,
} from '../../businessInitiatives/domain';

/** What the assistant is allowed to propose. Deliberately no free-form prose. */
export interface InitiativeDraft {
  /** A short title, if the stakeholder gave none. */
  suggestedTitle?: string;
  /** The pressure behind the need — the motivation-layer driver. */
  driver: string;
  objectives: string[];
  outcomes: { statement: string; measure?: string }[];
  kpis: { name: string; unit: string; baseline?: number; target?: number }[];
  affectedCapabilities: string[];
  risks: { description: string; level: InitiativeRiskLevel; mitigation?: string }[];
  regulatoryDrivers: string[];
  suggestedPriority?: InitiativePriority;
  /** Questions the assistant could not answer from the brief. */
  openQuestions: string[];
}

export interface InitiativeDraftResult {
  ok: boolean;
  draft?: InitiativeDraft;
  /** Spanish, user-facing. Always set when `ok` is false. */
  reason?: string;
}

const DRAFT_SCHEMA = defineSchema({
  type: 'object',
  required: ['driver', 'objectives', 'outcomes', 'kpis', 'affectedCapabilities', 'risks'],
  properties: {
    suggestedTitle: { type: 'string' },
    driver: { type: 'string' },
    objectives: { type: 'array', items: { type: 'string' } },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['statement'],
        properties: {
          statement: { type: 'string' },
          measure: { type: 'string' },
        },
      },
    },
    kpis: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'unit'],
        properties: {
          name: { type: 'string' },
          unit: { type: 'string' },
          baseline: { type: 'number' },
          target: { type: 'number' },
        },
      },
    },
    affectedCapabilities: { type: 'array', items: { type: 'string' } },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'level'],
        properties: {
          description: { type: 'string' },
          level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          mitigation: { type: 'string' },
        },
      },
    },
    regulatoryDrivers: { type: 'array', items: { type: 'string' } },
    suggestedPriority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
});

const RISK_LEVELS: readonly InitiativeRiskLevel[] = ['low', 'medium', 'high', 'critical'];
const PRIORITIES: readonly InitiativePriority[] = ['critical', 'high', 'medium', 'low'];

const buildPrompt = (title: string, need: string): string => `
Eres un arquitecto empresarial senior estructurando una INICIATIVA DE NEGOCIO
según la capa de motivación de la disciplina de arquitectura empresarial.

Recibes la necesidad tal como la expresó el negocio. NO la reescribas ni la
resumas: tu trabajo es proponer la estructura que la rodea.

TÍTULO PROPUESTO: ${title || '(sin título)'}
NECESIDAD DEL NEGOCIO:
"""
${need}
"""

Produce EXCLUSIVAMENTE un objeto JSON con esta forma:

{
  "suggestedTitle": "título corto y específico, solo si el título recibido está vacío o es genérico",
  "driver": "la presión de negocio que origina la necesidad, en una o dos frases",
  "objectives": ["objetivos concretos y verificables"],
  "outcomes": [{ "statement": "resultado que el negocio espera", "measure": "cómo se evidenciará" }],
  "kpis": [{ "name": "indicador", "unit": "unidad", "baseline": número o ausente, "target": número o ausente }],
  "affectedCapabilities": ["capacidades de negocio afectadas"],
  "risks": [{ "description": "riesgo", "level": "low|medium|high|critical", "mitigation": "mitigación" }],
  "regulatoryDrivers": ["marcos regulatorios aplicables, solo si el texto los implica"],
  "suggestedPriority": "critical|high|medium|low",
  "openQuestions": ["lo que hace falta preguntarle al negocio y no se puede deducir del texto"]
}

REGLAS ESTRICTAS:
- Un objetivo describe QUÉ se quiere lograr, nunca CÓMO construirlo. No propongas
  tecnologías, componentes ni arquitecturas: eso corresponde a la atención de
  arquitectura, no a la iniciativa.
- Un KPI sin unidad no sirve. Si no puedes inferir baseline o target, omítelos:
  es preferible un indicador sin meta a una meta inventada.
- No inventes marcos regulatorios: inclúyelos solo si el texto los implica.
- Todo lo que no puedas deducir del texto va en "openQuestions", no en un campo
  rellenado a la ligera.
- Responde en español. Solo el JSON, sin explicación ni bloques de código.
`.trim();

const asStringArray = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, limit)
    : [];

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Coerces the model's payload into the draft shape.
 *
 * Anything unrecognised is dropped rather than guessed at: a proposal the
 * architect has to un-invent costs more than one they have to add.
 */
const normalizeDraft = (raw: unknown): InitiativeDraft | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const driver = typeof value.driver === 'string' ? value.driver.trim() : '';
  const objectives = asStringArray(value.objectives, 8);
  // A draft with neither a driver nor an objective adds nothing the architect
  // could not have written faster themselves.
  if (!driver && objectives.length === 0) return null;

  const outcomes = Array.isArray(value.outcomes)
    ? value.outcomes
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        statement: typeof item.statement === 'string' ? item.statement.trim() : '',
        measure: typeof item.measure === 'string' && item.measure.trim() ? item.measure.trim() : undefined,
      }))
      .filter((item) => item.statement.length > 0)
      .slice(0, 8)
    : [];

  const kpis = Array.isArray(value.kpis)
    ? value.kpis
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        unit: typeof item.unit === 'string' ? item.unit.trim() : '',
        baseline: asOptionalNumber(item.baseline),
        target: asOptionalNumber(item.target),
      }))
      .filter((item) => item.name.length > 0)
      .slice(0, 8)
    : [];

  const risks = Array.isArray(value.risks)
    ? value.risks
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        description: typeof item.description === 'string' ? item.description.trim() : '',
        level: RISK_LEVELS.includes(item.level as InitiativeRiskLevel)
          ? (item.level as InitiativeRiskLevel)
          : 'medium',
        mitigation: typeof item.mitigation === 'string' && item.mitigation.trim()
          ? item.mitigation.trim()
          : undefined,
      }))
      .filter((item) => item.description.length > 0)
      .slice(0, 8)
    : [];

  return {
    suggestedTitle: typeof value.suggestedTitle === 'string' && value.suggestedTitle.trim()
      ? value.suggestedTitle.trim()
      : undefined,
    driver,
    objectives,
    outcomes,
    kpis,
    affectedCapabilities: asStringArray(value.affectedCapabilities, 8),
    risks,
    regulatoryDrivers: asStringArray(value.regulatoryDrivers, 6),
    suggestedPriority: PRIORITIES.includes(value.suggestedPriority as InitiativePriority)
      ? (value.suggestedPriority as InitiativePriority)
      : undefined,
    openQuestions: asStringArray(value.openQuestions, 6),
  };
};

export const initiativeAssistantService = {
  /**
   * Drafts the motivation structure of an initiative from a free-text need.
   * Never throws — the wizard must stay usable when the model is not.
   */
  async draftInitiative(
    input: { title: string; need: string },
    settings: Settings,
    options: { signal?: AbortSignal } = {},
  ): Promise<InitiativeDraftResult> {
    const need = input.need.trim();
    if (need.length < 20) {
      return {
        ok: false,
        reason: 'Describe la necesidad con algo más de detalle para que el asistente pueda estructurarla.',
      };
    }

    try {
      const model = resolveEffectiveModel('default', settings).id;
      const response = await aiGateway.generateContent(
        settings,
        model,
        buildPrompt(input.title, need),
        {
          responseMimeType: 'application/json',
          responseSchema: DRAFT_SCHEMA,
          temperature: 0.4,
        },
        { signal: options.signal },
      );

      const parsed = parseStructured<unknown>(response.text);
      if (!parsed.ok) {
        return { ok: false, reason: 'El asistente devolvió una respuesta que no se pudo interpretar.' };
      }

      const draft = normalizeDraft(parsed.value);
      if (!draft) {
        return { ok: false, reason: 'El asistente no pudo estructurar la necesidad. Continúa manualmente.' };
      }
      return { ok: true, draft };
    } catch {
      // Losing the assistant is an inconvenience; losing the intake is not
      // acceptable. The wizard reads this and offers the manual path.
      return { ok: false, reason: 'El asistente no está disponible ahora. Puedes continuar manualmente.' };
    }
  },
} as const;

export type InitiativeAssistantService = typeof initiativeAssistantService;
