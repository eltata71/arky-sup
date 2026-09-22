import { Settings } from '../../../types';
import type { AIConversationTurn } from '../core/AIContent';
import { cleanJsonString } from '../../../utils';
import { aiGateway } from './aiGateway';
import { AIServiceError, classifyAIError } from '../errors';
import { resolveEffectiveModel } from '../../../lib/ai/modelCatalog';
import { budgetChatHistory } from '../callControl/contextBudget';
import { clearAiCooldown, executeAiCall, estimatePayloadSize } from '../callControl/aiCallControlService';
import { getGeminiProxyUrl } from '../providers/gemini/geminiClient';
import { buildProxyAuthHeaders } from '../proxyAuthHeaders';
import { observabilityService } from '../../observability';
import { assertDirectCallAllowed, assertDirectCallAllowedFor } from '../aiProxyEnforcement';
import { proxyFailure } from '../aiProxyPolicy';

export interface GuidedProjectData {
  name: string;
  description: string;
  projectContext: string[];
  initialArtifacts: string[];
}

export interface GuidedProjectCommand {
  action: 'createProject';
  data: GuidedProjectData;
}

export interface GuidedCreationResult {
  text: string;
  command?: GuidedProjectCommand;
  requestId: string;
  promptSize: number;
}

const GUIDED_HISTORY_BUDGET = {
  maxMessages: 8,
  maxChars: 3_200,
};

const GUIDED_SYSTEM_INSTRUCTION = `Eres el Asistente de Creación de Proyectos de ArkyPro.
Objetivo: guiar al usuario paso a paso para crear UN proyecto de arquitectura.

Reglas obligatorias:
- No uses contexto de otros proyectos, artefactos existentes, cursos LMS ni adjuntos.
- Mantén respuestas breves y accesibles en español.
- No repitas preguntas ya respondidas.
- Recopila progresivamente: 1) nombre, 2) objetivo/descripción, 3) alcance, 4) contexto tecnológico o negocio, 5) artefactos iniciales sugeridos.
- Si falta información, haz UNA pregunta concreta.
- Cuando tengas suficiente información, responde SOLO con JSON válido y sin Markdown:
{
  "action": "createProject",
  "data": {
    "name": "nombre claro",
    "description": "descripción ejecutiva de 1-2 frases",
    "projectContext": ["objetivo", "alcance", "contexto tecnológico o negocio"],
    "initialArtifacts": ["Diagrama de Contexto (C4-N1)", "Visión de la Arquitectura", "Requisitos No Funcionales"]
  }
}`;

interface GeminiProxyErrorResponse {
  requestId?: unknown;
  error?: unknown;
  source?: unknown;
  retryAfterMs?: unknown;
}

interface GeminiProxySuccessResponse {
  requestId?: unknown;
  text?: unknown;
}

const GUIDED_SESSION_STORAGE_KEY = 'arky.guidedCreation.sessionId.v1';

function readJsonObject(value: string): GeminiProxyErrorResponse | GeminiProxySuccessResponse | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as GeminiProxyErrorResponse | GeminiProxySuccessResponse : null;
  } catch {
    return null;
  }
}

