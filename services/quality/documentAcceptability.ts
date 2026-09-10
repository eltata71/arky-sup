/**
 * Deterministic quality gate for NON-diagram artifacts (markdown documents
 * and presentation decks).
 *
 * Diagrams already enjoy a self-healing pipeline (assess → corrective retry
 * → deterministic skeleton). Documents and decks used to be persisted as-is:
 * a truncated SDD or a deck with empty slides shipped silently. This module
 * provides the missing assessment so the generation service can trigger ONE
 * corrective retry and pick the best attempt.
 *
 * Everything here is pure and deterministic (no AI calls) so it is cheap to
 * run on every generation and trivial to unit-test.
 */

export interface DocumentQualityIssue {
    code: string;
    severity: 'critical' | 'warning';
    message: string;
}

export interface DocumentAssessment {
    ok: boolean;
    /** True when the content shows signs of being cut mid-generation. */
    truncated: boolean;
    /** 0–100 heuristic score used to pick the best of several attempts. */
    score: number;
    issues: DocumentQualityIssue[];
}

const MIN_DOCUMENT_CHARS = 400;

/** Line endings that suggest the generator stopped mid-thought. */
const ABRUPT_ENDINGS = /[,;:‒–—-]$|\b(y|o|de|del|la|el|los|las|que|con|para|por|en|the|of|and|or|to|with|for|a|an)$/i;

function countOccurrences(text: string, re: RegExp): number {
    return (text.match(re) ?? []).length;
}

/**
 * Assess a generated markdown/text document. `expectStructuredDocument`
 * should be true for document-representation artifacts (SDD, BRD, ADR…)
 * where headings and sections are part of the contract.
 */
