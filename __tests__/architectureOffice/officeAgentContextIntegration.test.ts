import { describe, expect, it } from 'vitest';
import { buildAgentSystemInstruction } from '../../services/agent/agentContextComposer';
import { buildOfficePersonaBriefing } from '../../services/architectureOffice/domain/officeAgentPersonas';
import type { Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';

const settings: Settings = {
  language: 'es',
  theme: 'dark',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.4,
    tone: 'Profesional',
    languageStyle: 'Conciso',
    apiKeySource: 'global',
  },
};

const project: Project = {
  id: 'PROJ-2026-001',
  name: 'ArkyPro',
  description: 'Gestión de arquitectura',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

describe('Architecture Office prompt integration', () => {
  it('does not inject Office standards into a regular Arky turn', () => {
    const instruction = buildAgentSystemInstruction({
      project,
      activeArtifact: null,
      settings,
      userQuery: 'Resume el proyecto',
    });
    expect(instruction).toContain('Arquitecto Agente');
    expect(instruction).not.toContain('Estándares de la Oficina de Arquitectura');
    expect(instruction).not.toContain('GLOBAL-API-FIRST');
  });

  it('keeps the existing Arky instruction and activates a selected specialist', () => {
    const instruction = buildAgentSystemInstruction({
      project,
      activeArtifact: null,
      settings,
      userQuery: '@Mauricio diseña la integración',
      persona: buildOfficePersonaBriefing('mauricio'),
    });
    expect(instruction).toContain('Arquitecto Agente');
    expect(instruction).toContain('Mauricio');
    expect(instruction).toContain('API-led');
    expect(instruction).toContain('GLOBAL-API-FIRST');
  });
});
