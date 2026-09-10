/**
 * Proactive recommendation detector.
 *
 * After the assistant streams a response, this module scans the MODEL reply
 * for actionable patterns: "podrías regenerar…", "te recomiendo aplicar…",
 * "sugiero modificar…", etc. When it finds one, it returns a candidate
 * suggestion that the `AssistantPanel` surfaces as a one-click follow-up
 * (no extra user typing required).
 *
 * This complements — does NOT replace — the heuristic intent classifier:
 *  - `classifyAgentIntent` reacts to USER input.
 *  - `detectProactiveSuggestion` reacts to MODEL output.
 *
 * Both feed the same `AgentActionPlan` machinery so the UI flow stays
 * identical regardless of who initiated the action.
 */

import type { AgentIntentType } from './agentTypes';

export interface ProactiveSuggestion {
  intentType: Exclude<AgentIntentType, 'unknown' | 'artifact.explainOnly' | 'artifact.createVersion' | 'artifacts.batch'>;
  /** One-line label for the proactive action button. */
  label: string;
  /** The user-style instruction we'll feed into the planner. */
  derivedInstruction: string;
  /** Confidence the model is actually proposing this — 0..1. */
  confidence: number;
}

interface DetectorRule {
  intentType: ProactiveSuggestion['intentType'];
  patterns: RegExp[];
  label: string;
  buildInstruction: (matchedText: string) => string;
  confidence: number;
}

const RULES: DetectorRule[] = [
  {
    intentType: 'artifact.improve',
    patterns: [
      /\b(te recomiendo|recomiendo|sugiero) (mejorar|aplicar mejoras|optimizar|refactor(izar|ear))\b/i,
      /\b(podr[íi]as|valdr[íi]a la pena|conviene) (mejorar|optimizar|refinar) (este|el) (artefacto|diagrama|documento)\b/i,
      /\bmi recomendaci[oó]n es (mejorar|aplicar)\b/i,
    ],
    label: 'Aplicar esta mejora',
    buildInstruction: (text) => `Aplica al artefacto la mejora recomendada: ${text}`,
    confidence: 0.7,
  },
  {
    intentType: 'artifact.regenerate',
    patterns: [
      /\b(te recomiendo|recomiendo|sugiero) (regenerar|rehacer|reconstruir) (este|el) (artefacto|diagrama|documento)\b/i,
      /\b(la mejor opci[oó]n|lo m[aá]s recomendable) es regenerar\b/i,
    ],
    label: 'Regenerar con esta recomendación',
    buildInstruction: (text) => `Regenera el artefacto incorporando la recomendación: ${text}`,
    confidence: 0.72,
  },
  {
    intentType: 'artifact.patch',
    patterns: [
      /\b(deber[íi]as|podr[íi]as|te sugiero|sugiero) (cambiar|renombrar|corregir|ajustar|reemplazar)\b/i,
      /\b(propongo|recomiendo) (cambiar|renombrar|corregir|ajustar|reemplazar) (el|la|los|las|de|del) /i,
    ],
    label: 'Aplicar este cambio',
    buildInstruction: (text) => `Aplica el cambio puntual sugerido: ${text}`,
    confidence: 0.68,
  },
];

const MAX_INSTRUCTION_LENGTH = 360;

/**
 * Scan a model response. Returns the strongest proactive suggestion, or
 * `null` if nothing actionable is found.
 *
 * Pure / sync — safe to call from render. Bounded by content length.
 */
export function detectProactiveSuggestion(modelResponse: string): ProactiveSuggestion | null {
  if (!modelResponse || modelResponse.length < 24) return null;
  // Process the response sentence-by-sentence so the matched snippet is small
  // enough to use as the instruction.
  const sentences = modelResponse
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < MAX_INSTRUCTION_LENGTH);

  let best: ProactiveSuggestion | null = null;
  for (const sentence of sentences) {
    for (const rule of RULES) {
      if (rule.patterns.some((re) => re.test(sentence))) {
        const candidate: ProactiveSuggestion = {
          intentType: rule.intentType,
          label: rule.label,
          derivedInstruction: rule.buildInstruction(truncate(sentence, MAX_INSTRUCTION_LENGTH)),
          confidence: rule.confidence,
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
      }
    }
  }
  return best;
}

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
