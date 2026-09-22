/**
 * Quality Gate: deterministic, iterative orchestrator that brings any
 * `DiagramIR` as close as possible to the World-Class threshold (≥ 90/100)
 * without spending an LLM call.
 *
 * Pipeline (no AI required):
 *   1. detectArchitecturalViolations  →  autoRepairIR (architectural fixes)
 *   2. autoRepairDiagramIR            →  structural / lint-driven fixes
 *   3. analyzeDiagramQuality          →  re-score
 *   4. iterate up to N passes while score keeps improving and a fix budget
 *      remains; stops as soon as score >= target or no further repairs apply.
 *
 * Returns:
 *   - the best IR seen (highest score across iterations).
 *   - the final quality report.
 *   - a flat changelog so the UI can show "the gate fixed 8 issues".
 *   - the iteration the best score was reached at (for telemetry).
 *
 * The gate never deletes user content; it only rewrites empty/broken parts
 * and synthesises missing metadata.  When the target is not reached, the
 * function still returns the best repaired IR — the caller decides whether
 * to escalate to an AI critique pass.
 */

import type { Artifact } from '../../lib/artifacts';
import type { DiagramAudience, DiagramIR } from '../../lib/diagram';
import {
    analyzeDiagramQuality,
    type DiagramQualityReport,
} from './quality/diagramQualityService';
import { detectArchitecturalViolations } from './guardrails';
import { autoRepairIR } from './autoRepair';
import {
    autoRepairDiagramIR,
    type QualityRepairChange,
} from './qualityRepair';
import { repairDiagramIRSemantics } from '../../lib/semanticRoleResolver';

export interface QualityGateOptions {
    /**
     * Source artifact context. Only `type` is required — `objective` is omitted
     * by render-time callers (they don't always have it cached) so we accept a
     * `Partial` and rely on `qualityRepair` defaults for missing fields.
     */
    artifact: Pick<Artifact, 'type'> & Partial<Pick<Artifact, 'name' | 'objective' | 'audience' | 'theme'>>;
    audience?: DiagramAudience;
    /** Target score (default 90). The gate stops as soon as this is reached. */
    targetScore?: number;
    /** Max repair passes (default 3). Each pass runs guardrails + structural repairs. */
    maxPasses?: number;
    /**
     * When true, allow visually-disruptive repairs (description fill, label
     * humanisation, id normalisation). Generation pipelines and the explicit
     * "Auto-mejorar" button set this; the render-time gate keeps it off so
     * existing diagrams render exactly as authored.
     */
    aggressive?: boolean;
}

export interface QualityGateResult {
    ir: DiagramIR;
    quality: DiagramQualityReport;
    /** True when the final score met or exceeded the target. */
    reachedTarget: boolean;
    /** Iteration index (0-based) where the best IR was produced. */
    bestPass: number;
    /** Flat list of every change applied across all passes. */
    changes: QualityGateChange[];
    /** Per-pass score evolution, useful for telemetry / UI breakdown. */
    history: Array<{ pass: number; score: number; changeCount: number }>;
}

export interface QualityGateChange extends QualityRepairChange {
    /** Source of the change for UI categorisation. */
    source: 'guardrail' | 'structural';
    pass: number;
}

const DEFAULT_TARGET = 90;
const DEFAULT_MAX_PASSES = 3;

/**
 * Run the quality gate on an IR.  Pure function: never throws, never mutates
 * the input.  Returns the best variant the deterministic pipeline can reach.
 */
export function runDiagramQualityGate(
    initial: DiagramIR,
    options: QualityGateOptions,
): QualityGateResult {
    const target = options.targetScore ?? DEFAULT_TARGET;
    const maxPasses = Math.max(1, options.maxPasses ?? DEFAULT_MAX_PASSES);
    const audience = options.audience ?? options.artifact.audience ?? 'technical';

    const allChanges: QualityGateChange[] = [];
    const history: QualityGateResult['history'] = [];

    // Defensive semantic-role normalisation runs ONCE before scoring so that
    // legacy IRs (e.g. nodes tagged `kind: 'process'` with `shape: 'person'`)
    // are scored against the corrected representation rather than the broken
    // one. The repair is idempotent — a no-op when the IR is already consistent.
    const semanticRepair = repairDiagramIRSemantics(initial, {
        diagramKind: initial.metadata?.sourceFormat,
    });
    let working: DiagramIR = semanticRepair.ir;
    const baseQuality = analyzeDiagramQuality(working);
    history.push({ pass: 0, score: baseQuality.score, changeCount: 0 });

    let bestIR = working;
    let bestQuality = baseQuality;
    let bestPass = 0;

    if (baseQuality.score >= target) {
        return {
            ir: bestIR,
            quality: bestQuality,
            reachedTarget: true,
            bestPass,
            changes: [],
            history,
        };
    }

    for (let pass = 1; pass <= maxPasses; pass++) {
        const passChanges: QualityGateChange[] = [];

        // 1) Architectural guardrails + their dedicated auto-repair.
        const violations = detectArchitecturalViolations(working, {
            type: options.artifact.type,
            audience,
        });
        if (violations.length > 0) {
            const arch = autoRepairIR(working, violations);
            if (arch.applied.length > 0) {
                working = arch.ir;
                for (const change of arch.applied) {
                    passChanges.push({ ...change, source: 'guardrail', pass });
                }
            }
        }

        // 2) Structural / lint-driven repairs. Visually-disruptive repairs
        //    (description synthesis, label humanisation, id rewriting) are
        //    gated by `aggressive` so the render path never silently mutates
        //    a persisted diagram's appearance.
        const struct = autoRepairDiagramIR(working, {
            artifact: options.artifact,
            audience,
            synthesizeDescriptions: options.aggressive ?? false,
            humaniseLabels: options.aggressive ?? false,
            normaliseIds: options.aggressive ?? false,
        });
        if (struct.applied.length > 0) {
            working = struct.ir;
            for (const change of struct.applied) {
                passChanges.push({ ...change, source: 'structural', pass });
            }
        }

        const quality = analyzeDiagramQuality(working);
        history.push({ pass, score: quality.score, changeCount: passChanges.length });
        allChanges.push(...passChanges);

        // Keep the best variant we've seen.  Defence: if a pass somehow
        // regresses the score, we still return the best snapshot rather than
        // the last one.
        if (quality.score > bestQuality.score) {
            bestIR = working;
            bestQuality = quality;
            bestPass = pass;
        }

        if (quality.score >= target) break;
        // Plateau detection: if the pass produced no changes and didn't move
        // the score, further iterations would be wasted.
        if (passChanges.length === 0) break;
    }

    return {
        ir: bestIR,
        quality: bestQuality,
        reachedTarget: bestQuality.score >= target,
        bestPass,
        changes: allChanges,
        history,
    };
}

/**
 * Compact convenience wrapper that returns the repaired IR directly.  Useful
 * for call sites that don't care about the change log (e.g. preview rendering
 * where we just want the best deterministic version of the diagram).
 */
export function quickDiagramQualityRepair(
    ir: DiagramIR,
    options: QualityGateOptions,
): DiagramIR {
    return runDiagramQualityGate(ir, options).ir;
}
