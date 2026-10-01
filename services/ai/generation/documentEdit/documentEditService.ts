/**
 * Ask a model for a document patch — never for the document (plan de calidad
 * de artefactos, 7.4b).
 *
 * The copilot changed a document by asking for all of it back. This asks for
 * the operations only: the model sees the outline, the document (or, when it
 * is long, the sections the request talks about) and answers with the
 * smallest set of operations over the headings that exist. It proposes and
 * never applies: applying — and the preview of what applying would do — is
 * the artifacts context's engine, because a summary written by the proposer
 * cannot catch a proposal that describes one change and encodes another.
 */
import type { Settings } from '../../../../types';
import type { DocumentPatch, DocumentPatchOperation } from '../../../../lib/artifacts';
import { DOCUMENT_PATCH_OPERATIONS } from '../../../../lib/artifacts';
import { resolveEffectiveModel } from '../../../../lib/ai/modelCatalog';
import { wrapUntrustedContent } from '../../../../lib/untrustedContent';
import { aiGateway } from '../aiGateway';
import { defineSchema, parseStructured } from '../../structuredOutput';

/** More operations than this and the request is a rewrite, not a change. */
export const MAX_DOCUMENT_PATCH_OPERATIONS = 8;
/** Up to this, the model reads the whole document; past it, the relevant sections. */
const WHOLE_DOCUMENT_CHARS = 40_000;
const SECTION_EXCERPT_CHARS = 30_000;

export interface DocumentEditRequest {
  content: string;
  /** The document's headings, in order (`outlineOfDocument`). */
  outline: readonly string[];
  /** What the architect asked for, in their own words. */
  instruction: string;
  /** The project context under the `edit` profile, already fenced. */
  context?: string;
}

export interface DocumentEditProposal {
  ok: boolean;
  patch: DocumentPatch | null;
  /** Why there is no patch; `''` when the request was cancelled. */
  reason?: string;
}

const PATCH_SCHEMA = defineSchema({
  type: 'object',
  required: ['operations'],
  properties: {
    rationale: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['op'],
        properties: {
          op: { type: 'string', enum: [...DOCUMENT_PATCH_OPERATIONS] },
          heading: { type: 'string' },
          after: { type: 'string' },
          body: { type: 'string' },
          match: { type: 'string' },
          cells: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
});

const words = (text: string): string[] =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9ñ]+/).filter((word) => word.length > 3);

/**
 * A long document is shown by its sections that share words with the request,
 * whole, up to a budget — a section cut in half would be patched as if the
 * missing half did not exist.
 */
