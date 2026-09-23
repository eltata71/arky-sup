/**
 * `emitGenerationPhase` — the observational event stream of a generation,
 * next to the event it emits.
 *
 * It left the engine in F5-01 (corte 4) because two verticals emit it: artifact
 * generation, still inside `services/geminiService`, and the custom-artifact
 * recommendation, which is not. A helper both need cannot live in the file one
 * of them is leaving — importing it back would keep the edge the cut removes —
 * and placing it inside `services/ai` would make the engine reach past that
 * module's door. It has no dependency beyond the event type, so it is a leaf.
 */
import type { ArtifactGenerationPhaseEvent, ArtifactGenerationPhaseListener } from './artifactModel';

/**
 * Defensive wrapper that emits an `ArtifactGenerationPhaseEvent` to an optional
 * listener. The wrapper:
 *  - Never throws — listener errors are swallowed so generation isn't aborted
 *    by a bad consumer (the listener is purely observational).
 *  - Stamps `at` and the `durationMs` since the previous emission of the same
 *    stage when the caller passes a `lastAt` map.
 *  - Forwards a console signal too so server logs stay rich even when no UI
 *    listener is attached.
 */
export function emitGenerationPhase(
    listener: ArtifactGenerationPhaseListener | undefined,
    event: Omit<ArtifactGenerationPhaseEvent, 'at'> & { at?: string },
    timings?: Map<string, number>,
): ArtifactGenerationPhaseEvent {
    const now = Date.now();
    const at = event.at ?? new Date(now).toISOString();
    let durationMs = event.durationMs;
    if (timings) {
        const previous = timings.get(event.stage);
        if (typeof previous === 'number') {
            durationMs = durationMs ?? Math.max(0, now - previous);
        }
        if (event.status !== 'in-progress') {
            timings.delete(event.stage);
        } else {
            timings.set(event.stage, now);
        }
    }
    const finalEvent: ArtifactGenerationPhaseEvent = {
        ...event,
        at,
        ...(durationMs !== undefined ? { durationMs } : {}),
    };
    if (listener) {
        try {
            listener(finalEvent);
        } catch (err) {
            // Never let a UI consumer break the generation pipeline.
            console.warn('[gen-phase] phase listener threw', err);
        }
    }
    // Always trace to console so observability survives in CI / headless runs.
    const tag = `[gen-phase] ${finalEvent.stage}.${finalEvent.status}`;
    if (finalEvent.status === 'error') {
        console.warn(tag, finalEvent.message, finalEvent.detail ?? '', finalEvent.meta ?? '');
    } else {
        console.info(tag, finalEvent.message, finalEvent.meta ?? '');
    }
    return finalEvent;
}