function normalizeRetryAfterMs(data: GeminiProxyErrorResponse, retryAfterHeader: string | null): number | undefined {
  if (typeof data.retryAfterMs === 'number' && Number.isFinite(data.retryAfterMs)) return data.retryAfterMs;
  if (typeof retryAfterHeader === 'string' && retryAfterHeader.trim().length > 0) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateMs = Date.parse(retryAfterHeader);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

function getGuidedSessionId(): string {
  if (typeof window === 'undefined') return `server-${Date.now()}`;
  try {
    const existing = window.sessionStorage.getItem(GUIDED_SESSION_STORAGE_KEY) || window.localStorage.getItem(GUIDED_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const generated = `guided-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(GUIDED_SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `guided-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Headers for the proxy call, through the shared builder.
 *
 * This used to send the uid as a bare header, which the proxy no longer
 * accepts. Because any proxy failure degrades to the direct path, the symptom
 * would not have been an outage — it would have been guided creation silently
 * abandoning the server-side key and using the browser's, which is the exact
 * thing the proxy exists to prevent.
 */
const buildProxyHeaders = (): Promise<Record<string, string>> =>
  buildProxyAuthHeaders(getGuidedSessionId());

function createProxyError(response: Response, data: GeminiProxyErrorResponse, retryAfterHeader: string | null): AIServiceError {
  const errorCode = typeof data.error === 'string' ? data.error : 'proxy_error';
  const retryAfterMs = normalizeRetryAfterMs(data, retryAfterHeader);
  if (errorCode === 'proxy_rate_limited') {
    return new AIServiceError(
      'rate-limit',
      response.status,
      'Gemini proxy local rate limit exceeded',
      'El canal de IA de la aplicación está temporalmente limitado. Espera unos segundos y vuelve a intentar; no es un agotamiento confirmado de cuota de Gemini.',
      true,
      data,
      retryAfterMs,
      { source: 'proxy-local-rate-limit', errorCode },
    );
  }
  if (errorCode === 'provider_rate_limited') {
    return new AIServiceError(
      'rate-limit',
      response.status,
      'Gemini provider rate limit exceeded',
      'Gemini devolvió un límite real de cuota o peticiones. Espera unos segundos antes de reintentar.',
      true,
      data,
      retryAfterMs,
      { source: 'provider-rate-limit', errorCode },
    );
  }
  if (errorCode === 'missing_gemini_api_key') {
    return new AIServiceError(
      'auth',
      response.status,
      'Gemini API key missing in proxy',
      'El proxy de IA no tiene configurada una API key de Gemini. Revisa la configuración del despliegue.',
      false,
      data,
      undefined,
      { source: 'auth', errorCode },
    );
  }
  if (errorCode === 'gemini_unavailable') {
    return new AIServiceError(
      'overloaded',
      response.status,
      'Gemini provider unavailable',
      'El modelo de IA está saturado o temporalmente no disponible. Reintenta en unos segundos.',
      true,
      data,
      retryAfterMs,
      { source: 'overloaded', errorCode },
    );
  }
  return classifyAIError({ status: response.status, message: JSON.stringify(data), retryAfterMs });
}

function normalizeGuidedMessages(history: readonly AIConversationTurn[]): AIConversationTurn[] {
  const budgeted = budgetChatHistory(history, GUIDED_HISTORY_BUDGET).messages;
  return budgeted
    .filter(message => !message.content.startsWith('[Contexto del Sistema]'))
    .map((message, index) => ({
      role: index === 0 && message.role === 'model' ? 'user' : message.role,
      content: index === 0 && message.role === 'model'
        ? `Saludo inicial del asistente: ${message.content}`
        : message.content,
    }));
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .slice(0, 8);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeGuidedProjectCommand(value: unknown): GuidedProjectCommand | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { action?: unknown; data?: unknown };
  if (candidate.action !== 'createProject' || !candidate.data || typeof candidate.data !== 'object') return undefined;
  const data = candidate.data as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return undefined;
  return {
    action: 'createProject',
    data: {
      name,
      description,
      projectContext: normalizeStringArray(data.projectContext, [description]),
      initialArtifacts: normalizeStringArray(data.initialArtifacts, [
        'Diagrama de Contexto (C4-N1)',
        'Visión de la Arquitectura',
        'Requisitos No Funcionales',
      ]),
    },
  };
}

export function parseGuidedProjectCommand(text: string): GuidedProjectCommand | undefined {
  const candidates = [text, cleanJsonString(text), text.match(/\{[\s\S]*\}/)?.[0]].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeGuidedProjectCommand(parsed);
      if (normalized) return normalized;
    } catch {
      // Keep trying progressively more permissive extraction candidates.
    }
  }
  return undefined;
}

async function callProxy(endpoint: string, payload: { model: string; systemInstruction: string; contents: unknown[]; temperature: number }, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: await buildProxyHeaders(),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    throw new AIServiceError(
      'network',
      undefined,
      error instanceof Error ? error.message : 'Network error while calling Gemini proxy',
      'No se pudo contactar el proxy de IA. Verifica tu conexión y reintenta.',
      true,
      error,
      undefined,
      { source: 'network', errorCode: 'proxy_network_error' },
    );
  }

  const raw = await response.text().catch(() => '');
  const data = readJsonObject(raw);
  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After');
    if (data) throw createProxyError(response, data, retryAfter);
    throw classifyAIError({ status: response.status, message: raw || response.statusText, retryAfter });
  }
  const text = data && (data as GeminiProxySuccessResponse).text;
  if (typeof text !== 'string') {
    throw new AIServiceError('malformed-response', response.status, 'Proxy response missing text', 'La respuesta de IA llegó incompleta. Reintenta en unos segundos.', true, data);
  }
  return text;
}

