/**
 * Context citations — the `[ctx:*]` tags a generation is asked to write
 * (plan de calidad de artefactos, 7.5b).
 *
 * A tag means something only against the context pack that numbered it, and
 * that pack is recorded in the generation's `ContextManifest` (7.5a). So every
 * question here is answered from the manifest, never from the project as it is
 * today: rebuilding the pack would renumber it, and `[ctx:tech-1]` would quietly
 * start pointing at a different technology.
 *
 * Three rules:
 *  - **A citation that does not resolve is reported, never dropped silently.**
 *    The canvas marks it; the generation trace names it; an export removes it
 *    *and says so*.
 *  - **No export carries an opaque tag.** A reader of a PDF cannot look up
 *    `[ctx:sys-2]`; it becomes a numbered note, or it goes.
 *  - **Code is never rewritten.** Fenced blocks and inline code are left as
 *    written: a tag there is an example, not a citation.
 */
import type { ContextManifest, ContextManifestCitation } from './contextManifest';

/** One bracket may cite several tags: `[ctx:tech-1, ctx:sys-2]`. */
const CITATION_GROUP = /\[ctx:([^\]\n]{1,200})\]/gi;
const TAG_KEY = /^(?:ctx:)?\s*([a-z]+-\d+)$/i;

export type ContextCitationStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'unverifiable';

export interface ContextCitationReference {
  /** Normalised key, e.g. `tech-1`. */
  key: string;
  occurrences: number;
  status: ContextCitationStatus;
  citation?: ContextManifestCitation;
}

export interface ContextCitationReview {
  /** False when the artifact has no manifest to check its citations against. */
  verifiable: boolean;
  references: ContextCitationReference[];
}

type CitationIndex = Map<string, ContextManifestCitation | null>;

const keyOf = (tag: string): string | null => {
  const match = TAG_KEY.exec(tag.trim().replace(/^\[|\]$/g, '').trim());
  return match ? match[1].toLowerCase() : null;
};

/** Every citation the manifest recorded. A key numbered twice with different entities is ambiguous (`null`). */
function citationIndex(manifest: ContextManifest | undefined): CitationIndex | null {
  if (!manifest) return null;
  const index: CitationIndex = new Map();
  for (const record of manifest.records) {
    for (const citation of record.citations ?? []) {
      const key = keyOf(citation.tag);
      if (!key) continue;
      const known = index.get(key);
      if (known === undefined) index.set(key, citation);
      else if (known && known.label !== citation.label) index.set(key, null);
    }
  }
  return index;
}

const statusOf = (key: string, index: CitationIndex | null): Pick<ContextCitationReference, 'status' | 'citation'> => {
  if (!index) return { status: 'unverifiable' };
  const found = index.get(key);
  if (found === undefined) return { status: 'unresolved' };
  if (found === null) return { status: 'ambiguous' };
  return { status: 'resolved', citation: found };
};

