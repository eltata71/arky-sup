import { describe, expect, it } from 'vitest';
import {
  assignDeliverable,
  rankPersonasForBrief,
} from '../../services/architectureOffice/OfficeAgentRouter';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';

describe('OfficeAgentRouter — brief ranking', () => {
  it('surfaces the specialists whose domain the brief actually mentions', () => {
    const ranked = rankPersonasForBrief('Migrar el AS/400 de siniestros y exponer APIs con MuleSoft');
    const ids = ranked.map((signal) => signal.personaId);
    expect(ids).toContain('ricardo');
    expect(ids).toContain('mauricio');
    expect(ids).toContain('sofia');
    expect(ids).not.toContain('natalia');
  });

  it('ignores accents and case', () => {
    const ids = rankPersonasForBrief('Revisión de CUMPLIMIENTO y auditoría').map((signal) => signal.personaId);
    expect(ids).toContain('carmen');
  });

  it('returns nothing for a brief with no recognisable domain', () => {
    expect(rankPersonasForBrief('hola')).toEqual([]);
  });

  it('is deterministic — the same brief ranks the same way twice', () => {
    const brief = 'Modelo de datos actuarial con cumplimiento HIPAA sobre AWS';
    expect(rankPersonasForBrief(brief)).toEqual(rankPersonasForBrief(brief));
  });

  it('explains why each persona was selected', () => {
    const ranked = rankPersonasForBrief('Diseño de integraciones MuleSoft');
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
  });
});

describe('OfficeAgentRouter — deliverable assignment', () => {
  it('only ever assigns a persona that declares the artifact type', () => {
    const assignment = assignDeliverable('mermaid-erd', 'Modelo de datos de pólizas y siniestros');
    expect(assignment).not.toBeNull();
    expect(OFFICE_AGENT_PERSONAS[assignment!.assigneeId].producesArtifactTypes).toContain('mermaid-erd');
  });

  it('always picks a reviewer distinct from the producer', () => {
    for (const type of ['markdown', 'mermaid-erd', 'yaml', 'sdd-nfr'] as const) {
      const assignment = assignDeliverable(type, 'Encargo de seguros con AWS y MuleSoft');
      expect(assignment).not.toBeNull();
      expect(assignment!.reviewerId).not.toBe(assignment!.assigneeId);
      expect(OFFICE_AGENT_PERSONAS[assignment!.reviewerId]).toBeDefined();
    }
  });

  it('lets the domain signal decide between two capable producers', () => {
    const aws = assignDeliverable('mermaid-c4-container', 'Despliegue serverless en AWS con Lambda');
    const salesforce = assignDeliverable('mermaid-c4-container', 'Modelo de Salesforce Health Cloud con Flow');
    expect(aws!.assigneeId).toBe('felipe');
    expect(salesforce!.assigneeId).toBe('natalia');
  });

  it('does not read a Salesforce product cloud as AWS work', () => {
    // "Health Cloud" and "Financial Services Cloud" are Salesforce products.
    // A bare `cloud` keyword sent them to the AWS architect.
    for (const brief of [
      'Modelo de Salesforce Health Cloud con Flow',
      'Configurar Financial Services Cloud para pólizas de vida',
    ]) {
      expect(rankPersonasForBrief(brief).map((signal) => signal.personaId)).not.toContain('felipe');
      expect(assignDeliverable('mermaid-c4-container', brief)!.assigneeId).toBe('natalia');
    }
  });

  it('still routes genuine cloud work to the AWS architect', () => {
    const brief = 'Desplegar la solución en la nube con EKS y control de costos';
    expect(assignDeliverable('mermaid-c4-container', brief)!.assigneeId).toBe('felipe');
  });

  it('routes an insurance data deliverable to the data specialist', () => {
    const assignment = assignDeliverable('mermaid-erd', 'Modelo de datos actuarial para reservas y tarificación');
    expect(assignment!.assigneeId).toBe('daniel');
  });

  it('honours the exclusion list when a persona is at capacity', () => {
    const brief = 'Despliegue serverless en AWS con Lambda';
    const first = assignDeliverable('mermaid-c4-container', brief)!;
    const second = assignDeliverable('mermaid-c4-container', brief, { excludeAssignees: [first.assigneeId] })!;
    expect(second.assigneeId).not.toBe(first.assigneeId);
  });

  it('prefers a persona already on the engagement, all else equal', () => {
    const withPreference = assignDeliverable('markdown', 'Documento sin señales de dominio', {
      preferredIds: ['ricardo'],
    });
    expect(withPreference!.assigneeId).toBe('ricardo');
  });

  it('never assigns the coordinator, who authors nothing', () => {
    for (const type of ['markdown', 'mermaid-graph', 'yaml'] as const) {
      const assignment = assignDeliverable(type, 'Coordina y orquesta el encargo completo');
      expect(assignment!.assigneeId).not.toBe('lucia');
      expect(assignment!.reviewerId).not.toBe('lucia');
    }
  });

  it('is deterministic for the same inputs', () => {
    const brief = 'Encargo de modernización de siniestros';
    expect(assignDeliverable('markdown', brief)).toEqual(assignDeliverable('markdown', brief));
  });

  it('returns null when no persona can produce the type, instead of guessing', () => {
    // `mermaid-gantt` is produced by Ricardo and Tomás; excluding both leaves
    // the router with no honest answer.
    const assignment = assignDeliverable('mermaid-gantt', 'cronograma', {
      excludeAssignees: ['ricardo', 'tomas'],
    });
    expect(assignment).toBeNull();
  });
});
