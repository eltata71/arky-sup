/**
 * La guía de uso de la plataforma — el contrato.
 *
 * Capa de fundación: declaraciones y dos funciones puras, sin React, sin
 * Firebase y sin IA. Está aquí abajo por la misma razón que `lib/capture`: tres
 * módulos de tres capas distintas necesitan el mismo vocabulario —el catálogo
 * de temas, la petición y la respuesta— y un contrato sin comportamiento
 * pertenece a una hoja del árbol, no al primer módulo que lo necesitó.
 *
 * La decisión de diseño que gobierna todo el fichero: **la guía tiene
 * respuestas escritas, no sólo un prompt**. Un asistente de ayuda que sólo sabe
 * llamar a un modelo deja de existir cuando el modelo falla, cuando no hay
 * clave configurada o cuando el usuario está sin conexión —que son
 * exactamente los momentos en los que alguien pregunta «¿cómo funciona esto?»—.
 * Así que el catálogo es la fuente y el modelo es el redactor: si el modelo
 * responde, redacta sobre estos temas; si no, se muestran los temas.
 */

/**
 * Un tema de la guía: una pregunta que la gente hace de verdad y su respuesta.
 *
 * `answer` se escribe en el tono en que se contestaría en voz alta, en dos o
 * tres frases. Es lo que se le enseña al usuario cuando no hay modelo, así que
 * tiene que sostenerse solo.
 */
export interface PlatformGuideTopic {
  id: string;
  /** El título del tema, tal y como se ofrece como sugerencia. */
  question: string;
  answer: string;
  /** Dónde se hace, cuando el tema describe una acción. */
  where?: string;
  /** Palabras por las que alguien buscaría este tema. Todo en minúsculas. */
  keywords: string[];
}

/** Una pregunta y su respuesta anteriores, para que la guía siga el hilo. */
export interface PlatformGuideTurn {
  role: 'user' | 'guide';
  text: string;
}

export interface PlatformGuideRequest {
  question: string;
  /** Lo que la guía sabe del producto: identidad, niveles y reparto de agentes. */
  briefing: string[];
  /** Los temas más cercanos a la pregunta. El modelo redacta sobre esto. */
  topics: readonly PlatformGuideTopic[];
  /** Las últimas vueltas de la conversación, ya recortadas por quien llama. */
  history: readonly PlatformGuideTurn[];
}

export interface PlatformGuideAnswer {
  ok: boolean;
  text: string;
  /** Los temas en los que se apoyó la respuesta, para poder citarlos. */
  topicIds: string[];
  /** `guide` cuando la respuesta sale del catálogo sin pasar por un modelo. */
  source: 'model' | 'guide';
  /** En español y visible cuando algo se degradó. */
  reason?: string;
}

/**
 * Las reglas que viajan en cada prompt de la guía.
 *
 * La primera es la que la hace útil y la que la distingue del equipo de la
 * Oficina: **esto no responde preguntas de arquitectura**. Si alguien pregunta
 * cómo modelar su dominio de siniestros, la respuesta correcta es enseñarle
 * dónde está el asistente que sí sabe hacerlo, no improvisar una arquitectura
 * desde una pantalla de ayuda.
 */
export const PLATFORM_GUIDE_RULES: readonly string[] = Object.freeze([
  'Respondes sólo sobre cómo funciona y cómo se usa esta plataforma. No resuelves preguntas de arquitectura: para eso está el equipo de la Oficina, que se abre desde la iniciativa, el proyecto o el entregable.',
  'Si lo que preguntan no está en los temas que te doy, dilo con claridad y señala dónde mirar. No inventes pantallas, botones, campos ni funciones que no aparezcan en el material.',
  'No ves los datos del usuario: no sabes cuántas iniciativas tiene ni cómo se llaman. Puedes decir dónde verlas.',
  'Contesta en español, en segunda persona, en menos de 150 palabras. Si la respuesta son pasos, numéralos.',
  'Usa el vocabulario del producto tal y como aparece en el material: iniciativa de negocio, proyecto de arquitectura, solicitud de entregable, artefacto.',
]);

const fold = (value: string): string => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

/**
 * Los temas más cercanos a una pregunta, de más a menos.
 *
 * Deliberadamente léxico y sin modelo: es lo que decide de qué se le habla al
 * modelo, y también lo que se muestra cuando no hay ninguno. Una coincidencia
 * en las palabras clave pesa más que una en el texto porque las claves las
 * escribió alguien pensando en cómo se pregunta, y el texto de la respuesta
 * comparte muchas palabras entre temas.
 */
export const findGuideTopics = (
  question: string,
  topics: readonly PlatformGuideTopic[],
  limit = 4,
): PlatformGuideTopic[] => {
  const needle = fold(question);
  const words = needle.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3);
  if (words.length === 0) return [];

  const scored = topics.map((topic) => {
    const keywords = topic.keywords.map(fold);
    const haystack = fold(`${topic.question} ${topic.answer} ${topic.where ?? ''}`);
    let score = 0;
    for (const word of words) {
      if (keywords.some((keyword) => keyword.includes(word) || word.includes(keyword))) score += 3;
      else if (haystack.includes(word)) score += 1;
    }
    return { topic, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.topic);
};

/**
 * La respuesta cuando no hay modelo: los temas, tal y como están escritos.
 *
 * No se disimula. La respuesta dice que viene de la guía, porque una respuesta
 * enlatada presentada como si la hubiera redactado alguien para esta pregunta
 * es peor que una enlatada que se declara: la segunda se puede completar
 * preguntando a una persona.
 */
export const composeGuideAnswer = (
  topics: readonly PlatformGuideTopic[],
): string => {
  if (topics.length === 0) {
    return 'No tengo un tema de la guía que cubra eso. Prueba con otras palabras, o abre el equipo de la Oficina desde una iniciativa, un proyecto o un entregable si lo que necesitas es una respuesta de arquitectura.';
  }
  return topics
    .map((topic) => [`**${topic.question}**`, topic.answer, topic.where ? `_Dónde: ${topic.where}_` : '']
      .filter(Boolean)
      .join('\n\n'))
    .join('\n\n---\n\n');
};
