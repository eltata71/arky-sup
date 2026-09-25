import { Settings } from '../../../types';
import type { AIConversationTurn } from '../core/AIContent';
import { cleanJsonString } from '../../../utils';
import { aiGateway } from './aiGateway';
import { resolveEffectiveModel } from '../../../lib/ai/modelCatalog';
import { budgetChatHistory } from '../callControl/contextBudget';
import { executeAiCall, estimatePayloadSize } from '../callControl/aiCallControlService';

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

/**
 * One model call through `aiGateway`, which tries the serverless proxy
 * (`/api/ai`) first and applies the strict-proxy policy itself (F6-01).
 *
 * Guided creation used to have a second, private route to a model: the legacy
 * Gemini-only proxy (`api/gemini.ts`, `VITE_GEMINI_PROXY_URL`), with its own
 * fetch, error mapping and fallback. In production that variable was empty, so
 * the service skipped the proxy, asserted `not-configured` against the strict
 * policy, and **refused to call a model for anyone without a personal key** —
 * before ever reaching `aiGateway`, which would have gone through `/api/ai`.
 */
async function callModel(modelId: string, contents: { role: string; parts: { text: string }[] }[], settings: Settings, signal?: AbortSignal): Promise<string> {
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
  }, async () => callModel(model.id, contents, settings, signal));

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
