/**
 * One sanitiser, shared by every deterministic builder.
 *
 * Its own file because both `deterministicArtifactFallbacks.ts` and
 * `deterministicHybridFallbacks.ts` embed free-form project text into Mermaid
 * labels, and a second copy of an escaping rule is how one of them stops being
 * escaped.
 */

/**
 * Sanitise a free-form string so it is safe to embed inside a Mermaid label
 * (no quotes, no newlines, no backticks). Falls back to the placeholder when
 * the input is empty so the deterministic skeleton always has something to
 * render.
 */
export function safeMermaidLabel(value: string | undefined | null, fallback: string): string {
    const cleaned = (value ?? '').replace(/["`\\]/g, '').replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
}
