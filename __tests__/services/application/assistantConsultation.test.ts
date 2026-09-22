/**
 * Qué sabe la Oficina de un proyecto cuando responde, y quién firma.
 *
 * Estaba dentro de un `useCallback` de `ProjectCopilotChatModal`, así que
 * comprobarlo exigía abrir el modal y hablar con un modelo.
 */

import { describe, expect, it } from 'vitest';
import {
  briefInitiative,
  briefInitiativeInDepth,
  buildInitiativeScope,
  buildProjectHubScope,
  buildProjectScope,
  buildTeamAttribution,
  initiativeDisplayName,
} from '../../../services/architectureOffice/application/assistantConsultation';
import type { Project } from '../../../services/architectureProjects';
import type { BusinessInitiative } from '../../../services/businessInitiatives';

const project = {
  id: 'p1',
  name: 'Alta digital',
  description: 'Rediseño del alta',
  projectContext: ['Sólo canal web', 'Sin cambios en core'],
  initiativeIds: ['i1'],
} as unknown as Project;

const initiative = (id: string, title: string, need: string) =>
  ({ id, title, need }) as unknown as BusinessInitiative;

describe('buildProjectScope', () => {
  it('lleva la descripción y el contexto capturado en el briefing', () => {
    const scope = buildProjectScope(project, []);
    expect(scope.briefing).toEqual([
      'Descripción: Rediseño del alta',
      'Contexto: Sólo canal web; Sin cambios en core',
    ]);
  });

  it('omite la línea de contexto cuando no hay contexto que dar', () => {
    const bare = { ...project, projectContext: [] } as unknown as Project;
    expect(buildProjectScope(bare, []).briefing).toEqual(['Descripción: Rediseño del alta']);
  });

  it('lleva como ascendencia sólo las iniciativas a las que el proyecto responde', () => {
    // Un proyecto preguntado sin su iniciativa pierde la razón por la que
    // existe, que es lo que el producto pide que viaje con cada prompt.
    const scope = buildProjectScope(project, [
      initiative('i1', 'Reducir abandono', 'El alta tarda 12 días'),
      initiative('i2', 'Otra cosa', 'No relacionada'),
    ]);
    expect(scope.ancestry).toEqual([
      { level: 'initiative', name: 'Reducir abandono', summary: 'El alta tarda 12 días' },
    ]);
  });

  it('no inventa ascendencia cuando el proyecto no cita ninguna', () => {
    const orphan = { ...project, initiativeIds: [] } as unknown as Project;
    expect(buildProjectScope(orphan, [initiative('i1', 'A', 'B')]).ancestry).toEqual([]);
  });
});

describe('buildTeamAttribution', () => {
  // Personas reales del catálogo: si un alias cambia, estas pruebas lo notan
  // en vez de seguir pasando contra nombres inventados.
  const team = [
    { role: 'coordinator', personaId: 'arky' },
    { role: 'specialist', personaId: 'alejandro' },
  ] as never;

  it('firman los especialistas, no el coordinador', () => {
    // La premisa del producto: el asistente es el mostrador de una oficina y
    // quien responde es el equipo.
    const line = buildTeamAttribution({ status: 'complete', team });
    expect(line).toContain('Respuesta del equipo de la Oficina');
    expect(line).toContain('Alejandro');
    expect(line).not.toContain('Arky');
  });

  it('dice cuando la respuesta es parcial', () => {
    // Una respuesta incompleta presentada como completa es peor que una que
    // avisa.
    expect(buildTeamAttribution({ status: 'partial', team }))
      .toContain('no pudo entregar su análisis');
  });

  it('no firma un fallo', () => {
    // Poner nombres propios bajo un fallo sugiere que alguien revisó algo que
    // no se llegó a revisar.
    expect(buildTeamAttribution({ status: 'failed', team })).toBe('');
  });
});


