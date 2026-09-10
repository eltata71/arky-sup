/**
 * The single-agent assistant behind every "ayúdame a completar esto" button.
 *
 * Three properties define it, and each one is a decision rather than an
 * accident:
 *
 * 1. **One agent, no orchestration.** Completing a form field is a task with a
 *    single domain, a single acceptance criterion and no cross-domain
 *    contradiction to resolve. Running it through the Office's coordinator,
 *    specialists and consolidator would cost several model calls and a visible
 *    delay to answer a question one architect answers directly. Anthropic's
 *    guidance on building agents puts this first: use the simplest pattern that
 *    solves the task, and add coordination only when a simpler shape falls
 *    short. The Office's team stays for what it is for — a real architectural
 *    question answered from several domains at once.
 *
 * 2. **It proposes; it never writes.** The result is a suggestion the user
 *    accepts, edits or ignores. Nothing here patches a record.
 *
 * 3. **It degrades, never blocks.** Every failure path returns `ok: false` with
 *    a Spanish sentence the button renders. A form must stay fillable by hand
 *    with no AI at all — which is also what makes the button safe to put next
 *    to every field.
 *
 * What to ask, in whose voice and with which context is *not* decided here:
 * `services/architectureOffice/application/captureAssistance` composes the
 * request from the configured agent profile and the record. This module only
 * knows how to put a `CaptureSuggestionRequest` to a model and how to distrust
 * what comes back.
 */

import type {
  CaptureFieldId,
  CaptureFieldSpec,
  CaptureFieldSuggestion,
  CaptureSuggestionRequest,
  CaptureSuggestionResult,
} from '../../../../lib/capture';
import { CAPTURE_FIELDS, CAPTURE_GLOBAL_RULES, describeInsufficientContext } from '../../../../lib/capture';
import { resolveEffectiveModel } from '../../../../lib/ai/modelCatalog';
import { geminiService } from '../../../geminiService';
import { defineSchema, parseStructured } from '../../structuredOutput';
import type { Settings } from '../../../../types';

const SUGGESTION_SCHEMA = defineSchema({
  type: 'object',
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fieldId', 'values'],
        properties: {
          fieldId: { type: 'string' },
          values: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
});

const describeField = (spec: CaptureFieldSpec, current?: string): string => [
  `- id: ${spec.id}`,
  `  campo: ${spec.label} — ${spec.question}`,
  `  forma: ${spec.shape === 'text' ? 'un único valor en prosa' : `hasta ${spec.maxSuggestions} entradas cortas e independientes`}`,
  `  guía: ${spec.guidance}`,
  ...spec.constraints.map((rule) => `  regla: ${rule}`),
  current && current.trim().length > 0
    ? `  valor actual (mejóralo, no lo descartes): "${current.trim()}"`
    : '  valor actual: vacío',
].join('\n');

const buildPrompt = (request: CaptureSuggestionRequest): string => {
  const { context } = request;
  const ancestry = context.ancestry.length > 0
    ? context.ancestry.map((line) => `- ${line.label}: ${line.value}`).join('\n')
    : '- (este registro no tiene nivel superior declarado)';
  const known = context.known.length > 0
    ? context.known.map((line) => `- ${line.label}: ${line.value}`).join('\n')
    : '- (todavía no hay nada capturado)';

  return [
    ...request.agentBriefing,
    '',
    'TAREA: propón cómo completar los campos indicados del registro que tienes delante.',
    '',
    `REGISTRO: ${context.subject || '(sin nombre todavía)'}`,
    'NIVELES SUPERIORES:',
    ancestry,
    'YA CAPTURADO:',
    known,
    '',
    'CAMPOS A COMPLETAR:',
    ...request.fields.map((spec) => describeField(spec, request.current?.[spec.id])),
    '',
    'REGLAS:',
    ...CAPTURE_GLOBAL_RULES.map((rule) => `- ${rule}`),
    '- Devuelve una entrada por campo solicitado, en el mismo orden, usando exactamente el id indicado.',
    '- Un campo de forma "un único valor" lleva exactamente un elemento en "values".',
    '',
    'Responde EXCLUSIVAMENTE con este JSON:',
    '{',
    '  "suggestions": [{ "fieldId": "id del campo", "values": ["…"], "rationale": "una línea explicando en qué te basaste" }],',
    '  "openQuestions": ["lo que no se deduce del contexto y hay que preguntarle al negocio"]',
    '}',
  ].join('\n');
};

const asTrimmedStrings = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
};

