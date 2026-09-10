/**
 * The presentation deck model — what a `presentation-*` artifact deserialises
 * into.
 *
 * Moved out of the root `types.ts` for the same reason as `DiagramIR`: it is
 * one context's model, and it was making every other context's compilation
 * depend on it. The `presentation` module owns the prompt and the schema that
 * produce a deck; it should own the shape of one too.
 */


// ─── Presentation deck schema ─────────────────────────────────────────────
//
// Artifacts whose `ArtifactType` is one of the `presentation-*` values store a
// JSON-serialised `PresentationDeck` inside `Artifact.content` so the slide
// viewer / PPTX exporter can render them as a real deck instead of a long
// document. The schema is intentionally narrow so the AI prompt can hit it
// reliably and so legacy markdown content can still be tolerated as a
// fallback when parsing fails.

export type PresentationLayout =
  | 'titleSlide'
  | 'executiveSummary'
  | 'sectionDivider'
  | 'twoColumn'
  | 'problemSolution'
  | 'architectureOverview'
  | 'roadmap'
  | 'riskMatrix'
  | 'decisionSlide'
  | 'diagramFocused'
  | 'comparisonTable'
  | 'timeline'
  | 'metricsKpi'
  | 'closingSlide';

export type PresentationBlockKind =
  | 'text'
  | 'bullets'
  | 'table'
  | 'diagram'
  | 'imagePlaceholder'
  | 'kpi'
  | 'callout';

export interface PresentationTableContent {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface PresentationKpiContent {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'flat';
  detail?: string;
}

export interface PresentationCalloutContent {
  tone: 'info' | 'success' | 'warning' | 'risk';
  title?: string;
  body: string;
}

export interface PresentationDiagramContent {
  /** Mermaid source (preferred), or a one-line description if no syntax exists. */
  mermaid?: string;
  description?: string;
  /** Optional reference to a sibling artifact whose diagram should be embedded. */
  artifactId?: string;
}

export type PresentationBlockContent =
  | string
  | string[]
  | PresentationTableContent
  | PresentationKpiContent
  | PresentationKpiContent[]
  | PresentationCalloutContent
  | PresentationDiagramContent;

export interface PresentationContentBlock {
  type: PresentationBlockKind;
  /** Content shape depends on `type`. See `normalizePresentationDeck` for the
   *  per-type contract. */
  content: PresentationBlockContent;
}

export interface PresentationSlide {
  id: string;
  slideNumber: number;
  title: string;
  subtitle?: string;
  purpose?: string;
  layout: PresentationLayout;
  keyMessage?: string;
  contentBlocks: PresentationContentBlock[];
  speakerNotes?: string;
  visualHints?: string[];
}

export interface PresentationDeck {
  /** Discriminator persisted with the deck so storage layers can tell a deck
   *  from any other JSON content without re-parsing. */
  kind: 'presentation';
  /** Schema version — bump on breaking changes. */
  version: string;
  title: string;
  audience: 'executive' | 'technical' | 'mixed';
  theme?: 'dark' | 'light';
  slides: PresentationSlide[];
  metadata?: {
    templateId?: string;
    generatedAt?: string;
    projectId?: string;
    qualityScore?: number;
    preferredExports?: string[];
  };
}
