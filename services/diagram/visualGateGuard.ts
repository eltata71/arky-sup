import type { VisualGateState, VisualQualityGateResult } from './visualQualityGate';

export type GuardedAction = 'export' | 'presentation' | 'publication';

export interface GateGuardDecision {
  /** True when the action must be confirmed by the user before proceeding. */
  requireConfirmation: boolean;
  /** True when the action should be hard-blocked even with a confirmation. */
  hardBlock: boolean;
  /** Human-readable message surfaced in the confirm dialog or banner. */
  message: string;
  /** Short label for the confirm CTA. */
  confirmCta: string;
  /** Stable code identifying which hard-block rule was triggered, if any. */
  hardBlockCode?: 'EMPTY_DIAGRAM' | 'CRITICAL_RENDER_ERRORS' | 'EMERGENCY_FALLBACK';
}

const ACTION_LABEL: Record<GuardedAction, string> = {
  export: 'exportar',
  presentation: 'iniciar la presentación',
  publication: 'publicar',
};

const CAPITALIZE = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface HardBlockContext {
  /** Number of content nodes (excluding placeholder/empty) in the rendered diagram. */
  contentNodeCount?: number;
  /** Number of render errors logged for this artifact in the current session. */
  recentRenderErrors?: number;
  /** Whether the canvas is currently rendering a grid / emergency fallback. */
  isEmergencyFallback?: boolean;
}

/**
 * Hard-block thresholds. When a guarded action would yield a deliverable
 * that is provably unusable, we refuse to proceed even if the user
 * confirms. The thresholds are conservative:
 *
 *   - `EMPTY_DIAGRAM`: zero content nodes — the export would just be a
 *     blank canvas with a frame around it.
 *   - `CRITICAL_RENDER_ERRORS`: ≥ 5 render errors recorded for this
 *     artifact in the current session — the rendered canvas is almost
 *     certainly missing nodes / edges and an export would mislead.
 *   - `EMERGENCY_FALLBACK`: the canvas is on the grid fallback because
 *     the layout engine repeatedly failed; the geometry is not the
 *     diagram's real geometry.
 */
const HARD_BLOCK_RENDER_ERRORS_THRESHOLD = 5;

const evaluateHardBlock = (
  ctx: HardBlockContext | undefined,
  action: GuardedAction,
): { hardBlock: boolean; code?: NonNullable<GateGuardDecision['hardBlockCode']>; reason?: string } => {
  if (!ctx) return { hardBlock: false };
  if (typeof ctx.contentNodeCount === 'number' && ctx.contentNodeCount === 0) {
    return {
      hardBlock: true,
      code: 'EMPTY_DIAGRAM',
      reason: `No hay nodos renderizados. ${CAPITALIZE(ACTION_LABEL[action])} produciría una salida vacía.`,
    };
  }
  if (typeof ctx.recentRenderErrors === 'number' && ctx.recentRenderErrors >= HARD_BLOCK_RENDER_ERRORS_THRESHOLD) {
    return {
      hardBlock: true,
      code: 'CRITICAL_RENDER_ERRORS',
      reason: `Se acumularon ${ctx.recentRenderErrors} errores de render en esta sesión. La salida no es confiable.`,
    };
  }
  if (ctx.isEmergencyFallback) {
    return {
      hardBlock: true,
      code: 'EMERGENCY_FALLBACK',
      reason: 'El canvas está en modo grid de emergencia porque el motor de layout falló repetidamente. La geometría no es real.',
    };
  }
  return { hardBlock: false };
};

/**
 * Visual Quality Gate guard (Brecha 3).
 *
 * The visual quality gate produces three states: `ready`, `warnings`,
 * `blocked`. Until now the state was only surfaced as a coloured badge in
 * the quality panel — exports and presentations went through regardless.
 *
 * This guard turns the gate into an actionable contract: `blocked` requires
 * an explicit user override, `warnings` raises a soft confirmation only for
 * audience-facing actions (presentation, publication), and `ready` never
 * interrupts the user. Returns a small DSL the caller can render in a
 * banner or confirm dialog without coupling to UI components.
 */
export function evaluateGateGuard(
  state: VisualGateState | undefined,
  action: GuardedAction,
  hardBlockContext?: HardBlockContext,
): GateGuardDecision {
  const verb = ACTION_LABEL[action];
  // Hard-block evaluation runs first: when the deliverable would be
  // provably unusable (no nodes, repeated render errors, emergency
  // fallback), no amount of "confirm" should let the action proceed.
  const hardBlock = evaluateHardBlock(hardBlockContext, action);
  if (hardBlock.hardBlock) {
    return {
      requireConfirmation: true,
      hardBlock: true,
      hardBlockCode: hardBlock.code,
      message: hardBlock.reason ?? 'La acción está bloqueada por una condición no recuperable.',
      confirmCta: 'No disponible',
    };
  }

  if (!state || state === 'ready') {
    return {
      requireConfirmation: false,
      hardBlock: false,
      message: `Visual Quality Gate listo. Puedes ${verb} con confianza.`,
      confirmCta: 'Continuar',
    };
  }
  if (state === 'warnings') {
    // Soft confirm only for audience-facing actions; technical exports can
    // proceed without interrupting the flow.
    const needsConfirm = action === 'presentation' || action === 'publication';
    return {
      requireConfirmation: needsConfirm,
      hardBlock: false,
      message: needsConfirm
        ? `El gate detectó advertencias. Recomendamos resolverlas antes de ${verb}.`
        : `El gate detectó advertencias; ${verb} es posible pero la salida puede contener señales menores.`,
      confirmCta: needsConfirm ? `${CAPITALIZE(verb)} de todos modos` : 'Continuar',
    };
  }
  // blocked
  return {
    requireConfirmation: true,
    hardBlock: false,
    message: `El gate bloqueó el diagrama por hallazgos críticos. ${CAPITALIZE(verb)} sin resolverlos puede entregar una salida visualmente pobre.`,
    confirmCta: `${CAPITALIZE(verb)} de todos modos`,
  };
}

/**
 * Convenience helper that derives the hard-block context from a
 * VisualQualityGateResult plus a small set of runtime observations.
 * Used by ArtifactCanvas so callers don't duplicate the threshold logic.
 */
export function deriveHardBlockContext(
  gate: Pick<VisualQualityGateResult, 'signals'> | null | undefined,
  options: { contentNodeCount?: number; recentRenderErrors?: number; isEmergencyFallback?: boolean } = {},
): HardBlockContext {
  const renderErrorsFromGate = gate?.signals?.some((s) => s.code === 'RECENT_RENDER_ERRORS') ? 5 : 0;
  return {
    contentNodeCount: options.contentNodeCount,
    recentRenderErrors: options.recentRenderErrors ?? renderErrorsFromGate,
    isEmergencyFallback: options.isEmergencyFallback,
  };
}

/**
 * Convenience helper for the export modal banner: returns the tone token to
 * use ('info' | 'warn' | 'block') so the consumer styles the banner
 * consistently across surfaces.
 */
export function gateGuardTone(state: VisualGateState | undefined): 'info' | 'warn' | 'block' {
  if (state === 'blocked') return 'block';
  if (state === 'warnings') return 'warn';
  return 'info';
}
