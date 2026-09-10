/**
 * Presentation deck schema utilities.
 *
 * The AI is asked to return a JSON deck (see `buildPresentationPrompt`) but we
 * never trust the wire format blindly. `parsePresentationDeck` and
 * `normalizePresentationDeck` accept anything the model might produce — fenced
 * JSON, raw JSON, or a markdown outline — and produce a strict
 * {@link PresentationDeck} that the viewer and exporters can consume.
 *
 * The fallback path is deliberate: if a legacy artifact contains markdown
 * (e.g. a pre-migration "Presentación Ejecutiva") the deck still renders as a
 * minimal one-slide deck instead of a blank canvas.
 */
import type {
  PresentationDeck,
  PresentationSlide,
  PresentationLayout,
  PresentationContentBlock,
  PresentationBlockKind,
  PresentationTableContent,
  PresentationKpiContent,
  PresentationCalloutContent,
  PresentationDiagramContent,
  ArtifactType,
} from '../../types';

export const PRESENTATION_SCHEMA_VERSION = '1.0.0';

export const SUPPORTED_LAYOUTS: readonly PresentationLayout[] = [
  'titleSlide',
  'executiveSummary',
  'sectionDivider',
  'twoColumn',
  'problemSolution',
  'architectureOverview',
  'roadmap',
  'riskMatrix',
  'decisionSlide',
  'diagramFocused',
  'comparisonTable',
  'timeline',
  'metricsKpi',
  'closingSlide',
];

const SUPPORTED_BLOCK_KINDS: readonly PresentationBlockKind[] = [
  'text',
  'bullets',
  'table',
  'diagram',
  'imagePlaceholder',
  'kpi',
  'callout',
];

const layoutLookup = new Set<string>(SUPPORTED_LAYOUTS);
const blockKindLookup = new Set<string>(SUPPORTED_BLOCK_KINDS);

export interface PresentationParseResult {
  ok: boolean;
  deck: PresentationDeck;
  warnings: string[];
  /** True when the deck was rebuilt from fallback content (legacy markdown). */
  usedFallback: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

const safeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map(item => safeString(item)).filter(item => item.length > 0);
};

const coerceLayout = (value: unknown, fallback: PresentationLayout): PresentationLayout => {
  const candidate = safeString(value);
  if (candidate && layoutLookup.has(candidate)) return candidate as PresentationLayout;
  // Map common aliases the model emits to canonical layout ids.
  const lower = candidate.toLowerCase();
  if (lower === 'title' || lower === 'portada' || lower === 'cover') return 'titleSlide';
  if (lower === 'closing' || lower === 'cierre' || lower === 'end') return 'closingSlide';
  if (lower === 'section' || lower === 'divider' || lower === 'separator') return 'sectionDivider';
  if (lower === 'summary' || lower === 'executive') return 'executiveSummary';
  if (lower === 'risks' || lower === 'risk') return 'riskMatrix';
  if (lower === 'decisions' || lower === 'decision') return 'decisionSlide';
  if (lower === 'diagram' || lower === 'diagram-focused') return 'diagramFocused';
  if (lower === 'kpi' || lower === 'kpis' || lower === 'metrics') return 'metricsKpi';
  if (lower === 'comparison' || lower === 'compare') return 'comparisonTable';
  return fallback;
};

const coerceBlockKind = (value: unknown): PresentationBlockKind | null => {
  const candidate = safeString(value);
  if (candidate && blockKindLookup.has(candidate)) return candidate as PresentationBlockKind;
  const lower = candidate.toLowerCase();
  if (lower === 'list' || lower === 'bulletlist' || lower === 'bullet-list') return 'bullets';
  if (lower === 'paragraph' || lower === 'prose') return 'text';
  if (lower === 'mermaid') return 'diagram';
  if (lower === 'image') return 'imagePlaceholder';
  if (lower === 'note' || lower === 'alert') return 'callout';
  return null;
};

const coerceTableContent = (value: unknown): PresentationTableContent | null => {
  if (!isRecord(value)) return null;
  const headers = safeStringArray(value.headers);
  const rowsRaw = Array.isArray(value.rows) ? value.rows : [];
  const rows = rowsRaw
    .map(row => Array.isArray(row) ? row.map(cell => safeString(cell)) : [])
    .filter(row => row.length > 0);
  if (headers.length === 0 && rows.length === 0) return null;
  const caption = safeString(value.caption);
  return { headers, rows, caption: caption || undefined };
};

