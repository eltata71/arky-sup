/**
 * Centralised Mermaid extraction. Replaces the regex copies previously scattered
 * across ArtifactCanvas.tsx, LucidchartViewer.tsx and ExcalidrawViewer retry paths.
 */

const MERMAID_HEAD = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|C4Context|C4Container|C4Component|C4Deployment|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|timeline|pie)\b/im;

export type ArtifactRepresentation = 'diagram' | 'document' | 'hybrid';

/**
 * Discriminated result of {@link extractMermaid}. The diagnostic-rich variant
 * keeps callers (UI banners, diagnostics persistence) honest about why an
 * extraction returned no code, replacing the previous `null`-only contract.
 */
export type ExtractMermaidResult =
    | { ok: true; code: string }
    | {
          ok: false;
          reason:
              | 'empty'
              | 'no-fence'
              | 'fence-without-mermaid'
              | 'fence-empty'
              | 'no-header';
          sample?: string;
      };

const SAMPLE_CHARS = 240;

function takeSample(input: string): string {
    return input.length <= SAMPLE_CHARS ? input : `${input.slice(0, SAMPLE_CHARS)}…`;
}

function extractFromFirstMermaidHeader(input: string): string | null {
    const lines = input.split(/\r?\n/);
    const start = lines.findIndex((line) => MERMAID_HEAD.test(line));
    if (start < 0) return null;
    return lines.slice(start).join('\n').trim();
}

/**
 * Extracts a Mermaid block from a piece of artifact content with rich
 * diagnostics so the caller can show a precise UI message and persist the
 * reason on `Artifact.lastDiagramError`.
 *  - 'diagram' → expected raw Mermaid (no fences). We still try to recover when
 *    the model emits an extra ```mermaid fence, or wraps in a generic ``` fence.
 *  - 'document'/'hybrid' → content contains ```mermaid …``` fence
 *  - Falls back to header detection when neither rule matches.
 */
export function extractMermaid(
    content: string | null | undefined,
    representation: ArtifactRepresentation = 'hybrid',
): ExtractMermaidResult {
    if (!content) return { ok: false, reason: 'empty' };
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };

    // Fast path: raw Mermaid for diagram artifacts.  Be strict: a diagram
    // representation is not enough to treat arbitrary AI prose as Mermaid.
    if (representation === 'diagram' && !trimmed.startsWith('{') && !trimmed.startsWith('```')) {
        const rawMermaid = extractFromFirstMermaidHeader(trimmed);
        if (rawMermaid) return { ok: true, code: rawMermaid };
    }

    // Standard fenced block (most common AI output, regardless of representation).
    const fencedMermaid = trimmed.match(/```mermaid\s*([\s\S]*?)```/i);
    if (fencedMermaid) {
        const inner = fencedMermaid[1].trim();
        if (!inner) return { ok: false, reason: 'fence-empty', sample: takeSample(trimmed) };
        return { ok: true, code: inner };
    }

    // Generic ``` fence whose body looks like Mermaid (the AI sometimes drops
    // the language tag). Accept it only when the inner body contains a Mermaid
    // header so we don't accidentally pull JSON or YAML out of code blocks.
    const fencedGeneric = trimmed.match(/```(?:[a-zA-Z0-9_-]*)\s*([\s\S]*?)```/);
    if (fencedGeneric) {
        const inner = fencedGeneric[1].trim();
        if (MERMAID_HEAD.test(inner)) return { ok: true, code: inner };
        return { ok: false, reason: 'fence-without-mermaid', sample: takeSample(trimmed) };
    }

    const headerExtracted = extractFromFirstMermaidHeader(trimmed);
    if (headerExtracted) return { ok: true, code: headerExtracted };

    // Has content but no fence and no recognizable Mermaid header.
    return { ok: false, reason: trimmed.includes('```') ? 'no-header' : 'no-fence', sample: takeSample(trimmed) };
}

/**
 * Backwards-compatible wrapper that preserves the historical `string | null`
 * contract. Prefer {@link extractMermaid} in new code so the caller can
 * surface a precise reason to the user.
 */
export function extractMermaidCode(
    content: string | null | undefined,
    representation: ArtifactRepresentation = 'hybrid',
): string | null {
    const result = extractMermaid(content, representation);
    return result.ok ? result.code : null;
}

/** Narrow Mermaid dialect detection from the first meaningful line. */
export function detectMermaidKind(code: string | null | undefined): string {
    if (!code) return 'Diagrama';
    const firstLine = code.split('\n').find(l => l.trim().length > 0) ?? '';
    const header = firstLine.trim();
    if (/^c4context/i.test(header)) return 'C4 Contexto';
    if (/^c4container/i.test(header)) return 'C4 Contenedor';
    if (/^c4component/i.test(header)) return 'C4 Componente';
    if (/^c4deployment/i.test(header)) return 'C4 Despliegue';
    if (/^sequencediagram/i.test(header)) return 'Secuencia';
    if (/^classdiagram/i.test(header)) return 'Clases';
    if (/^erdiagram/i.test(header)) return 'Entidad-Relación';
    if (/^statediagram/i.test(header)) return 'Estados';
    if (/^gantt/i.test(header)) return 'Gantt';
    if (/^(flowchart|graph)\b/i.test(header)) return 'Flujo';
    if (/^mindmap/i.test(header)) return 'Mapa Mental';
    if (/^journey/i.test(header)) return 'User Journey';
    return 'Diagrama';
}
