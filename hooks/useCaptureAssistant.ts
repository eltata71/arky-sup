/**
 * El puente de React para la captura asistida.
 *
 * Lo que aporta —y lo único— es *cuándo* se recalcula y qué llamada sigue viva:
 * el estado por campo, la cancelación de la anterior cuando el usuario pulsa
 * otro botón y el desmontaje limpio. La política de qué se pregunta vive en
 * `services/architectureOffice/application/captureAssistance` y la ejecución en
 * `services/ai`, que es el reparto que ya usan `useArtifactAssessment` y
 * `assistantConsultation`.
 *
 * Entra por los dos barriles a propósito. `CLAUDE.md` lo dice al revés de como
 * suena: *un barril desde código perezoso, una ruta de fichero desde el
 * arranque*. Este hook sólo lo importan pantallas cargadas con
 * `lazyWithRetry`, así que la puerta correcta es la principal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalAppContext } from '../context/AppContext';
import { captureAssistantService } from '../services/ai';
import {
  buildCaptureRequest,
  CAPTURE_AGENT_ID,
  type OfficeAgentProfileOverride,
} from '../services/architectureOffice';
import { useAgentProfileOverride } from './useAgentProfiles';
import type {
  CaptureContext,
  CaptureFieldId,
  CaptureFieldSuggestion,
  CaptureSuggestionResult,
} from '../lib/capture';

export interface CaptureAssistantState {
  /** El campo que se está resolviendo ahora, o `null`. */
  pendingField: CaptureFieldId | 'form' | null;
  /** Lo propuesto, por campo. Se conserva hasta que el usuario lo aplica o lo descarta. */
  suggestions: Partial<Record<CaptureFieldId, CaptureFieldSuggestion>>;
  /** Lo que el asistente no pudo deducir y hay que preguntarle al negocio. */
  openQuestions: string[];
  /** Mensaje en español cuando la última petición no dio nada. */
  notice: string | null;
}

export interface CaptureAssistantApi extends CaptureAssistantState {
  /** Pide ayuda para un campo. */
  askField: (
    fieldId: CaptureFieldId,
    context: CaptureContext,
    current?: string,
  ) => Promise<CaptureSuggestionResult>;
  /** Pide ayuda para varios campos de una vez — el botón del formulario. */
  askForm: (
    fieldIds: readonly CaptureFieldId[],
    context: CaptureContext,
  ) => Promise<CaptureSuggestionResult>;
  /** Quita la propuesta de un campo, la haya aplicado el usuario o no. */
  dismiss: (fieldId: CaptureFieldId) => void;
  /** Vacía todo: se usa al cerrar un diálogo. */
  reset: () => void;
}

const EMPTY_STATE: CaptureAssistantState = {
  pendingField: null,
  suggestions: {},
  openQuestions: [],
  notice: null,
};

export const useCaptureAssistant = (
  /** Sólo para pruebas y para un llamador que ya tenga la ficha cargada. */
  agentOverride?: OfficeAgentProfileOverride,
): CaptureAssistantApi => {
  /*
   * Quien asiste es el agente **configurado**, no la persona de fábrica. Si la
   * ficha de Arky no llegara hasta aquí, personalizarla sería decorativo: el
   * usuario le añadiría el conocimiento de su compañía y los formularios
   * seguirían respondiendo igual. Va contra la caché del repositorio, así que
   * seis formularios abiertos no son seis lecturas.
   */
  const storedOverride = useAgentProfileOverride(CAPTURE_AGENT_ID);
  const override = agentOverride ?? storedOverride;
  /*
   * Opcional a propósito. Estos controles viven dentro de diálogos que también
   * se montan sueltos —en una prueba de componente, en un inspector— y un hook
   * que revienta fuera del proveedor convierte «este botón no puede llamar al
   * modelo aquí» en «esta pantalla no renderiza». Sin ajustes no hay modelo que
   * resolver, así que la petición se rechaza antes de salir.
   */
  const app = useOptionalAppContext();
  const settings = app?.settings;
  const [state, setState] = useState<CaptureAssistantState>(EMPTY_STATE);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    inFlight.current?.abort();
  }, []);

  const run = useCallback(async (
    marker: CaptureFieldId | 'form',
    fieldIds: readonly CaptureFieldId[],
    context: CaptureContext,
    current?: Partial<Record<CaptureFieldId, string>>,
  ): Promise<CaptureSuggestionResult> => {
    // Una petición nueva cancela la anterior: dos respuestas en vuelo sobre el
    // mismo formulario llegan en el orden que quiera la red, y la que llega
    // tarde pisaría a la que el usuario ya está leyendo.
    if (!settings) {
      const unavailable: CaptureSuggestionResult = {
        ok: false,
        suggestions: [],
        openQuestions: [],
        reason: 'El asistente no está disponible fuera de la aplicación.',
      };
      setState((previous) => ({ ...previous, notice: unavailable.reason ?? null }));
      return unavailable;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setState((previous) => ({ ...previous, pendingField: marker, notice: null }));

    const result = await captureAssistantService.suggest(
      buildCaptureRequest({ fieldIds, context, agentOverride: override, current }),
      settings,
      { signal: controller.signal },
    );

    if (!mounted.current || controller.signal.aborted) return result;
    if (inFlight.current === controller) inFlight.current = null;

    setState((previous) => {
      const merged = { ...previous.suggestions };
      for (const suggestion of result.suggestions) merged[suggestion.fieldId] = suggestion;
      return {
        pendingField: null,
        suggestions: merged,
        openQuestions: result.openQuestions.length > 0 ? result.openQuestions : previous.openQuestions,
        // `reason` vacío es una cancelación, no un fallo: el usuario cambió de
        // idea y no hay nada que contarle.
        notice: result.ok ? null : (result.reason || null),
      };
    });
    return result;
  }, [override, settings]);

  const askField = useCallback(
    (fieldId: CaptureFieldId, context: CaptureContext, current?: string) =>
      run(fieldId, [fieldId], context, current ? { [fieldId]: current } : undefined),
    [run],
  );

  const askForm = useCallback(
    (fieldIds: readonly CaptureFieldId[], context: CaptureContext) =>
      run('form', fieldIds, context),
    [run],
  );

  const dismiss = useCallback((fieldId: CaptureFieldId) => {
    setState((previous) => {
      const next = { ...previous.suggestions };
      delete next[fieldId];
      return { ...previous, suggestions: next };
    });
  }, []);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setState(EMPTY_STATE);
  }, []);

  return { ...state, askField, askForm, dismiss, reset };
};