const coerceKpiContent = (value: unknown): PresentationKpiContent | null => {
  if (!isRecord(value)) return null;
  const label = safeString(value.label);
  const valueText = safeString(value.value);
  if (!label && !valueText) return null;
  const trendRaw = safeString(value.trend).toLowerCase();
  const trend: PresentationKpiContent['trend'] | undefined =
    trendRaw === 'up' || trendRaw === 'down' || trendRaw === 'flat' ? (trendRaw as 'up' | 'down' | 'flat') : undefined;
  const detail = safeString(value.detail);
  return { label, value: valueText, trend, detail: detail || undefined };
};

const coerceCalloutContent = (value: unknown): PresentationCalloutContent | null => {
  if (!isRecord(value)) return null;
  const toneRaw = safeString(value.tone).toLowerCase();
  const tone: PresentationCalloutContent['tone'] =
    toneRaw === 'success' || toneRaw === 'warning' || toneRaw === 'risk' ? toneRaw as PresentationCalloutContent['tone'] : 'info';
  const body = safeString(value.body) || safeString(value.text);
  if (!body) return null;
  const title = safeString(value.title);
  return { tone, body, title: title || undefined };
};

const coerceDiagramContent = (value: unknown): PresentationDiagramContent | null => {
  if (typeof value === 'string') {
    const mermaid = value.trim();
    if (!mermaid) return null;
    return { mermaid };
  }
  if (!isRecord(value)) return null;
  const mermaid = safeString(value.mermaid);
  const description = safeString(value.description);
  const artifactId = safeString(value.artifactId);
  if (!mermaid && !description && !artifactId) return null;
  return {
    mermaid: mermaid || undefined,
    description: description || undefined,
    artifactId: artifactId || undefined,
  };
};

const coerceBlock = (value: unknown): PresentationContentBlock | null => {
  if (!isRecord(value)) {
    if (typeof value === 'string') {
      const text = value.trim();
      return text ? { type: 'text', content: text } : null;
    }
    return null;
  }
  const kind = coerceBlockKind(value.type);
  if (!kind) return null;
  const rawContent = value.content;
  switch (kind) {
    case 'text': {
      const text = safeString(rawContent);
      return text ? { type: 'text', content: text } : null;
    }
    case 'bullets': {
      const bullets = safeStringArray(rawContent);
      return bullets.length > 0 ? { type: 'bullets', content: bullets } : null;
    }
    case 'table': {
      const table = coerceTableContent(rawContent);
      return table ? { type: 'table', content: table } : null;
    }
    case 'diagram': {
      const diagram = coerceDiagramContent(rawContent);
      return diagram ? { type: 'diagram', content: diagram } : null;
    }
    case 'imagePlaceholder': {
      const text = safeString(rawContent);
      return text ? { type: 'imagePlaceholder', content: text } : { type: 'imagePlaceholder', content: 'Imagen sugerida' };
    }
    case 'kpi': {
      if (Array.isArray(rawContent)) {
        const items = rawContent.map(item => coerceKpiContent(item)).filter((item): item is PresentationKpiContent => item !== null);
        return items.length > 0 ? { type: 'kpi', content: items } : null;
      }
      const single = coerceKpiContent(rawContent);
      return single ? { type: 'kpi', content: single } : null;
    }
    case 'callout': {
      const callout = coerceCalloutContent(rawContent);
      return callout ? { type: 'callout', content: callout } : null;
    }
    default:
      return null;
  }
};

const coerceSlide = (value: unknown, index: number, warnings: string[]): PresentationSlide | null => {
  if (!isRecord(value)) {
    warnings.push(`Slide #${index + 1} ignored: not an object.`);
    return null;
  }
  const title = safeString(value.title);
  if (!title) {
    warnings.push(`Slide #${index + 1} ignored: missing title.`);
    return null;
  }
  const id = safeString(value.id) || `slide-${index + 1}`;
  const slideNumberRaw = typeof value.slideNumber === 'number' ? value.slideNumber : Number(safeString(value.slideNumber));
  const slideNumber = Number.isFinite(slideNumberRaw) && slideNumberRaw > 0 ? slideNumberRaw : index + 1;
  const layoutFallback: PresentationLayout = index === 0 ? 'titleSlide' : 'executiveSummary';
  const layout = coerceLayout(value.layout, layoutFallback);
  const blocksRaw = Array.isArray(value.contentBlocks) ? value.contentBlocks : [];
  const contentBlocks = blocksRaw
    .map(block => coerceBlock(block))
    .filter((block): block is PresentationContentBlock => block !== null);
  if (contentBlocks.length === 0 && layout !== 'titleSlide' && layout !== 'sectionDivider' && layout !== 'closingSlide') {
    warnings.push(`Slide #${index + 1} has no renderable content blocks.`);
  }
  return {
    id,
    slideNumber,
    title,
    subtitle: safeString(value.subtitle) || undefined,
    purpose: safeString(value.purpose) || undefined,
    layout,
    keyMessage: safeString(value.keyMessage) || undefined,
    contentBlocks,
    speakerNotes: safeString(value.speakerNotes) || undefined,
    visualHints: safeStringArray(value.visualHints),
  };
};

