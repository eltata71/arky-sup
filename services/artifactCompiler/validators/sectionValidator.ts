/**
 * Deterministic structural analysis of an artifact's textual content.
 *
 * Pure helpers (no AI, no side effects) used by the contract validator. The
 * keyword/heading detection deliberately mirrors `documentQualityService` so
 * the compiler and the quality service never disagree about a section.
 */

import { normalizeForMatch } from '../ArtifactContract';

export interface HeadingInfo {
  level: number;
  text: string;
  /** Line index in the source content. */
  line: number;
}

export interface DocumentStructure {
  wordCount: number;
  headings: HeadingInfo[];
  headingCount: number;
  h1Count: number;
  /** Normalised heading texts that appear more than once. */
  duplicateHeadings: string[];
  /** Count of uppercase TBD/TODO/FIXME/XXX/PENDIENTE markers. */
  hardPlaceholderCount: number;
  /** Count of controlled "_Pendiente_" scaffolding markers. */
  controlledPlaceholderCount: number;
  /** Headings whose body contains only controlled placeholders / nothing. */
  emptySectionCount: number;
  /** Number of Markdown tables (header + delimiter row detected). */
  tableCount: number;
  /** True when Given / When / Then all appear. */
  hasGherkin: boolean;
  /** True when more than one `Scenario:`/`Escenario` block is present. */
  hasMultipleScenarios: boolean;
  /** Detected list items that are not valid Markdown bullets. */
  malformedListLineCount: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const HARD_PLACEHOLDER_RE = /\b(TBD|TODO|FIXME|XXX)\b/gi;
const HARD_PLACEHOLDER_ES_RE = /\bPENDIENTE\b/g;
const CONTROLLED_PLACEHOLDER_RE = /_Pendiente/g;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** A bullet marker (`*`, `+`, `-`) immediately glued to word-ish content. */
const MALFORMED_LIST_RE = /^\s*[*+-](?=[^\s*+\-=|])/;
const VALID_LIST_RE = /^\s*([*+-]\s|\d+[.)]\s)/;

const stripCodeFences = (content: string): string => content.replace(/```[\s\S]*?```/g, ' ');

const countWords = (content: string): number => {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
};

/** Analyse the structure of a Markdown/plain-text document. */
export const analyzeDocumentStructure = (rawContent: string): DocumentStructure => {
  const content = rawContent ?? '';
  const lines = content.split(/\r?\n/);
  const headings: HeadingInfo[] = [];
  let insideFence = false;
  let malformedListLineCount = 0;

  lines.forEach((line, index) => {
    if (/^```/.test(line.trim())) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;
    const match = HEADING_RE.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), line: index });
      return;
    }
    if (MALFORMED_LIST_RE.test(line) && !VALID_LIST_RE.test(line)) {
      malformedListLineCount += 1;
    }
  });

  const normalisedHeadings = headings.map((h) => normalizeForMatch(h.text));
  const seen = new Set<string>();
  const duplicateSet = new Set<string>();
  for (const heading of normalisedHeadings) {
    if (seen.has(heading)) duplicateSet.add(heading);
    seen.add(heading);
  }

  // Empty-section detection: a heading immediately followed by another heading,
  // end-of-document, or a body that is only controlled placeholders.
  let emptySectionCount = 0;
  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i].line + 1;
    const end = i + 1 < headings.length ? headings[i + 1].line : lines.length;
    const body = lines.slice(start, end).join('\n').trim();
    const bodyWithoutControlled = body.replace(CONTROLLED_PLACEHOLDER_RE, '').replace(/[_>*|\-\s]/g, '');
    if (!body || bodyWithoutControlled.length === 0) emptySectionCount += 1;
  }

  let tableCount = 0;
  for (const line of stripCodeFences(content).split(/\r?\n/)) {
    if (TABLE_DELIM_RE.test(line) && line.includes('-')) tableCount += 1;
  }

  const normalisedBody = normalizeForMatch(content);
  const hasGherkin = /\bgiven\b/.test(normalisedBody)
    && /\bwhen\b/.test(normalisedBody)
    && /\bthen\b/.test(normalisedBody);
  const scenarioMatches = content.match(/\b(scenario|escenario)\b/gi) ?? [];

  const hardPlaceholderCount = (content.match(HARD_PLACEHOLDER_RE) ?? []).length
    + (content.match(HARD_PLACEHOLDER_ES_RE) ?? []).length;
  const controlledPlaceholderCount = (content.match(CONTROLLED_PLACEHOLDER_RE) ?? []).length;

  return {
    wordCount: countWords(content),
    headings,
    headingCount: headings.length,
    h1Count: headings.filter((h) => h.level === 1).length,
    duplicateHeadings: Array.from(duplicateSet),
    hardPlaceholderCount,
    controlledPlaceholderCount,
    emptySectionCount,
    tableCount,
    hasGherkin,
    hasMultipleScenarios: scenarioMatches.length > 1,
    malformedListLineCount,
  };
};

/**
 * Detect whether a section is present, by scanning headings and emphasised
 * body text for any of the contract keywords.
 */
export const isSectionPresent = (
  content: string,
  structure: DocumentStructure,
  keywords: readonly string[],
): boolean => {
  if (keywords.length === 0) return true;
  const normalisedKeywords = keywords.map(normalizeForMatch);
  const normalisedHeadings = structure.headings.map((h) => normalizeForMatch(h.text));
  if (normalisedHeadings.some((h) => normalisedKeywords.some((k) => h.includes(k)))) {
    return true;
  }
  const body = normalizeForMatch(content);
  return normalisedKeywords.some(
    (k) => body.includes(`**${k}`) || body.includes(`${k}:`) || body.includes(`| ${k}`),
  );
};
