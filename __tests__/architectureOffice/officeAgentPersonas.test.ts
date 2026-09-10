import { describe, expect, it } from 'vitest';
import {
  OFFICE_AGENT_PERSONAS,
  resolveOfficeAgentMention,
  buildOfficePersonaInstruction,
} from '../../services/architectureOffice/officeAgentPersonas';
import {
  findAgentsThatProduce,
  findAgentsThatReview,
} from '../../services/architectureOffice/agentRegistry';

describe('officeAgentPersonas', () => {
  it('defines the thirteen approved personas with stable unique ids', () => {
    const personas = Object.values(OFFICE_AGENT_PERSONAS);
    expect(personas).toHaveLength(13);
    expect(new Set(personas.map((persona) => persona.id)).size).toBe(13);
    expect(personas.map((persona) => persona.id).sort()).toEqual([
      'alejandro',
      'arky',
      'carmen',
      'daniel',
      'elena',
      'felipe',
      'gabriel',
      'lucia',
      'mauricio',
      'natalia',
      'ricardo',
      'sofia',
      'tomas',
    ]);
  });

  it('covers the insurance domain with dedicated specialists', () => {
    expect(OFFICE_AGENT_PERSONAS.sofia.domains).toContain('claims');
    expect(OFFICE_AGENT_PERSONAS.daniel.domains).toContain('actuarial');
    expect(OFFICE_AGENT_PERSONAS.carmen.domains).toContain('compliance');
    expect(OFFICE_AGENT_PERSONAS.carmen.standardIds).toContain('INS-REGULATORY-TRACEABILITY');
  });

  it('models Lucia as orchestrator and Alejandro as consolidator', () => {
    expect(OFFICE_AGENT_PERSONAS.lucia.capabilities).toContain('orchestrate');
    expect(OFFICE_AGENT_PERSONAS.lucia.orchestrationRole).toBe('coordinator');
    expect(OFFICE_AGENT_PERSONAS.alejandro.capabilities).toContain('consolidate');
    expect(OFFICE_AGENT_PERSONAS.alejandro.orchestrationRole).toBe('consolidator');
  });

  it('resolves explicit aliases with or without accents and leaves ordinary chat on Arky', () => {
    expect(resolveOfficeAgentMention('@Felipe diseña AWS')?.id).toBe('felipe');
    expect(resolveOfficeAgentMention('Lucía, coordina el equipo')?.id).toBe('lucia');
    expect(resolveOfficeAgentMention('@Tomas prepara el reporte')?.id).toBe('tomas');
    expect(resolveOfficeAgentMention('Explícame este artefacto')?.id).toBe('arky');
  });

  it('does not resolve aliases embedded inside a longer handle', () => {
    expect(resolveOfficeAgentMention('@Tomas2 prepara el reporte').id).toBe('arky');
    expect(resolveOfficeAgentMention('Consulta a @Felipe_extra').id).toBe('arky');
  });

  it('resolves the first alias mentioned in the text, not the first in registry order', () => {
    // `felipe` precedes `lucia` in the registry literal; the addressee is Lucía.
    expect(resolveOfficeAgentMention('@Lucía coordina con @Felipe').id).toBe('lucia');
    expect(resolveOfficeAgentMention('@Felipe revisa con @Lucía').id).toBe('felipe');
  });

  it('declares executable production and review capabilities', () => {
    // The coordinator authors nothing; every other persona with `generate`
    // declares at least one producible artifact type.
    expect(OFFICE_AGENT_PERSONAS.lucia.producesArtifactTypes).toEqual([]);
    for (const persona of Object.values(OFFICE_AGENT_PERSONAS)) {
      if (!persona.capabilities.includes('generate')) continue;
      expect(persona.producesArtifactTypes.length).toBeGreaterThan(0);
    }
    expect(findAgentsThatProduce('mermaid-erd').map((persona) => persona.id)).toContain('daniel');
    expect(findAgentsThatReview('sdd-nfr').map((persona) => persona.id)).toContain('carmen');
  });

  it('keeps at least one reviewer distinct from the producer for every producible type', () => {
    for (const persona of Object.values(OFFICE_AGENT_PERSONAS)) {
      for (const type of persona.producesArtifactTypes) {
        const reviewers = findAgentsThatReview(type).filter((candidate) => candidate.id !== persona.id);
        expect(reviewers.length, `${persona.id} → ${type}`).toBeGreaterThan(0);
      }
    }
  });

  it('adds a bounded persona block without discarding the existing base instruction', () => {
    const instruction = buildOfficePersonaInstruction(
      'BASE EXISTENTE',
      OFFICE_AGENT_PERSONAS.mauricio,
    );
    expect(instruction).toContain('BASE EXISTENTE');
    expect(instruction).toContain('Mauricio');
    expect(instruction).toContain('API-led');
    expect(instruction.length).toBeLessThan(5000);
  });
});