async function callDirectGemini(modelId: string, contents: { role: string; parts: { text: string }[] }[], settings: Settings, signal?: AbortSignal): Promise<string> {
  // Interactive flow: rely on MODEL_FALLBACK_CHAIN as the safety net rather
  // than on multi-second in-model backoff. Each candidate gets ONE attempt
  // before falling through, which keeps total recovery time low for a chat
  // turn even when the preferred model is rate-limited.
  const result = await aiGateway.generateContent(
    settings,
    modelId,
    contents,
    {
      systemInstruction: GUIDED_SYSTEM_INSTRUCTION,
      temperature: settings.aiConfig?.temperature ?? 0.4,
    },
    { signal, maxRetries: 0 },
  );
  return result.text;
}

export async function sendGuidedProjectCreationMessage(history: readonly AIConversationTurn[], userMessage: string, settings: Settings, signal?: AbortSignal): Promise<GuidedCreationResult> {
  const normalizedMessages = normalizeGuidedMessages(history);
  const model = resolveEffectiveModel('default', settings);
  const contents = normalizedMessages.map(message => ({
    role: message.role,
    parts: [{ text: message.content }],
  }));
  const promptSize = estimatePayloadSize({ systemInstruction: GUIDED_SYSTEM_INSTRUCTION, contents });
  const normalizedUserMessage = userMessage.trim().toLowerCase().slice(0, 240);
  const dedupeKey = `guided-creation:${normalizedUserMessage}:${contents.length}`;

  const { requestId, value } = await executeAiCall<string>({
    purpose: 'guided-creation',
    model: model.id,
    modelSource: model.source,
    promptSize,
    messageCount: contents.length,
    dedupeKey,
    signal,
  }, async () => {
    const proxyUrl = getGeminiProxyUrl();
    if (proxyUrl) {
      try {
        return await callProxy(proxyUrl, {
          model: model.id,
          systemInstruction: GUIDED_SYSTEM_INSTRUCTION,
          contents,
          temperature: settings.aiConfig?.temperature ?? 0.4,
        }, signal);
      } catch (error) {
        const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
        // Standardise with artifact generation: ANY proxy failure (local
        // bucket limit, upstream 429, 5xx, network blip) is retried via the
        // direct path, which carries the full MODEL_FALLBACK_CHAIN and
        // retryWithBackoff guarantees. The proxy stays as an optimisation
        // for hiding the API key when it is healthy, but it can never be a
        // single point of failure for guided creation again.
        try {
          // Under `VITE_AI_STRICT_PROXY` this refuses instead of degrading:
          // guided creation is precisely the path that once drifted onto the
          // browser-side key without anyone noticing, because a proxy failure
          // here has always been silent by design.
          assertDirectCallAllowed(settings, proxyFailure('provider-error', {
            detail: friendly.errorCode,
            retryAfterMs: friendly.retryAfterMs,
          }));
          const directText = await callDirectGemini(model.id, contents, settings, signal);
          if (friendly.errorCode === 'proxy_rate_limited') {
            clearAiCooldown('guided-creation', 'proxy-local-rate-limit');
          }
          observabilityService.trackEvent({
            severity: 'warning',
            source: 'operation',
            status: 'observed',
            title: 'Proxy IA degradado; fallback directo aplicado',
            message: 'La creación guiada evitó una falla del proxy reutilizando el proveedor directo (mismo camino que la generación de artefactos).',
            operationName: 'guided-creation',
            recoverable: true,
            userVisible: false,
            metadata: {
              purpose: 'guided-creation',
              model: model.id,
              proxyFallbackApplied: true,
              errorSource: friendly.source,
              errorCode: friendly.errorCode,
              retryAfterMs: friendly.retryAfterMs,
            },
          });
          return directText;
        } catch (directError) {
          // Both proxy AND every fallback model failed — surface the real
          // (final) error so the cooldown UI and observability reflect the
          // genuine quota state rather than the proxy's local bucket.
          throw directError instanceof AIServiceError ? directError : classifyAIError(directError);
        }
      }
    }

    assertDirectCallAllowedFor(settings, 'not-configured');
    return callDirectGemini(model.id, contents, settings, signal);
  });

  return {
    text: value,
    command: parseGuidedProjectCommand(value),
    requestId,
    promptSize,
  };
}

export const __test__ = {
  GUIDED_SYSTEM_INSTRUCTION,
  GUIDED_HISTORY_BUDGET,
  normalizeGuidedMessages,
};
