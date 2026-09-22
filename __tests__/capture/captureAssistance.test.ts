/**
 * Qué se le cuenta al agente cuando alguien pide ayuda con un campo.
 *
 * La composición de la petición es política de producto —qué contexto viaja,
 * en qué orden, en boca de quién— y por eso es una función pura en el dominio
 * en vez de cuatro líneas dentro de un `useMemo`. Estas pruebas la fijan sin
 * renderizar nada ni llamar a nadie.
 */

import { describe, expect, it } from 'vitest';
import {
  attentionCaptureSubject,
  buildCaptureRequest,
  captureContextForAttention,
  captureContextForDeliverable,
  captureContextForInitiative,
  initiativeCaptureSubject,
  pendingFieldsForInitiative,
} from '../../services/architectureOffice/application/captureAssistance';
import { createAgentProfileOverride } from '../../services/architectureOffice/officeAgentProfile';
import type { BusinessInitiative } from '../../services/businessInitiatives';
import type { Project } from '../../services/architectureProjects';

const initiative = {
  id: 'ini-1',
  userId: 'u1',
  schemaVersion: 1,
  code: 'NEG-2026-001',
  title: 'Alta digital de clientes',
  need: 'El alta tarda cinco días y una de cada tres solicitudes se cae por el camino.',
  driver: '',
  objectives: ['Reducir el alta a menos de un día'],
  expectedOutcomes: [],
  kpis: [],
  risks: [],
  milestones: [],
  stakeholders: [],
  documents: [],
  affectedCapabilities: [],
  regulatoryDrivers: [],
  dependsOnCodes: [],
  priority: 'high',
  horizon: 'next',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as BusinessInitiative;

const project = {
  id: 'proj-1',
  name: 'Onboarding digital',
  description: 'Arquitectura del alta digital',
  projectContext: ['El core corre sobre AS/400'],
  artifacts: [{ id: 'a1', name: 'Contexto C4' }],
  initiativeIds: ['ini-1'],
} as unknown as Project;

describe('capture context', () => {
  it('names the record by code and title, as the discipline quotes it', () => {
    const context = captureContextForInitiative(initiativeCaptureSubject(initiative));
    expect(context.subject).toBe('NEG-2026-001 · Alta digital de clientes');
  });

  it('drops what is empty instead of sending a blank label', () => {
    const context = captureContextForInitiative(initiativeCaptureSubject(initiative));
    // `Driver: ` en blanco le dice a un modelo que alguien lo consideró y lo
    // dejó vacío, que no es lo que significa.
    expect(context.known.map((line) => line.label)).not.toContain('Driver');
    expect(context.known.map((line) => line.label)).toContain('Necesidad del negocio');
  });

  it('carries the initiative above an attention, with its need', () => {
    const context = captureContextForAttention(attentionCaptureSubject(project), [initiative]);
    expect(context.ancestry).toHaveLength(1);
    expect(context.ancestry[0].label).toContain('NEG-2026-001');
    expect(context.ancestry[0].value).toContain('cinco días');
  });

  it('carries both levels above a deliverable, outermost first', () => {
    const context = captureContextForDeliverable(
      { title: 'Modelo de datos', brief: '' },
      { name: 'Onboarding digital', description: 'Arquitectura del alta digital' },
      [initiative],
    );
    expect(context.ancestry.map((line) => line.label)).toEqual([
      'Iniciativa de negocio · NEG-2026-001 · Alta digital de clientes',
      'Proyecto de arquitectura · Onboarding digital',
    ]);
  });
});

describe('pending fields', () => {
  it('offers only what is missing, so the button never re-proposes what was just written', () => {
    const pending = pendingFieldsForInitiative(initiativeCaptureSubject(initiative));
    expect(pending).not.toContain('initiative.title');
    expect(pending).not.toContain('initiative.need');
    expect(pending).not.toContain('initiative.objectives');
    expect(pending).toContain('initiative.driver');
    expect(pending).toContain('initiative.kpis');
  });
});

describe('buildCaptureRequest', () => {
  const context = captureContextForInitiative(initiativeCaptureSubject(initiative));

  it('speaks in the voice of the shipped agent when nothing is configured', () => {
    const request = buildCaptureRequest({ fieldIds: ['initiative.driver'], context });
    expect(request.agentBriefing[0]).toContain('Arky');
    expect(request.agentBriefing.join('\n')).toContain('GLOBAL-ZERO-TRUST');
    expect(request.modelTier).toBe('default');
  });

  it('speaks in the voice of the configured agent when the user edited its card', () => {
    const created = createAgentProfileOverride({
      agentId: 'arky',
      userId: 'u1',
      alias: 'Ari',
      knowledge: ['El canal de corredores factura sobre AS/400'],
      memory: ['El comité rechazó exponer PHI fuera del dominio clínico'],
      modelTier: 'deep',
    });
    if (created.outcome !== 'created') throw new Error('la ficha debería aceptarse');

    const request = buildCaptureRequest({
      fieldIds: ['initiative.driver'],
      context,
      agentOverride: created.override,
    });

    // Personalizar la ficha y que la ayuda siguiera respondiendo igual sería
    // una configuración decorativa.
    const briefing = request.agentBriefing.join('\n');
    expect(briefing).toContain('Ari');
    expect(briefing).toContain('canal de corredores');
    expect(briefing).toContain('PHI fuera del dominio clínico');
    expect(request.modelTier).toBe('deep');
  });

  it('resolves each requested field to its catalogue spec', () => {
    const request = buildCaptureRequest({ fieldIds: ['initiative.kpis'], context });
    expect(request.fields[0].shape).toBe('list');
    expect(request.fields[0].constraints.join(' ')).toContain('unidad');
  });
});
