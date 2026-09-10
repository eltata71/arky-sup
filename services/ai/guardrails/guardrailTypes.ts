/**
 * The guardrail vocabulary: what a check found, and what that means for the call.
 *
 * Three severities, and the difference between them is what the caller is
 * allowed to do next — not how alarming the finding sounds:
 *
 *  - `warning` — the call proceeds. The finding is recorded on the trace so a
 *    reader can see it later. Anything that would stop a legitimate operation
 *    more often than it stops a real problem belongs here; a guardrail that
 *    blocks ordinary work is one somebody switches off.
 *  - `recoverable-block` — the call does not happen, and retrying the *same*
 *    request would fail the same way. Something in the input has to change
 *    first, and the finding says what.
 *  - `hard-block` — the call does not happen and must not be retried at all.
 *    Reserved for the irreversible: a credential about to be sent to a third
 *    party cannot be un-sent.
 *
 * A finding never carries the offending value. A guardrail that quotes the
 * secret it found has written it into the log it existed to protect.
 */

export type GuardrailSeverity = 'warning' | 'recoverable-block' | 'hard-block';

/** Which side of the model call a check ran on. */
export type GuardrailStage = 'input' | 'output';

export interface GuardrailFinding {
  /** Stable machine id of the rule, for analytics and for tests. */
  rule: string;
  severity: GuardrailSeverity;
  stage: GuardrailStage;
  /** What was found, in words a person can act on. Never the value itself. */
  message: string;
  /** Which part of the request or response it was found in. */
  location: string;
  /** What to do about it, when there is something to do. */
  remediation?: string;
}

export interface GuardrailVerdict {
  /** False when at least one finding blocks. */
  allowed: boolean;
  findings: readonly GuardrailFinding[];
}

const BLOCKING: ReadonlySet<GuardrailSeverity> = new Set<GuardrailSeverity>([
  'recoverable-block',
  'hard-block',
]);

/** True when this finding stops the call. */
export const isBlocking = (finding: GuardrailFinding): boolean => BLOCKING.has(finding.severity);

/** Build a verdict from the findings a stage produced. */
export function verdictOf(findings: readonly GuardrailFinding[]): GuardrailVerdict {
  return { allowed: !findings.some(isBlocking), findings };
}

/**
 * The finding a caller should report, when the verdict blocks.
 *
 * Hard blocks come first: when a prompt carries both a credential and a
 * suspicious instruction, the credential is the one that must be named, because
 * it is the one that cannot be undone.
 */
export function blockingFinding(verdict: GuardrailVerdict): GuardrailFinding | undefined {
  return (
    verdict.findings.find((f) => f.severity === 'hard-block')
    ?? verdict.findings.find((f) => f.severity === 'recoverable-block')
  );
}