describe('initiativeDisplayName', () => {
  it('antepone el código cuando lo hay — es lo que se cita en un comité', () => {
    expect(initiativeDisplayName({ code: 'NEG-2026-001', title: 'Alta digital' } as never))
      .toBe('NEG-2026-001 · Alta digital');
  });

  it('usa el título a secas cuando el código degradó a vacío', () => {
    // `BusinessInitiative.code` es `BusinessInitiativeCode | ''`: un código
    // malformado degrada a vacío en vez de a algo verosímil.
    expect(initiativeDisplayName({ code: '', title: 'Alta digital' } as never)).toBe('Alta digital');
  });
});

describe('los dos briefings de una iniciativa', () => {
  const full = {
    id: 'i1', code: 'NEG-2026-001', title: 'Alta digital',
    need: 'El alta tarda 12 días',
    driver: 'Regulación',
    objectives: ['Bajar a 2 días'],
    expectedOutcomes: [{ statement: 'Menos abandono' }],
    kpis: [{ name: 'TTV' }],
    risks: [{ description: 'Dependencia del core' }],
  } as unknown as Parameters<typeof briefInitiativeInDepth>[0];

  it('el corto enmarca la pregunta desde una tarjeta', () => {
    expect(briefInitiative(full)).toEqual([
      'Necesidad: El alta tarda 12 días',
      'Driver: Regulación',
      'Objetivos: Bajar a 2 días',
    ]);
  });

  it('el corto omite lo que no hay en vez de dejar una línea vacía', () => {
    const bare = { ...full, driver: '', objectives: [] } as never;
    expect(briefInitiative(bare)).toEqual(['Necesidad: El alta tarda 12 días']);
  });

  it('el profundo añade resultados, indicadores, riesgos y quién la atiende', () => {
    const briefing = briefInitiativeInDepth(full, [{ name: 'Rediseño de alta' }]);
    expect(briefing).toContain('Resultados esperados: Menos abandono');
    expect(briefing).toContain('Indicadores: TTV');
    expect(briefing).toContain('Riesgos: Dependencia del core');
    expect(briefing).toContain('Proyectos de arquitectura que ya la atienden: Rediseño de alta');
  });

  it('el profundo no menciona atenciones cuando no hay ninguna', () => {
    // Decir «los atienden: » con la lista vacía es peor que no decirlo.
    expect(briefInitiativeInDepth(full, []).join(' ')).not.toContain('ya la atienden');
  });
});

describe('buildInitiativeScope', () => {
  it('nombra la iniciativa con su código y lleva el briefing que le den', () => {
    const initiative = { id: 'i1', code: 'NEG-2026-001', title: 'Alta' } as never;
    const scope = buildInitiativeScope(initiative, ['Necesidad: x']);
    expect(scope).toEqual({
      level: 'initiative',
      id: 'i1',
      name: 'NEG-2026-001 · Alta',
      briefing: ['Necesidad: x'],
    });
  });
});

describe('buildProjectHubScope', () => {
  const hubProject = {
    id: 'p1', name: 'Alta digital', description: 'Rediseño',
    projectContext: ['Sólo web'],
    artifacts: [{ name: 'Contexto C4' }, { name: 'Contexto C4' }],
    initiativeIds: ['i1'],
  } as unknown as Project;

  it('cuenta qué artefactos existen ya, sin repetir nombres', () => {
    const scope = buildProjectHubScope(hubProject, []);
    expect(scope.briefing).toContain('Artefactos existentes: Contexto C4');
  });

  it('nombra la ascendencia con el código de la iniciativa', () => {
    const scope = buildProjectHubScope(hubProject, [
      initiative('i1', 'Reducir abandono', 'Tarda mucho'),
    ]);
    expect(scope.ancestry?.[0].name).toContain('Reducir abandono');
  });

  it('difiere de `buildProjectScope` a propósito, y queda anotado', () => {
    // El copiloto no cuenta los artefactos; el hub sí. No parece una decisión,
    // pero unificarlo cambia lo que responde el modelo y va en su propio commit.
    const hub = buildProjectHubScope(hubProject, []);
    const copilot = buildProjectScope(hubProject, []);
    expect(hub.briefing.join(' ')).toContain('Artefactos existentes');
    expect(copilot.briefing.join(' ')).not.toContain('Artefactos existentes');
  });
});
