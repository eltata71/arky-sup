/**
 * La guía de uso: su catálogo, su búsqueda y su respuesta sin modelo.
 *
 * Lo que se prueba es la propiedad que justifica que el catálogo exista: que la
 * ayuda **sigue contestando cuando no hay modelo**. Si esto se rompe, el
 * asistente desaparece justo el día en que alguien entra por primera vez y no
 * hay clave configurada.
 */

import { describe, it, expect } from 'vitest';
import {
  composeGuideAnswer,
  findGuideTopics,
  PLATFORM_GUIDE_RULES,
  PLATFORM_GUIDE_TOPICS,
} from '../../lib/platformGuide';

describe('el catálogo', () => {
  it('no tiene ids repetidos: cada tema se cita una sola vez', () => {
    const ids = PLATFORM_GUIDE_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada tema se sostiene solo: pregunta, respuesta y palabras clave', () => {
    for (const topic of PLATFORM_GUIDE_TOPICS) {
      expect(topic.question.length).toBeGreaterThan(10);
      expect(topic.answer.length).toBeGreaterThan(60);
      expect(topic.keywords.length).toBeGreaterThan(2);
      // Las claves se comparan en minúsculas y sin acentos: guardarlas de otra
      // forma haría que la búsqueda fallara sin que nadie lo notara.
      expect(topic.keywords).toEqual(topic.keywords.map((keyword) => keyword.toLowerCase()));
    }
  });

  it('cubre las preguntas que motivaron la guía', () => {
    const ids = PLATFORM_GUIDE_TOPICS.map((topic) => topic.id);
    expect(ids).toEqual(expect.arrayContaining([
      'niveles', 'iniciativa', 'proyecto', 'entregable', 'artefacto', 'agentes', 'seguimiento',
    ]));
  });

  it('la primera regla acota el alcance a la plataforma', () => {
    expect(PLATFORM_GUIDE_RULES[0]).toContain('cómo funciona');
  });
});

describe('findGuideTopics', () => {
  it('encuentra el tema por sus palabras clave, con o sin acentos', () => {
    expect(findGuideTopics('¿cuántos agentes hay?', PLATFORM_GUIDE_TOPICS)[0].id).toBe('agentes');
    expect(findGuideTopics('como pido un entregable', PLATFORM_GUIDE_TOPICS)[0].id).toBe('entregable');
  });

  it('encuentra el seguimiento cuando preguntan por el avance de un proyecto', () => {
    const found = findGuideTopics('cómo veo el avance de un proyecto', PLATFORM_GUIDE_TOPICS);
    expect(found.map((topic) => topic.id)).toContain('seguimiento');
  });

  it('devuelve vacío cuando no hay nada parecido, en vez del primer tema', () => {
    expect(findGuideTopics('xilófono zzzz', PLATFORM_GUIDE_TOPICS)).toEqual([]);
  });

  it('respeta el límite pedido', () => {
    expect(findGuideTopics('proyecto artefacto iniciativa agente', PLATFORM_GUIDE_TOPICS, 2))
      .toHaveLength(2);
  });
});

describe('composeGuideAnswer', () => {
  it('sin temas, dice que no lo cubre y adónde ir', () => {
    const text = composeGuideAnswer([]);
    expect(text).toContain('No tengo un tema');
    expect(text).toContain('Oficina');
  });

  it('con temas, devuelve lo que dicen, con su dónde', () => {
    const topic = PLATFORM_GUIDE_TOPICS.find((entry) => entry.id === 'agentes');
    const text = composeGuideAnswer(topic ? [topic] : []);
    expect(text).toContain(topic?.question ?? '');
    expect(text).toContain('Dónde');
  });
});
