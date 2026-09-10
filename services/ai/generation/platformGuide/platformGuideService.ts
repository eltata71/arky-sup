/**
 * Cómo se le pregunta a un modelo por el uso de la plataforma, y cómo se
 * desconfía de lo que devuelve.
 *
 * Un agente, una llamada. Es el mismo patrón que la captura asistida y por el
 * mismo motivo: «¿cómo pido un entregable?» es una pregunta de un solo dominio
 * con un criterio de aceptación único, y hacerla pasar por la coordinadora,
 * cuatro especialistas y el consolidador costaría varias llamadas y varios
 * segundos para producir la misma frase. El equipo de la Oficina se reserva
 * para lo que es: preguntas de arquitectura resueltas desde varios dominios a
 * la vez.
 *
 * Dos propiedades que este módulo garantiza:
 *
 * 1. **Se responde sobre el material, no sobre lo que el modelo recuerde.** Los
 *    temas de la guía viajan en el prompt y las reglas prohíben inventar
 *    pantallas. Un asistente de ayuda que se inventa un botón hace perder más
 *    tiempo del que ahorra.
 * 2. **Nunca lanza.** Cualquier fallo vuelve como `ok: false` con una frase en
 *    español; quien llama enseña entonces los temas del catálogo tal y como
 *    están escritos. Una ayuda que desaparece cuando falla el modelo
 *    desaparece justo cuando alguien la necesita.
 */

/*
 * Al contrato por ruta, no al barril de `lib/platformGuide`.
 *
 * El barril reexporta también el catálogo de temas, que aquí no se usa: lo lee
 * el hook. Entrando por el barril, el catálogo quedaba alcanzable desde dos
 * chunks perezosos distintos —éste y el del dock— y Rollup lo subía al chunk de
 * arranque, donde nadie lo abre nunca: 350,9 KB gz contra un presupuesto de
 * 350. Con esta ruta, 347,7. Es la variante de *The barrel against the bundle*
 * que CLAUDE.md todavía no tenía escrita: no siempre es código de arranque
 * entrando por un barril; a veces son dos chunks perezosos compartiendo uno.
 */
import {
  PLATFORM_GUIDE_RULES,
  type PlatformGuideAnswer,
  type PlatformGuideRequest,
  type PlatformGuideTopic,
} from '../../../../lib/platformGuide/platformGuideContracts';
import { resolveEffectiveModel } from '../../../../lib/ai/modelCatalog';
import { geminiService } from '../../../geminiService';
import { AiProxyEnforcementError } from '../../aiProxyPolicy';
import type { Settings } from '../../../../types';

/**
 * Por qué no hubo respuesta del modelo, en una frase que se pueda leer.
 *
 * El caso que importa es el despliegue sin proxy: es configuración, no una
 * caída, y no se arregla reintentando. `AiProxyEnforcementError` ya trae esa
 * frase escrita —incluida la salida que sí tiene el usuario, su propia clave en
 * Ajustes → IA—, así que se reenvía tal cual en lugar de aplanarla a un
 * genérico.
 */
const describeCallFailure = (error: unknown): string => (
  error instanceof AiProxyEnforcementError
    ? error.message
    : 'No se pudo consultar al asistente.'
);

const describeTopic = (topic: PlatformGuideTopic): string => [
  `- tema: ${topic.question}`,
  `  contenido: ${topic.answer}`,
  topic.where ? `  dónde: ${topic.where}` : '',
].filter(Boolean).join('\n');

const buildPrompt = (request: PlatformGuideRequest, agentBriefing: readonly string[]): string => [
  ...agentBriefing,
  '',
  ...request.briefing,
  '',
  'MATERIAL DE LA GUÍA (es lo único que puedes afirmar sobre el producto):',
  ...request.topics.map(describeTopic),
  '',
  ...(request.history.length > 0
    ? [
      'CONVERSACIÓN HASTA AHORA:',
      ...request.history.map((turn) => `${turn.role === 'user' ? 'Usuario' : 'Guía'}: ${turn.text}`),
      '',
    ]
    : []),
  'REGLAS:',
  ...PLATFORM_GUIDE_RULES.map((rule) => `- ${rule}`),
  '',
  `PREGUNTA: ${request.question}`,
  '',
  'Responde directamente, sin saludo ni despedida.',
].join('\n');

export const platformGuideService = {
  /**
   * Contesta una pregunta sobre el uso de la plataforma.
   *
   * `agentBriefing` es la voz del agente configurado: la ayuda la firma Arky
   * tal y como el usuario lo tenga en su ficha, no un modelo anónimo.
   */
  async answer(
    request: PlatformGuideRequest,
    settings: Settings,
    options: { agentBriefing?: readonly string[]; signal?: AbortSignal } = {},
  ): Promise<PlatformGuideAnswer> {
    const topicIds = request.topics.map((topic) => topic.id);

    if (request.question.length === 0) {
      return {
        ok: false,
        text: '',
        topicIds,
        source: 'guide',
        reason: 'Escribe una pregunta sobre cómo funciona la plataforma.',
      };
    }

    try {
      const model = resolveEffectiveModel('quick', settings).id;
      const response = await geminiService.generateContentWithFallback(
        settings,
        model,
        buildPrompt(request, options.agentBriefing ?? []),
        { temperature: 0.2 },
        { signal: options.signal },
      );
      const text = (response.text ?? '').trim();
      if (text.length === 0) {
        return {
          ok: false,
          text: '',
          topicIds,
          source: 'guide',
          reason: 'El asistente no devolvió respuesta. Te dejo lo que dice la guía.',
        };
      }
      return { ok: true, text, topicIds, source: 'model' };
    } catch (error) {
      return {
        ok: false,
        text: '',
        topicIds,
        source: 'guide',
        // Cuando el motivo se conoce, se dice. «No se pudo consultar» deja al
        // lector sin nada que hacer; «falta configurar el proxy, o usa tu clave
        // en Ajustes → IA» nombra las dos salidas que existen.
        reason: `${describeCallFailure(error)} Te dejo lo que dice la guía.`,
      };
    }
  },
};

export type PlatformGuideService = typeof platformGuideService;

export default platformGuideService;
