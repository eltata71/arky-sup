import { describe, expect, it } from 'vitest';
import { ARTIFACT_TEMPLATES } from '../../constants';
import {
  applyCharterRefinement,
  buildTasksFromCharter,
  inferEngagementKind,
  planCharterDeterministic,
  validateCharter,
} from '../../services/architectureOffice/OfficeEngagementPlanner';
import { findTaskCycle } from '../../services/architectureOffice/OfficeTypes';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';

const CLAIMS_BRIEF = 'Modernizar el motor de siniestros AS/400 exponiendo APIs a Salesforce Health Cloud, con modelo de datos y despliegue en AWS.';

describe('OfficeEngagementPlanner — deterministic scaffold', () => {
  it('infers the engagement kind from the brief', () => {
    expect(inferEngagementKind(CLAIMS_BRIEF)).toBe('modernization');
    expect(inferEngagementKind('Necesitamos integrar el CRM con el core vía APIs')).toBe('integration');
    expect(inferEngagementKind('Revisión de cumplimiento de Solvencia II')).toBe('compliance-review');
    expect(inferEngagementKind('Diseñar una nueva plataforma de cotización')).toBe('new-solution');
  });

  it('produces a valid charter without any AI call', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    expect(charter.provenance).toBe('deterministic');
    expect(charter.deliverables.length).toBeGreaterThan(0);
    expect(validateCharter(charter)).toEqual([]);
  });

  it('only ever proposes templates that exist in the catalogue', () => {
    const names = new Set(ARTIFACT_TEMPLATES.map((template) => template.name));
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    for (const deliverable of charter.deliverables) {
      expect(names.has(deliverable.templateName)).toBe(true);
    }
  });

  it('never assigns a producer that cannot author the artifact type', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    for (const deliverable of charter.deliverables) {
      const persona = OFFICE_AGENT_PERSONAS[deliverable.assigneeId];
      expect(persona.producesArtifactTypes).toContain(deliverable.artifactType);
    }
  });

  it('enforces separation of duties on every deliverable', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    for (const deliverable of charter.deliverables) {
      expect(deliverable.reviewerId).not.toBe(deliverable.assigneeId);
      expect(OFFICE_AGENT_PERSONAS[deliverable.reviewerId]).toBeDefined();
    }
  });

  it('brings insurance specialists into an insurance engagement', () => {
    const charter = planCharterDeterministic({
      title: 'Siniestros',
      brief: 'Rediseñar la gestión de siniestros y pólizas cumpliendo HIPAA y Solvencia II.',
    });
    const involved = new Set([
      ...charter.participantIds,
      ...charter.deliverables.map((deliverable) => deliverable.assigneeId),
      ...charter.deliverables.map((deliverable) => deliverable.reviewerId),
    ]);
    expect([...involved].some((id) => id === 'sofia' || id === 'carmen')).toBe(true);
  });

  it('respects the deliverable ceiling', () => {
    const charter = planCharterDeterministic({ title: 'Todo', brief: CLAIMS_BRIEF, maxDeliverables: 2 });
    expect(charter.deliverables.length).toBeLessThanOrEqual(2);
  });
});

describe('OfficeEngagementPlanner — task DAG', () => {
  it('pairs every production with a review by a different persona and closes with a consolidation', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    const tasks = buildTasksFromCharter('eng-1', charter);

    const productions = tasks.filter((task) => task.kind === 'produce-artifact');
    const reviews = tasks.filter((task) => task.kind === 'review-artifact');
    const consolidations = tasks.filter((task) => task.kind === 'consolidate');

    expect(productions).toHaveLength(charter.deliverables.length);
    expect(reviews).toHaveLength(charter.deliverables.length);
    expect(consolidations).toHaveLength(1);

    for (const review of reviews) {
      const producer = tasks.find((task) => task.id === review.reviewsTaskId);
      expect(producer).toBeDefined();
      expect(review.assigneeId).not.toBe(producer!.assigneeId);
      expect(review.dependsOn).toContain(producer!.id);
    }

    // The consolidation waits on every review, never on raw production.
    expect(consolidations[0].dependsOn.sort()).toEqual(reviews.map((task) => task.id).sort());
  });

  it('produces an acyclic graph whose dependencies all resolve', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    const tasks = buildTasksFromCharter('eng-1', charter);
    const ids = new Set(tasks.map((task) => task.id));

    expect(findTaskCycle(tasks)).toEqual([]);
    for (const task of tasks) {
      for (const dependency of task.dependsOn) {
        expect(ids.has(dependency)).toBe(true);
      }
    }
  });

  it('makes downstream work depend on the review of its predecessor, not the raw draft', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    const tasks = buildTasksFromCharter('eng-1', charter);
    const byId = new Map(tasks.map((task) => [task.id, task]));

    const dependentProductions = tasks.filter(
      (task) => task.kind === 'produce-artifact' && task.dependsOn.length > 0,
    );
    expect(dependentProductions.length).toBeGreaterThan(0);
    for (const task of dependentProductions) {
      for (const dependency of task.dependsOn) {
        expect(byId.get(dependency)?.kind).toBe('review-artifact');
      }
    }
  });

  it('marks exactly the dependency-free productions as ready', () => {
    const charter = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });
    const tasks = buildTasksFromCharter('eng-1', charter);
    for (const task of tasks) {
      if (task.kind !== 'produce-artifact') continue;
      expect(task.status).toBe(task.dependsOn.length === 0 ? 'ready' : 'pending');
    }
  });
});