const buildFallbackDeck = (raw: string, artifactType: ArtifactType | string | undefined, title: string): PresentationDeck => {
  const body = raw.trim();
  // Best-effort markdown → minimal deck: a title slide + one summary slide
  // with the prose collapsed into bullets so the viewer never blanks out.
  const audience: PresentationDeck['audience'] = artifactType === 'presentation-technical' ? 'technical'
    : artifactType === 'presentation-executive' || artifactType === 'presentation-summary' ? 'executive'
    : 'mixed';
  const summary = body
    .split(/\n+/)
    .map(line => line.replace(/^[#>\-*\s]+/, '').trim())
    .filter(line => line.length > 0)
    .slice(0, 6);
  const slides: PresentationSlide[] = [{
    id: 'slide-1',
    slideNumber: 1,
    title,
    layout: 'titleSlide',
    keyMessage: 'Contenido recuperado de un formato anterior — regenera para obtener un deck completo.',
    contentBlocks: [],
    visualHints: [],
  }];
  if (summary.length > 0) {
    slides.push({
      id: 'slide-2',
      slideNumber: 2,
      title: 'Resumen',
      layout: 'executiveSummary',
      contentBlocks: [{ type: 'bullets', content: summary }],
      speakerNotes: 'Slide derivada automáticamente del contenido anterior. Regenera para obtener un deck completo.',
      visualHints: [],
    });
  }
  return {
    kind: 'presentation',
    version: PRESENTATION_SCHEMA_VERSION,
    title,
    audience,
    slides,
    metadata: {
      generatedAt: new Date().toISOString(),
    },
  };
};

const extractJsonPayload = (raw: string): unknown | null => {
  const value = raw?.trim();
  if (!value) return null;
  // Direct parse first — Gemini's responseSchema typically returns clean JSON.
  try { return JSON.parse(value); } catch { /* fall through */ }
  // Fenced ```json blocks.
  const jsonFence = value.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence && jsonFence[1]) {
    try { return JSON.parse(jsonFence[1].trim()); } catch { /* fall through */ }
  }
  // First {...} block as a last resort.
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(value.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
};

export interface ParsePresentationOptions {
  artifactType?: ArtifactType | string;
  artifactName?: string;
}

/**
 * Parse arbitrary artifact content into a strict {@link PresentationDeck}.
 * Never throws — invalid input is rebuilt into a minimal fallback deck so the
 * viewer always has something to render and the user gets a clear nudge to
 * regenerate.
 */
export const parsePresentationDeck = (raw: string, options: ParsePresentationOptions = {}): PresentationParseResult => {
  const warnings: string[] = [];
  const fallbackTitle = options.artifactName?.trim() || 'Presentación';
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      ok: false,
      deck: buildFallbackDeck('', options.artifactType, fallbackTitle),
      warnings: ['Contenido vacío; mostrando deck mínimo.'],
      usedFallback: true,
    };
  }
  const payload = extractJsonPayload(raw);
  if (!isRecord(payload)) {
    return {
      ok: false,
      deck: buildFallbackDeck(raw, options.artifactType, fallbackTitle),
      warnings: ['No se encontró un objeto JSON válido en el contenido.'],
      usedFallback: true,
    };
  }
  const title = safeString(payload.title) || fallbackTitle;
  const audienceRaw = safeString(payload.audience).toLowerCase();
  const audience: PresentationDeck['audience'] =
    audienceRaw === 'executive' || audienceRaw === 'technical' || audienceRaw === 'mixed'
      ? audienceRaw as PresentationDeck['audience']
      : (options.artifactType === 'presentation-technical' ? 'technical'
          : options.artifactType === 'presentation-executive' || options.artifactType === 'presentation-summary' ? 'executive'
          : 'mixed');
  const themeRaw = safeString(payload.theme).toLowerCase();
  const theme: PresentationDeck['theme'] = themeRaw === 'light' ? 'light' : 'dark';
  const slidesRaw = Array.isArray(payload.slides) ? payload.slides : [];
  const slides = slidesRaw
    .map((slide, idx) => coerceSlide(slide, idx, warnings))
    .filter((slide): slide is PresentationSlide => slide !== null)
    .map((slide, idx) => ({ ...slide, slideNumber: idx + 1 }));
  if (slides.length === 0) {
    return {
      ok: false,
      deck: buildFallbackDeck(raw, options.artifactType, title),
      warnings: [...warnings, 'El JSON no contiene slides válidas.'],
      usedFallback: true,
    };
  }
  const deck: PresentationDeck = {
    kind: 'presentation',
    version: safeString(payload.version) || PRESENTATION_SCHEMA_VERSION,
    title,
    audience,
    theme,
    slides,
    metadata: isRecord(payload.metadata) ? {
      templateId: safeString(payload.metadata.templateId) || undefined,
      generatedAt: safeString(payload.metadata.generatedAt) || new Date().toISOString(),
      projectId: safeString(payload.metadata.projectId) || undefined,
      qualityScore: typeof payload.metadata.qualityScore === 'number' ? payload.metadata.qualityScore : undefined,
      preferredExports: safeStringArray(payload.metadata.preferredExports),
    } : { generatedAt: new Date().toISOString() },
  };
  return { ok: true, deck, warnings, usedFallback: false };
};

export interface PresentationValidationIssue {
  severity: 'warning' | 'error';
  message: string;
}

export interface PresentationValidationOptions {
  minSlides?: number;
  maxSlides?: number;
}

const DEFAULT_LIMITS: Required<PresentationValidationOptions> = { minSlides: 4, maxSlides: 18 };

/**
 * Validate a parsed deck against structural rules that apply to every
 * presentation regardless of template. Template-specific bounds (e.g.
 * "Resumen Ejecutivo: 5-8 slides") can be added via the options.
 */
export const validatePresentationDeck = (deck: PresentationDeck, options: PresentationValidationOptions = {}): PresentationValidationIssue[] => {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const issues: PresentationValidationIssue[] = [];
  if (deck.slides.length === 0) {
    issues.push({ severity: 'error', message: 'El deck no contiene slides.' });
    return issues;
  }
  if (deck.slides.length < limits.minSlides) {
    issues.push({ severity: 'warning', message: `El deck tiene ${deck.slides.length} slides; se recomiendan al menos ${limits.minSlides}.` });
  }
  if (deck.slides.length > limits.maxSlides) {
    issues.push({ severity: 'warning', message: `El deck tiene ${deck.slides.length} slides; se recomiendan máximo ${limits.maxSlides}.` });
  }
  const firstLayout = deck.slides[0]?.layout;
  if (firstLayout !== 'titleSlide') {
    issues.push({ severity: 'warning', message: 'La primera slide debería ser de tipo titleSlide.' });
  }
  deck.slides.forEach((slide, idx) => {
    if (!slide.title || slide.title.trim().length === 0) {
      issues.push({ severity: 'error', message: `Slide #${idx + 1}: falta el título.` });
    }
    if (slide.layout !== 'titleSlide' && slide.layout !== 'sectionDivider' && slide.layout !== 'closingSlide' && slide.contentBlocks.length === 0) {
      issues.push({ severity: 'warning', message: `Slide #${idx + 1} (${slide.layout}): no tiene bloques de contenido.` });
    }
    if (slide.contentBlocks.length > 6) {
      issues.push({ severity: 'warning', message: `Slide #${idx + 1}: tiene ${slide.contentBlocks.length} bloques (>6) — considera dividirla.` });
    }
  });
  return issues;
};

/**
 * Recommended slide count limits per presentation template.
 * Surfaced in validation and in the generation prompt so the model targets
 * the right deck length per audience.
 */
export const PRESENTATION_TEMPLATE_LIMITS: Record<string, { min: number; max: number }> = {
  'presentation-executive': { min: 8, max: 12 },
  'presentation-technical': { min: 10, max: 15 },
  'presentation-overview': { min: 6, max: 10 },
  'presentation-summary': { min: 5, max: 8 },
};