/** Splits on fenced code blocks and inline code; `transform` only sees prose. */
function mapProse(text: string, transform: (prose: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join('');
}

const groupKeys = (inner: string): string[] => inner.split(/[,;\s]+/).map((part) => keyOf(part)).filter((key): key is string => Boolean(key));

/** What the content cites, checked against what was actually sent. */
export function reviewContextCitations(content: string, manifest: ContextManifest | undefined): ContextCitationReview {
  const index = citationIndex(manifest);
  const counts = new Map<string, number>();
  mapProse(content, (prose) => {
    for (const match of prose.matchAll(CITATION_GROUP)) {
      for (const key of groupKeys(match[1])) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return prose;
  });
  return {
    verifiable: Boolean(index),
    references: [...counts].map(([key, occurrences]) => ({ key, occurrences, ...statusOf(key, index) })),
  };
}

/** One sentence for the trace and the person, or `null` when every citation resolves. */
export function describeCitationReview(review: ContextCitationReview): string | null {
  const broken = review.references.filter((ref) => ref.status === 'unresolved' || ref.status === 'ambiguous');
  if (!broken.length) return null;
  const names = broken.map((ref) => `ctx:${ref.key}${ref.status === 'ambiguous' ? ' (ambigua)' : ''}`).join(', ');
  return broken.length === 1
    ? `Una cita del documento no corresponde al contexto enviado al modelo: ${names}.`
    : `${broken.length} citas del documento no corresponden al contexto enviado al modelo: ${names}.`;
}

export interface CitationExport {
  content: string;
  /** In note order: note `n` is `notes[n - 1]`. */
  notes: ContextManifestCitation[];
  /** Keys taken out because nothing they could point to was recorded. */
  removed: string[];
}

/** The closing note the prompt asks for; numbered notes replace it. */
const CLOSING_NOTE = /^#{1,6}\s*[*_]*\s*contexto utilizado\s*[*_]*\s*:?\s*$[\s\S]*?(?=^#{1,6}\s|(?![\s\S]))|^\s*[*_]*\s*contexto utilizado\s*(?::\s*[*_]*|[*_]+\s*:)[^\n]*(?:\n(?!\s*\n)[^\n]*)*/gim;

/**
 * An export carries no opaque tag. Resolved citations become numbered notes,
 * listed under «Fuentes de contexto»; the rest are removed and returned in
 * `removed` so the caller can say what it took out.
 */
export function renderCitationsForExport(content: string, manifest: ContextManifest | undefined): CitationExport {
  const index = citationIndex(manifest);
  const notes: ContextManifestCitation[] = [];
  const numberOf = new Map<string, number>();
  const removed = new Set<string>();
  const body = mapProse(content, (prose) => prose
    .replace(CLOSING_NOTE, '')
    .replace(/[ \t]?\[ctx:([^\]\n]{1,200})\]/gi, (_whole, inner: string) => {
      const numbers: number[] = [];
      for (const key of groupKeys(inner)) {
        const { status, citation } = statusOf(key, index);
        if (status !== 'resolved' || !citation) { removed.add(key); continue; }
        if (!numberOf.has(key)) { notes.push(citation); numberOf.set(key, notes.length); }
        numbers.push(numberOf.get(key)!);
      }
      return numbers.length ? ` [${[...new Set(numbers)].join(', ')}]` : '';
    }))
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  const list = notes.map((note, i) => `${i + 1}. ${note.label}${note.sources.length ? ` — ${note.sources.join(', ')}` : ''}`).join('\n');
  return { content: notes.length ? `${body}\n\n## Fuentes de contexto\n\n${list}\n` : `${body}\n`, notes, removed: [...removed] };
}

/** For surfaces with no room for notes (publication slices): every tag goes. */
export const stripContextCitations = (text: string): string =>
  mapProse(text, (prose) => prose.replace(/[ \t]?\[ctx:[^\]\n]{1,200}\]/gi, ''));

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CHIP = 'ctx-chip mx-0.5 inline-flex items-center rounded-full px-1.5 py-px align-baseline text-[11px] font-medium leading-4';

function chipHtml(key: string, index: CitationIndex | null): string {
  const { status, citation } = statusOf(key, index);
  if (status === 'resolved' && citation) {
    const origin = citation.sources.length ? ` title="Fuente: ${escapeHtml(citation.sources.join(', '))}"` : '';
    return `<span class="${CHIP} bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200"${origin}>${escapeHtml(citation.label)}</span>`;
  }
  const text = status === 'unverifiable' ? `ctx:${key} · sin registro` : `ctx:${key} · cita sin resolver`;
  return `<span class="${CHIP} bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">${escapeHtml(text)}</span>`;
}

/** Canvas: each citation becomes a chip naming the entity it points to. Code is left alone. */
export function decorateContextCitationsHtml(html: string, manifest: ContextManifest | undefined): string {
  if (!/\[ctx:/i.test(html)) return html;
  const index = citationIndex(manifest);
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(CITATION_GROUP, (whole, inner: string) => {
      const keys = groupKeys(inner);
      return keys.length ? keys.map((key) => chipHtml(key, index)).join('') : whole;
    })))
    .join('');
}
