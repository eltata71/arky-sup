/**
 * Deterministic, non-destructive document repair.
 *
 * Repairs only ever ADD or NORMALISE — user content is never replaced or
 * deleted. Section scaffolding is gated by `contract.rules.allowSectionScaffolding`
 * and uses controlled "_Pendiente de completar_" markers so the gap stays
 * visible and the artifact is flagged for human review.
 *
 * Diagram artifacts are intentionally NOT repaired here: diagram quality and
 * repair remain owned by the existing deterministic diagram pipeline.
 */

import type { ArtifactContract } from '../ArtifactContract';
import type { CompilerRepair } from '../ArtifactCompilerTypes';
import type { ContractValidationResult } from '../validators';

export interface DocumentRepairOutcome {
  content: string;
  repairs: CompilerRepair[];
}

const SECTION_ID_PREFIX = 'contract.section.';
const SECTION_ID_SUFFIX = '.missing';

const ensureTrailingNewline = (content: string): string =>
  content.endsWith('\n') ? content : `${content}\n`;

const ensureH1 = (content: string, title: string): { content: string; changed: boolean } => {
  const lines = content.split(/\r?\n/);
  if (lines.some((line) => /^#\s+\S/.test(line))) return { content, changed: false };
  const safeTitle = title.trim() || 'Artefacto';
  return { content: `# ${safeTitle}\n\n${content.trimStart()}`, changed: true };
};

const normaliseHardPlaceholders = (content: string): { content: string; replaced: number } => {
  let replaced = 0;
  const next = content
    .replace(/\b(TBD|TODO|FIXME|XXX)\b/gi, () => {
      replaced += 1;
      return '_Pendiente de completar_';
    })
    .replace(/\bPENDIENTE\b/g, () => {
      replaced += 1;
      return '_Pendiente de completar_';
    });
  return { content: next, replaced };
};

const normaliseMalformedLists = (content: string): { content: string; fixed: number } => {
  let fixed = 0;
  let insideFence = false;
  const lines = content.split(/\r?\n/).map((line) => {
    if (/^```/.test(line.trim())) {
      insideFence = !insideFence;
      return line;
    }
    if (insideFence) return line;
    const bullet = /^(\s*)([*+-])(\S.*)$/.exec(line);
    if (bullet) {
      fixed += 1;
      return `${bullet[1]}- ${bullet[3]}`;
    }
    const ordered = /^(\s*)(\d+)\)(\S.*)$/.exec(line);
    if (ordered) {
      fixed += 1;
      return `${ordered[1]}${ordered[2]}. ${ordered[3]}`;
    }
    return line;
  });
  return { content: lines.join('\n'), fixed };
};

const dedupeEmptyDuplicateHeadings = (content: string): { content: string; removed: number } => {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  const seenHeadings = new Set<string>();
  let removed = 0;
  let insideFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/.test(line.trim())) insideFence = !insideFence;
    const headingMatch = !insideFence ? /^#{1,6}\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch) {
      const key = headingMatch[1].toLowerCase().trim();
      const next = lines[i + 1] ?? '';
      const nextIsHeadingOrEnd = /^#{1,6}\s+/.test(next.trim()) || i + 1 >= lines.length || next.trim() === '';
      if (seenHeadings.has(key) && nextIsHeadingOrEnd) {
        removed += 1;
        continue;
      }
      seenHeadings.add(key);
    }
    out.push(line);
  }
  return { content: out.join('\n'), removed };
};

const missingSectionIds = (validation: ContractValidationResult): string[] => {
  const ids: string[] = [];
  for (const issue of validation.issues) {
    if (issue.code !== 'CONTRACT_MISSING_SECTION') continue;
    if (issue.id.startsWith(SECTION_ID_PREFIX) && issue.id.endsWith(SECTION_ID_SUFFIX)) {
      ids.push(issue.id.slice(SECTION_ID_PREFIX.length, -SECTION_ID_SUFFIX.length));
    }
  }
  return ids;
};

/**
 * Apply contract-aware repairs to a document. Returns the (possibly unchanged)
 * content and the list of repairs performed. Pure and never throws.
 */
export const repairAgainstContract = (params: {
  content: string;
  contract: ArtifactContract;
  validation: ContractValidationResult;
  artifactName: string;
}): DocumentRepairOutcome => {
  const { contract, validation } = params;
  const repairs: CompilerRepair[] = [];
  let working = params.content ?? '';

  // Never repair diagrams or empty documents.
  if (contract.representation === 'diagram' || working.trim().length === 0) {
    return { content: working, repairs };
  }

  // 1 — Ensure an H1 title.
  if (contract.rules.requireTitle) {
    const h1 = ensureH1(working, params.artifactName);
    if (h1.changed) {
      working = h1.content;
      repairs.push({
        id: 'repair.title',
        kind: 'structure',
        description: 'Se agregó un título principal (encabezado H1).',
        destructive: false,
      });
    }
  }

  // 2 — Scaffold missing required sections (gated by the contract).
  if (contract.rules.allowSectionScaffolding) {
    const missing = missingSectionIds(validation);
    const scaffolded: string[] = [];
    const blocks: string[] = [];
    for (const sectionId of missing) {
      const spec = contract.sections.find((s) => s.id === sectionId);
      if (!spec?.repairTemplate) continue;
      blocks.push(`${spec.repairTemplate.heading}\n\n${spec.repairTemplate.body}`);
      scaffolded.push(spec.label);
    }
    if (blocks.length > 0) {
      working = `${working.trimEnd()}\n\n${blocks.join('\n\n')}\n`;
      repairs.push({
        id: 'repair.sections',
        kind: 'section',
        description: `Se agregaron secciones faltantes con marcadores pendientes: ${scaffolded.join(', ')}.`,
        destructive: false,
      });
    }
  }

  // 3 — Normalise hard placeholders to controlled markers.
  const placeholders = normaliseHardPlaceholders(working);
  if (placeholders.replaced > 0) {
    working = placeholders.content;
    repairs.push({
      id: 'repair.placeholders',
      kind: 'normalization',
      description: `Se normalizaron ${placeholders.replaced} marcador(es) TBD/TODO/FIXME a "_Pendiente de completar_".`,
      destructive: false,
    });
  }

  // 4 — Normalise malformed list bullets.
  const lists = normaliseMalformedLists(working);
  if (lists.fixed > 0) {
    working = lists.content;
    repairs.push({
      id: 'repair.lists',
      kind: 'normalization',
      description: `Se corrigieron ${lists.fixed} viñeta(s) de lista mal formadas.`,
      destructive: false,
    });
  }

  // 5 — Remove evident empty duplicate headings.
  const dedupe = dedupeEmptyDuplicateHeadings(working);
  if (dedupe.removed > 0) {
    working = dedupe.content;
    repairs.push({
      id: 'repair.dedupe-headings',
      kind: 'cleanup',
      description: `Se eliminaron ${dedupe.removed} encabezado(s) duplicado(s) vacío(s).`,
      destructive: false,
    });
  }

  return { content: ensureTrailingNewline(working), repairs };
};
