import { describe, it, expect } from 'vitest';
import { AI_AGENT_DISPLAY_NAME } from '../constants';

describe('AI agent naming', () => {
  it('uses Arquitecto Agente as the canonical display name', () => {
    expect(AI_AGENT_DISPLAY_NAME).toBe('Arquitecto Agente');
  });
});
