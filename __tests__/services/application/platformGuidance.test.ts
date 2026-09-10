/**
 * Lo que la guía de uso sabe del producto.
 *
 * La prueba que importa es la que impide el desfase: el reparto de agentes se
 * lee del registro, no de un texto. Una guía que dijera «hay trece agentes» en
 * una constante mentiría el día que se añada el catorceavo, y se lo diría
 * precisamente al usuario que ha entrado a preguntar cuántos hay.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPlatformGuideBriefing,
  buildPlatformGuideRequest,
  describeAgentRoster,
  platformGuideAgentBriefing,
  PLATFORM_GUIDE_HISTORY_TURNS,
} from '../../../services/architectureOffice/application/platformGuidance';
import { OFFICE_AGENT_PERSONAS } from '../../../services/architectureOffice/officeAgentPersonas';
import type { OfficeAgentProfileOverride } from '../../../services/architectureOffice';

const AGENT_COUNT = Object.keys(OFFICE_AGENT_PERSONAS).length;

describe('describeAgentRoster', () => {
  it('cuenta los agentes que hay de verdad, y nombra a todos', () => {
    const lines = describeAgentRoster();
    expect(lines[0]).toContain(`${AGENT_COUNT} agentes`);
    for (const persona of Object.values(OFFICE_AGENT_PERSONAS)) {
      expect(lines.some((line) => line.includes(persona.alias))).toBe(true);
    }
  });

  it('habla de la Oficina que ve el usuario, no de la de fábrica', () => {
    const overrides: OfficeAgentProfileOverride[] = [{
      agentId: 'sofia',
      userId: 'u1',
      schemaVersion: 1,
      alias: 'Sofía Core',
      enabled: false,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }];
    const lines = describeAgentRoster(overrides);
    expect(lines.join('\n')).toContain('Sofía Core');
    expect(lines.join('\n')).toContain('Está desactivado.');
    expect(lines[0]).toContain('disponibles ahora mismo');
  });
});

describe('buildPlatformGuideBriefing', () => {
  it('enseña los cuatro niveles con el vocabulario del producto', () => {
    const text = buildPlatformGuideBriefing().join('\n');
    expect(text).toContain('Iniciativa de Negocio');
    expect(text).toContain('Proyecto de Arquitectura');
    expect(text).toContain('Solicitud de Entregable');
    expect(text).toContain('Artefacto');
  });
});

describe('buildPlatformGuideRequest', () => {
  it('sólo manda los temas cercanos a la pregunta, no el catálogo entero', () => {
    const request = buildPlatformGuideRequest('¿cuántos agentes hay?');
    expect(request.topics.length).toBeLessThanOrEqual(4);
    expect(request.topics.map((topic) => topic.id)).toContain('agentes');
  });

  it('sin coincidencias manda los temas de orientación en vez de nada', () => {
    const request = buildPlatformGuideRequest('xilófono zzzz');
    expect(request.topics.map((topic) => topic.id).sort()).toEqual(['agentes', 'niveles']);
  });

  it('recorta el historial que viaja', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: 'user' as const,
      text: `pregunta ${index}`,
    }));
    const request = buildPlatformGuideRequest('¿qué es una iniciativa?', { history });
    expect(request.history).toHaveLength(PLATFORM_GUIDE_HISTORY_TURNS);
    expect(request.history[request.history.length - 1].text).toBe('pregunta 19');
  });
});

describe('platformGuideAgentBriefing', () => {
  it('la ayuda la firma el generalista, con su ficha configurada', () => {
    const briefing = platformGuideAgentBriefing([{
      agentId: 'arky',
      userId: 'u1',
      schemaVersion: 1,
      alias: 'Arky de Casa',
      updatedAt: '2026-09-05T00:00:00.000Z',
    }]).join('\n');
    expect(briefing).toContain('Arky de Casa');
  });
});
