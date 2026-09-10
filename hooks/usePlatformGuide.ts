/**
 * La conversación con la guía de uso de la plataforma.
 *
 * Junta las tres mitades sin que ninguna conozca a las otras: el catálogo de
 * temas (`lib/platformGuide`), la composición de la pregunta con el reparto
 * real de agentes (`architectureOffice/application/platformGuidance`) y la
 * llamada al modelo (`services/ai`). La pantalla sólo ve `ask` y `turns`.
 *
 * La degradación es la propiedad importante y por eso vive aquí, en el punto
 * donde se sabe si la llamada salió bien: **si el modelo falla, la respuesta se
 * compone con los temas del catálogo y se marca como venida de la guía**. Una
 * ayuda que se queda en blanco cuando no hay red desaparece exactamente cuando
 * alguien está intentando entender el producto — que suele ser su primer día.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  composeGuideAnswer,
  findGuideTopics,
  PLATFORM_GUIDE_TOPICS,
  type PlatformGuideTopic,
  type PlatformGuideTurn,
} from '../lib/platformGuide';
// Por el barril: a este hook sólo se llega desde el dock, que se carga bajo
// demanda. Ver CLAUDE.md → *The barrel against the bundle*.
import {
  buildPlatformGuideRequest,
  platformGuideAgentBriefing,
} from '../services/architectureOffice';
import { platformGuideService } from '../services/ai';
import { useAgentProfileOverrides } from './useAgentProfiles';
import type { Settings } from '../types';

export interface PlatformGuideMessage extends PlatformGuideTurn {
  id: string;
  /** `guide` cuando la respuesta viene del catálogo y no de un modelo. */
  source?: 'model' | 'guide';
  /** Motivo de la degradación, en español, cuando lo hubo. */
  notice?: string;
  /** Los temas en los que se apoya, para poder ofrecer seguir leyendo. */
  topics?: PlatformGuideTopic[];
}

export interface PlatformGuideApi {
  turns: PlatformGuideMessage[];
  loading: boolean;
  /** Preguntas de arranque, para que la ayuda no abra en blanco. */
  suggestions: PlatformGuideTopic[];
  ask: (question: string) => Promise<void>;
  reset: () => void;
}

/** Las cuatro preguntas con las que abre la ayuda: la orientación primero. */
const OPENING_TOPIC_IDS = ['niveles', 'entregable', 'agentes', 'artefacto'];

export const usePlatformGuide = (settings: Settings): PlatformGuideApi => {
  const overrides = useAgentProfileOverrides();
  const [turns, setTurns] = useState<PlatformGuideMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const suggestions = useMemo(
    () => PLATFORM_GUIDE_TOPICS.filter((topic) => OPENING_TOPIC_IDS.includes(topic.id)),
    [],
  );

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const asked: PlatformGuideMessage = {
      id: `q-${Date.now().toString(36)}`,
      role: 'user',
      text: trimmed,
    };
    // El historial que viaja es el de antes de esta pregunta: mandarla dos
    // veces —como historial y como pregunta— hace que el modelo se conteste a
    // sí mismo.
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns((previous) => [...previous, asked]);
    setLoading(true);

    const request = buildPlatformGuideRequest(trimmed, { overrides, history });
    const answer = await platformGuideService.answer(request, settings, {
      agentBriefing: platformGuideAgentBriefing(overrides),
    });

    const fallbackTopics = findGuideTopics(trimmed, PLATFORM_GUIDE_TOPICS);
    setTurns((previous) => [...previous, {
      id: `a-${Date.now().toString(36)}`,
      role: 'guide',
      text: answer.ok ? answer.text : composeGuideAnswer(fallbackTopics),
      source: answer.ok ? 'model' : 'guide',
      notice: answer.ok ? undefined : answer.reason,
      topics: [...request.topics],
    }]);
    setLoading(false);
  }, [loading, turns, overrides, settings]);

  const reset = useCallback(() => setTurns([]), []);

  return { turns, loading, suggestions, ask, reset };
};