function relevantSections(content: string, instruction: string): string {
  const asked = new Set(words(instruction));
  const blocks = content.split(/\n(?=#{1,6}\s)/);
  const scored = blocks
    .map((block, index) => ({ block, index, score: words(block.slice(0, 2_000)).filter((word) => asked.has(word)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: typeof scored = [];
  let size = 0;
  for (const entry of scored) {
    if (size + entry.block.length > SECTION_EXCERPT_CHARS) continue;
    picked.push(entry);
    size += entry.block.length;
  }
  return picked.sort((a, b) => a.index - b.index).map((entry) => entry.block).join('\n\n[…]\n\n');
}

const buildPrompt = (request: DocumentEditRequest): string => {
  const whole = request.content.length <= WHOLE_DOCUMENT_CHARS;
  return [
    'Eres un arquitecto que edita un documento existente. NO lo reescribas: propón el cambio MÍNIMO que cumpla lo que se te pide, como operaciones sobre sus secciones.',
    '',
    'ÍNDICE DEL DOCUMENTO (los únicos títulos a los que puedes referirte):',
    ...request.outline.map((heading) => `- ${heading}`),
    '',
    whole ? 'DOCUMENTO:' : 'SECCIONES RELEVANTES DEL DOCUMENTO (el resto no se muestra y no debe tocarse):',
    wrapUntrustedContent('documento', whole ? request.content : relevantSections(request.content, request.instruction)),
    ...(request.context ? ['', request.context] : []),
    '',
    'PETICIÓN:',
    wrapUntrustedContent('petición', request.instruction.trim()),
    '',
    'OPERACIONES DISPONIBLES:',
    '- replace-section { heading, body }: reemplaza TODO lo que hay bajo ese título, subsecciones incluidas; devuelve en body el contenido completo de la sección.',
    '- insert-section { after, heading, body }: añade una sección después de «after» (o al final si after es null).',
    '- remove-section { heading }: sólo si se pide quitarla.',
    '- append-table-row { heading, cells }: añade una fila a la primera tabla de esa sección; tantas celdas como columnas.',
    '- update-table-row { heading, match, cells }: reemplaza la fila cuya primera celda es «match».',
    '',
    'REGLAS:',
    '- Usa EXACTAMENTE los títulos del índice, sin los signos #.',
    '- Para añadir o cambiar una fila de una tabla, usa las operaciones de fila; no reemplaces la sección entera.',
    `- Como máximo ${MAX_DOCUMENT_PATCH_OPERATIONS} operaciones. Si hacen falta más, es una regeneración: propón las más importantes y dilo en "rationale".`,
    '- Conserva el idioma, el tono y los identificadores del documento.',
    '- Si la petición no se puede cumplir sobre este documento, devuelve "operations": [] y explica por qué en "rationale".',
    '',
    'Responde EXCLUSIVAMENTE con este JSON:',
    '{ "rationale": "una línea explicando el cambio", "operations": [{ "op": "…", … }] }',
  ].join('\n');
};

/** Take only what the vocabulary allows; the engine decides what is valid. */
const normalizePatch = (raw: unknown): DocumentPatch | null => {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as { operations?: unknown; rationale?: unknown };
  if (!Array.isArray(payload.operations)) return null;
  const operations = payload.operations
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .filter((entry) => DOCUMENT_PATCH_OPERATIONS.includes(entry.op as DocumentPatchOperation['op']))
    .map((entry) => (entry.op === 'insert-section' && typeof entry.after !== 'string' ? { ...entry, after: null } : entry))
    .slice(0, MAX_DOCUMENT_PATCH_OPERATIONS) as unknown as DocumentPatchOperation[];
  const rationale = typeof payload.rationale === 'string' && payload.rationale.trim() ? payload.rationale.trim() : undefined;
  return { rationale, operations };
};

export const documentEditService = {
  /** Ask for a patch. Never applies anything; never throws. */
  async proposeEdit(
    request: DocumentEditRequest,
    settings: Settings,
    options: { signal?: AbortSignal } = {},
  ): Promise<DocumentEditProposal> {
    if (!request.content?.trim()) return { ok: false, patch: null, reason: 'No hay documento que editar.' };
    if (!request.instruction?.trim()) return { ok: false, patch: null, reason: 'Describe qué quieres cambiar.' };
    try {
      const response = await aiGateway.generateContent(
        settings,
        resolveEffectiveModel('default', settings).id,
        buildPrompt(request),
        { responseMimeType: 'application/json', responseSchema: PATCH_SCHEMA, temperature: 0.2 },
        { signal: options.signal },
      );
      const parsed = parseStructured<unknown>(response.text);
      if (!parsed.ok) return { ok: false, patch: null, reason: 'La propuesta llegó en un formato que no se pudo interpretar. Vuelve a intentarlo.' };
      const patch = normalizePatch(parsed.value);
      if (!patch || patch.operations.length === 0) {
        return { ok: false, patch, reason: patch?.rationale ?? 'El asistente no encontró un cambio que proponer para esa petición.' };
      }
      return { ok: true, patch };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, patch: null, reason: '' };
      return { ok: false, patch: null, reason: 'El asistente no está disponible ahora. Puedes editar el documento a mano.' };
    }
  },
} as const;

export type DocumentEditService = typeof documentEditService;