describe('OfficeEngagementPlanner — AI refinement', () => {
  const scaffold = planCharterDeterministic({ title: 'Siniestros', brief: CLAIMS_BRIEF });

  it('keeps the scaffold when the response is not parseable', () => {
    const result = applyCharterRefinement(scaffold, 'no soy json');
    expect(result.applied).toBe(false);
    expect(result.charter).toBe(scaffold);
    expect(result.reason).toBeTruthy();
  });

  it('keeps the scaffold when the model invents a template outside the catalogue', () => {
    const result = applyCharterRefinement(scaffold, JSON.stringify({
      deliverables: [{
        templateName: 'Diagrama Cuántico Inexistente',
        assigneeId: 'felipe',
        reviewerId: 'elena',
        rationale: 'inventado',
        dependsOnTemplateNames: [],
      }],
    }));
    expect(result.applied).toBe(false);
    expect(result.charter).toBe(scaffold);
  });

  it('keeps the scaffold when the model assigns a persona that cannot produce the type', () => {
    const result = applyCharterRefinement(scaffold, JSON.stringify({
      deliverables: [{
        // Lucía coordinates; she authors nothing.
        templateName: 'Visión de la Arquitectura',
        assigneeId: 'lucia',
        reviewerId: 'elena',
        rationale: 'coordinadora',
        dependsOnTemplateNames: [],
      }],
    }));
    expect(result.applied).toBe(false);
    expect(result.charter).toBe(scaffold);
  });

  it('keeps the scaffold when producer and reviewer are the same persona', () => {
    const result = applyCharterRefinement(scaffold, JSON.stringify({
      deliverables: [{
        templateName: 'Visión de la Arquitectura',
        assigneeId: 'felipe',
        reviewerId: 'felipe',
        rationale: 'se revisa a sí mismo',
        dependsOnTemplateNames: [],
      }],
    }));
    expect(result.applied).toBe(false);
    expect(result.charter).toBe(scaffold);
  });

  it('accepts a well-formed refinement and marks its provenance', () => {
    const result = applyCharterRefinement(scaffold, JSON.stringify({
      objectives: ['Reducir el tiempo de cierre de siniestros'],
      scope: ['Visión de la Arquitectura'],
      outOfScope: ['Migración del canal de agentes'],
      constraints: ['Ventana de corte de 4 horas'],
      deliverables: [{
        templateName: 'Visión de la Arquitectura',
        assigneeId: 'felipe',
        reviewerId: 'elena',
        rationale: 'Define el estado objetivo cloud.',
        dependsOnTemplateNames: [],
      }],
    }));
    expect(result.applied).toBe(true);
    expect(result.charter.provenance).toBe('ai-refined');
    expect(result.charter.objectives).toEqual(['Reducir el tiempo de cierre de siniestros']);
    expect(result.charter.outOfScope).toEqual(['Migración del canal de agentes']);
    expect(validateCharter(result.charter)).toEqual([]);
  });

  it('rejects a refinement whose dependencies form a cycle', () => {
    const result = applyCharterRefinement(scaffold, JSON.stringify({
      deliverables: [
        {
          templateName: 'Visión de la Arquitectura',
          assigneeId: 'felipe',
          reviewerId: 'elena',
          rationale: 'a',
          dependsOnTemplateNames: ['Diagrama de Contexto (C4-N1)'],
        },
        {
          templateName: 'Diagrama de Contexto (C4-N1)',
          assigneeId: 'felipe',
          reviewerId: 'elena',
          rationale: 'b',
          dependsOnTemplateNames: ['Visión de la Arquitectura'],
        },
      ],
    }));
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/ciclo/i);
  });
});
