import { describe, it, expect } from 'vitest';
import type { AIConfig, Settings } from '../types';

describe('AI config defaults contract', () => {
  it('supports includeChatHistoryByDefault and defaults to false when missing', () => {
    const cfg: AIConfig = {
      model: 'gemini-2.5-flash',
      temperature: 0.2,
      tone: 'Profesional',
      languageStyle: 'Conciso',
      apiKeySource: 'global',
    };
    expect(cfg.includeChatHistoryByDefault ?? false).toBe(false);
  });

  it('accepts Settings.agentMemory as an optional string[] field', () => {
    const settings: Settings = {
      globalContext: [],
      language: 'es',
      theme: 'dark',
      aiConfig: {
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        tone: 'Profesional',
        languageStyle: 'Conciso',
        apiKeySource: 'global',
      },
      agentMemory: ['Soy el Arquitecto Agente.'],
    };
    expect(Array.isArray(settings.agentMemory)).toBe(true);
    expect(settings.agentMemory?.[0]).toBe('Soy el Arquitecto Agente.');
  });

  it('treats Settings.agentMemory as optional (legacy installs)', () => {
    const settings: Settings = {
      globalContext: [],
      language: 'es',
      theme: 'dark',
      aiConfig: {
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        tone: 'Profesional',
        languageStyle: 'Conciso',
        apiKeySource: 'global',
      },
    };
    expect(settings.agentMemory).toBeUndefined();
  });
});
