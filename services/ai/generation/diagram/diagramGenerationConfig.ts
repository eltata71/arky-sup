/**
 * How a diagram generation is configured: the thinking budget per task, the
 * temperature cap and the one config builder. Shared by the diagram vertical
 * and by the engine's artifact generation, which is why it left the engine
 * with the vertical (F5-01, corte 6) instead of staying behind in it.
 */
import { DIAGRAM_SYSTEM_INSTRUCTION } from '../../prompts/diagramPrompts';

/**
 * Per-task thinking budget for Gemini 2.5+ models. Mechanical/structural
 * tasks turn thinking OFF, while creative generation gets a bounded
 * budget — enough for the model to plan a coherent diagram without
 * silently spending on long chains of thought.
 *
 * IMPORTANT: Gemini 2.5 Flash-Lite accepts only 0 (off), -1 (dynamic) or
 * budgets from 512 to 24576. Keep the lowest enabled bucket at 512 so every
 * call path remains valid when the app routes work to Flash-Lite or falls
 * back to it. A previous 256 value caused 400 INVALID_ARGUMENT responses
 * during artifact generation.
 */
export const THINKING_BUDGET: Record<'off' | 'low' | 'medium' | 'high', number> = {
    off:    0,
    low:    512,
    medium: 1024,
    high:   4096,
};

/**
 * Centralised builder for diagram-related Gemini configs. A single source
 * of truth means we get consistent caching keys (systemInstruction is
 * identical byte-for-byte across calls), uniform thinking budgets and a
 * single place to evolve the diagram standard surface.
 */
export interface DiagramConfigOptions {
    /** Sampling temperature; defaults to the diagram-safe cap (0.3). */
    temperature?: number;
    /** topP override; defaults to 0.9 for structured outputs. */
    topP?: number;
    /** Optional schema (Gemini's `responseSchema` format). */
    responseSchema?: unknown;
    /** Defaults to 'application/json' when a schema is supplied. */
    responseMimeType?: string;
    /** Thinking budget bucket (see `THINKING_BUDGET`). */
    thinking?: keyof typeof THINKING_BUDGET;
    /** Extra system instruction appended after the canonical one. */
    extraSystemInstruction?: string;
}

/**
 * The config a diagram call sends. Typed since F5-01 corte 14 — it was the last
 * `Record<string, any>` the vertical carried out of the engine. The index
 * signature stays because callers add provider-specific keys on top.
 */
export interface DiagramGenerationConfig {
    [key: string]: unknown;
    systemInstruction: string;
    temperature: number;
    topP: number;
    thinkingConfig: { thinkingBudget: number };
    responseSchema?: unknown;
    responseMimeType?: string;
}

export function buildDiagramGenerationConfig(opts: DiagramConfigOptions = {}): DiagramGenerationConfig {
    const {
        temperature = 0.3,
        topP = 0.9,
        responseSchema,
        responseMimeType,
        thinking = 'low',
        extraSystemInstruction,
    } = opts;

    const config: DiagramGenerationConfig = {
        systemInstruction: extraSystemInstruction
            ? `${DIAGRAM_SYSTEM_INSTRUCTION}\n\n${extraSystemInstruction}`
            : DIAGRAM_SYSTEM_INSTRUCTION,
        temperature,
        topP,
        thinkingConfig: { thinkingBudget: THINKING_BUDGET[thinking] },
    };
    if (responseSchema) {
        config.responseSchema = responseSchema;
        config.responseMimeType = responseMimeType ?? 'application/json';
    }
    return config;
}

/** Cap generation temperature for diagram artifacts.
 *  Lower values reduce creative drift on structural output. */
export function diagramTemperature(userTemp: number | undefined): number {
    const base = typeof userTemp === 'number' ? userTemp : 0.7;
    return Math.min(base, 0.3);
}