export function assessDocumentArtifact(
    content: string,
    opts: {
        expectStructuredDocument?: boolean;
        /**
         * True for markdown deliverables that must meet the world-class
         * visual standard (embedded Mermaid + tables). Missing one of them
         * is a warning; a long document missing BOTH is critical and
         * triggers the corrective retry.
         */
        expectVisualEnrichment?: boolean;
    } = {},
): DocumentAssessment {
    const issues: DocumentQualityIssue[] = [];
    const text = (content ?? '').replace(/\r\n/g, '\n');
    const trimmed = text.trim();

    if (trimmed.length === 0) {
        return {
            ok: false,
            truncated: false,
            score: 0,
            issues: [{ code: 'doc.empty', severity: 'critical', message: 'El documento llegó vacío.' }],
        };
    }

    if (trimmed.length < MIN_DOCUMENT_CHARS) {
        issues.push({
            code: 'doc.too-short',
            severity: 'critical',
            message: `El documento es demasiado corto (${trimmed.length} caracteres) para ser un entregable útil.`,
        });
    }

    // Truncation signals -----------------------------------------------------
    let truncated = false;

    // 1) Unclosed fenced code block — classic token-limit cut.
    const fenceCount = countOccurrences(trimmed, /^```/gm);
    if (fenceCount % 2 !== 0) {
        truncated = true;
        issues.push({
            code: 'doc.unclosed-fence',
            severity: 'critical',
            message: 'Hay un bloque de código sin cerrar: la generación se cortó a mitad de un fence.',
        });
    }

    // 2) Abrupt last line: ends with a connector word, comma/colon/dash, or
    //    an incomplete table row. Headings and list markers alone also count.
    const lines = trimmed.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    const endsMidTable = /^\|.*[^|]$/.test(lastLine);
    const endsMidSentence = lastLine.length > 0
        && !/[.!?)"'\]`>:]$|\|$/.test(lastLine)
        && ABRUPT_ENDINGS.test(lastLine);
    const endsOnBareMarker = /^(#{1,6}|[-*+]|\d+\.)$/.test(lastLine);
    if (endsMidTable || endsMidSentence || endsOnBareMarker) {
        truncated = true;
        issues.push({
            code: 'doc.abrupt-ending',
            severity: 'critical',
            message: `El documento termina de forma abrupta ("…${lastLine.slice(-48)}").`,
        });
    }

    // Structure signals -------------------------------------------------------
    const headingCount = countOccurrences(trimmed, /^#{1,6}\s+\S/gm);
    if (opts.expectStructuredDocument && headingCount === 0 && trimmed.length >= MIN_DOCUMENT_CHARS) {
        issues.push({
            code: 'doc.no-headings',
            severity: 'warning',
            message: 'El documento no tiene encabezados; se esperaba una estructura por secciones.',
        });
    }

    // Visual enrichment signals --------------------------------------------
    // World-class deliverables present enumerable content as tables and
    // anchor architecture/flow explanations on an embedded diagram. Short
    // documents are exempt — a 600-char ADR note doesn't need a chart.
    if (opts.expectVisualEnrichment) {
        const hasMermaid = /```mermaid/i.test(trimmed);
        const hasTable = /^\|.+\|\s*$/m.test(trimmed) && /^\|[\s:|-]+\|\s*$/m.test(trimmed);
        const missingDiagram = !hasMermaid && trimmed.length >= 1200;
        const missingTables = !hasTable && trimmed.length >= 1500;
        if (missingDiagram && missingTables) {
            issues.push({
                code: 'doc.no-visual-elements',
                severity: 'critical',
                message: 'El documento es extenso pero no incluye ningún diagrama Mermaid ni tablas: no cumple el estándar visual de entregable.',
            });
        } else if (missingDiagram) {
            issues.push({
                code: 'doc.no-diagram',
                severity: 'warning',
                message: 'El documento no incluye ningún diagrama Mermaid embebido.',
            });
        } else if (missingTables) {
            issues.push({
                code: 'doc.no-tables',
                severity: 'warning',
                message: 'El documento no presenta información enumerable en tablas Markdown.',
            });
        }
    }

    // Score: length (cap 40) + structure (30) + cleanliness (30).
    const lengthScore = Math.min(40, Math.round((trimmed.length / 4000) * 40));
    const structureScore = Math.min(30, headingCount * 6);
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const cleanScore = Math.max(0, 30 - criticalCount * 15 - issues.length * 3);
    const score = Math.max(0, Math.min(100, lengthScore + structureScore + cleanScore));

    return {
        ok: criticalCount === 0,
        truncated,
        score,
        issues,
    };
}

export interface DeckAssessment {
    ok: boolean;
    score: number;
    issues: DocumentQualityIssue[];
    slideCount: number;
    emptySlideCount: number;
}

interface PresentationDeckShape {
    slides?: Array<{ title?: unknown; layout?: unknown; contentBlocks?: unknown }>;
}

/**
 * Assess a serialized PresentationDeck (the JSON string persisted in
 * `Artifact.content`). Structural only — narrative quality is the model's
 * job; this catches the failure modes that make a deck unusable.
 */
export function assessPresentationDeck(serializedDeck: string): DeckAssessment {
    const issues: DocumentQualityIssue[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(serializedDeck) as unknown;
    } catch {
        return {
            ok: false,
            score: 0,
            slideCount: 0,
            emptySlideCount: 0,
            issues: [{ code: 'deck.invalid-json', severity: 'critical', message: 'El deck no es JSON parseable.' }],
        };
    }
    const deck = parsed && typeof parsed === 'object' ? parsed as PresentationDeckShape : null;
    const slides = Array.isArray(deck?.slides) ? deck.slides : [];
    if (slides.length === 0) {
        return {
            ok: false,
            score: 0,
            slideCount: 0,
            emptySlideCount: 0,
            issues: [{ code: 'deck.no-slides', severity: 'critical', message: 'El deck no contiene diapositivas.' }],
        };
    }
    if (slides.length < 3) {
        issues.push({
            code: 'deck.too-few-slides',
            severity: 'warning',
            message: `El deck solo tiene ${slides.length} diapositiva(s); una presentación profesional necesita al menos 3.`,
        });
    }
    let emptySlideCount = 0;
    slides.forEach((slide, idx) => {
        const blocks = Array.isArray(slide?.contentBlocks) ? slide.contentBlocks as unknown[] : [];
        const hasTitle = typeof slide?.title === 'string' && (slide.title as string).trim().length > 0;
        // Title slides legitimately carry no content blocks.
        const isTitleLayout = slide?.layout === 'titleSlide' || slide?.layout === 'sectionDivider' || slide?.layout === 'closingSlide';
        if (!hasTitle) {
            issues.push({
                code: `deck.slide-${idx + 1}-untitled`,
                severity: 'warning',
                message: `La diapositiva ${idx + 1} no tiene título.`,
            });
        }
        if (blocks.length === 0 && !isTitleLayout) {
            emptySlideCount++;
        }
    });
    if (emptySlideCount > 0) {
        issues.push({
            code: 'deck.empty-slides',
            severity: emptySlideCount >= Math.ceil(slides.length / 2) ? 'critical' : 'warning',
            message: `${emptySlideCount} diapositiva(s) de contenido están vacías.`,
        });
    }
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const score = Math.max(0, Math.min(100,
        Math.min(50, slides.length * 8)
        + Math.max(0, 50 - emptySlideCount * 15 - criticalCount * 25 - issues.length * 4),
    ));
    return {
        ok: criticalCount === 0,
        score,
        issues,
        slideCount: slides.length,
        emptySlideCount,
    };
}
