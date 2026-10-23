/**
 * What each role may be shown, and how much (plan de agentes, 19.1).
 *
 * A handoff carries references; this policy decides which kinds a role reads
 * and the token budget they share. Pure: tokens are estimated from length, not
 * counted by a tokenizer, because the policy has to run before any call.
 */

import type { HandoffContextReference } from './agentHandoff';
import type { SpecialistAnalysis } from './orchestrationContracts';

export type ContextRole = 'coordinator' | 'specialist' | 'consolidator' | 'reviewer';

export interface AgentContextPolicy {
  role: ContextRole;
  allowedKinds: readonly HandoffContextReference['kind'][];
  /** Estimated tokens the references may add up to. */
  maxTokens: number;
  /** Estimated tokens a single reference may take before it is cut. */
  maxTokensPerReference: number;
}

export const AGENT_CONTEXT_POLICIES: Readonly<Record<ContextRole, AgentContextPolicy>> = {
  coordinator: { role: 'coordinator', allowedKinds: ['record'], maxTokens: 4_000, maxTokensPerReference: 2_000 },
  specialist: { role: 'specialist', allowedKinds: ['record', 'coordination-brief'], maxTokens: 6_000, maxTokensPerReference: 3_000 },
  consolidator: { role: 'consolidator', allowedKinds: ['workstream-result', 'record'], maxTokens: 4_000, maxTokensPerReference: 500 },
  reviewer: { role: 'reviewer', allowedKinds: ['record'], maxTokens: 12_000, maxTokensPerReference: 8_000 },
};

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface ContextManifestEntry {
  kind: HandoffContextReference['kind'];
  label: string;
  tokens: number;
  /** The reference was cut to fit the policy. */
  truncated?: boolean;
}

export interface ContextManifest {
  role: ContextRole;
  entries: ContextManifestEntry[];
  totalTokens: number;
  /** References the policy dropped, by label, and why. */
  dropped: string[];
}

const cut = (text: string, maxTokens: number): { text: string; truncated: boolean } => {
  const limit = maxTokens * 4;
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit).trimEnd()}… [recortado: ${text.length - limit} caracteres más]`, truncated: true };
};

/** Applies the role's policy to a handoff's references and reports what it did. */
export const applyContextPolicy = (
  role: ContextRole,
  references: readonly HandoffContextReference[],
): { references: HandoffContextReference[]; manifest: ContextManifest } => {
  const policy = AGENT_CONTEXT_POLICIES[role];
  const kept: HandoffContextReference[] = [];
  const entries: ContextManifestEntry[] = [];
  const dropped: string[] = [];
  let total = 0;
  for (const reference of references) {
    if (!policy.allowedKinds.includes(reference.kind)) {
      dropped.push(`${reference.label}: el rol ${role} no lee ${reference.kind}`);
      continue;
    }
    const { text, truncated } = cut(reference.content, policy.maxTokensPerReference);
    const tokens = estimateTokens(text);
    if (total + tokens > policy.maxTokens) {
      dropped.push(`${reference.label}: excede el presupuesto de ${policy.maxTokens} tokens`);
      continue;
    }
    total += tokens;
    kept.push({ ...reference, content: text });
    entries.push({ kind: reference.kind, label: reference.label, tokens, ...(truncated ? { truncated } : {}) });
  }
  return { references: kept, manifest: { role, entries, totalTokens: total, dropped } };
};

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const MAX_COMPACT_FINDINGS = 3;
const MAX_COMPACT_ITEMS = 2;

/**
 * The analysis as the consolidator reads it: the conclusion, the worst
 * findings, the risks and decisions that bear on the verdict, and what the
 * specialist says belongs elsewhere. Assumptions and evidence stay with the
 * analysis, which the person can still open.
 */
export const compactAnalysisForConsolidator = (analysis: SpecialistAnalysis): string => {
  const findings = [...analysis.findings]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .slice(0, MAX_COMPACT_FINDINGS);
  const omitted = analysis.findings.length - findings.length;
  const lines = [analysis.summary];
  if (findings.length) lines.push('Hallazgos: ' + findings.map((f) => `[${f.severity}] ${f.text}`).join(' | ') + (omitted > 0 ? ` (+${omitted} más)` : ''));
  if (analysis.risks.length) lines.push('Riesgos: ' + analysis.risks.slice(0, MAX_COMPACT_ITEMS).join(' | '));
  if (analysis.decisions.length) lines.push('Decisiones: ' + analysis.decisions.slice(0, MAX_COMPACT_ITEMS).join(' | '));
  if (analysis.outOfScope.length) lines.push('Fuera de alcance: ' + analysis.outOfScope.slice(0, MAX_COMPACT_ITEMS).map((o) => (o.belongsTo ? `${o.text} → ${o.belongsTo}` : o.text)).join(' | '));
  if (analysis.confidence) lines.push(`Confianza: ${analysis.confidence}`);
  return lines.join('\n').trim();
};

/** One line for the trace: `[ctx:consolidator 412t record:Solicitud=35 workstream-result:W1=120]`. */
export const describeContextManifest = (manifest: ContextManifest): string =>
  `[ctx:${manifest.role} ${manifest.totalTokens}t ${manifest.entries.map((e) => `${e.kind}:${e.label}=${e.tokens}${e.truncated ? '*' : ''}`).join(' ')}${manifest.dropped.length ? ` dropped=${manifest.dropped.length}` : ''}]`;