/**
 * Coerces the model's payload into suggestions for the fields that were asked
 * about — and only those.
 *
 * A model that answers about a field nobody requested is not being helpful: the
 * button that made the call renders one field, so an extra suggestion would be
 * silently dropped by the UI anyway, and a caller that trusted the array order
 * would apply the wrong text to the wrong field.
 */
const normalizeSuggestions = (
  raw: unknown,
  requested: readonly CaptureFieldSpec[],
): CaptureFieldSuggestion[] => {
  if (!raw || typeof raw !== 'object') return [];
  const payload = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(payload)) return [];

  const wanted = new Map(requested.map((spec) => [spec.id, spec]));
  const claimed = new Set<CaptureFieldId>();
  const result: CaptureFieldSuggestion[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fieldId = typeof record.fieldId === 'string' ? record.fieldId : '';
    const spec = wanted.get(fieldId as CaptureFieldId);
    if (!spec || claimed.has(spec.id)) continue;
    const limit = spec.shape === 'text' ? 1 : Math.max(1, spec.maxSuggestions);
    const values = asTrimmedStrings(record.values, limit);
    if (values.length === 0) continue;
    claimed.add(spec.id);
    result.push({
      fieldId: spec.id,
      values,
      rationale: typeof record.rationale === 'string' && record.rationale.trim()
        ? record.rationale.trim()
        : undefined,
    });
  }
  return result;
};

export const captureAssistantService = {
  /**
   * Asks the architect agent how to complete one field or a whole form.
   * Never throws: the caller renders `reason` and the user keeps typing.
   */
  async suggest(
    request: CaptureSuggestionRequest,
    settings: Settings,
    options: { signal?: AbortSignal } = {},
  ): Promise<CaptureSuggestionResult> {
    const fields = request.fields.filter((spec) => Boolean(CAPTURE_FIELDS[spec.id]));
    if (fields.length === 0) {
      return { ok: false, suggestions: [], openQuestions: [], reason: 'No hay ningún campo que completar.' };
    }

    // The guardrail runs before the call, not after it: a model asked to
    // propose objectives for an empty record will produce objectives, and they
    // will be about nothing.
    const insufficient = describeInsufficientContext(request);
    if (insufficient) {
      return { ok: false, suggestions: [], openQuestions: [], reason: insufficient };
    }

    try {
      const model = resolveEffectiveModel(request.modelTier ?? 'default', settings).id;
      const response = await geminiService.generateContentWithFallback(
        settings,
        model,
        buildPrompt({ ...request, fields }),
        {
          responseMimeType: 'application/json',
          responseSchema: SUGGESTION_SCHEMA,
          temperature: 0.35,
        },
        { signal: options.signal },
      );

      const parsed = parseStructured<unknown>(response.text);
      if (!parsed.ok) {
        return {
          ok: false,
          suggestions: [],
          openQuestions: [],
          reason: 'El asistente devolvió una respuesta que no se pudo interpretar. Vuelve a intentarlo.',
        };
      }

      const suggestions = normalizeSuggestions(parsed.value, fields);
      if (suggestions.length === 0) {
        return {
          ok: false,
          suggestions: [],
          openQuestions: asTrimmedStrings((parsed.value as { openQuestions?: unknown })?.openQuestions, 6),
          reason: 'El asistente no encontró base suficiente para proponer nada aquí. Añade contexto y vuelve a pedírselo.',
        };
      }

      return {
        ok: true,
        suggestions,
        openQuestions: asTrimmedStrings((parsed.value as { openQuestions?: unknown }).openQuestions, 6),
      };
    } catch (error) {
      // An aborted request is the user changing their mind, not a failure to
      // report: saying "no está disponible" over a cancelled call would be a
      // lie about the system's health.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, suggestions: [], openQuestions: [], reason: '' };
      }
      return {
        ok: false,
        suggestions: [],
        openQuestions: [],
        reason: 'El asistente no está disponible ahora. Puedes completar el campo a mano.',
      };
    }
  },
} as const;

export type CaptureAssistantService = typeof captureAssistantService;
