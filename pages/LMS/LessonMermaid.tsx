import React, { useState, useEffect, useMemo } from 'react';

import { extractMermaid } from '../../utils/diagram/extractMermaid';
import { SafeRichText } from '../../components/ui/SafeRichText';

/**
 * Renders Mermaid produced/typed in the LMS as an actual diagram (lazy-loading
 * the mermaid library), with an honest fallback to the source code when the
 * syntax is invalid — mirroring the resilient pattern in ArtifactPresentationView
 * so a bad diagram never shows a blank canvas. Shared by the lesson
 * "Visualización" tab and the practical Lab.
 */
export const LessonMermaid: React.FC<{ content: string }> = ({ content }) => {
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const id = useMemo(() => `lesson-mermaid-${Math.random().toString(36).slice(2)}`, []);
    const code = useMemo(() => {
        const result = extractMermaid(content, 'hybrid');
        return result.ok ? result.code : '';
    }, [content]);

    useEffect(() => {
        let cancelled = false;
        setSvg(null);
        setError(null);
        if (!code.trim()) return;
        import('mermaid')
            .then(module => {
                const mermaid = module.default;
                mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default' });
                return mermaid.render(id, code);
            })
            .then(result => { if (!cancelled) setSvg(result.svg); })
            .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo renderizar el diagrama.'); });
        return () => { cancelled = true; };
    }, [code, id]);

    if (!code.trim()) {
        return (
            <div className="prose prose-sm dark:prose-invert max-w-none">
                <SafeRichText markdown={content} />
            </div>
        );
    }
    if (svg) {
        // `securityLevel: 'strict'` hardens what Mermaid accepts as *input*;
        // this sanitises what it produced. Neither substitutes for the other.
        return (
            <SafeRichText
                as="div"
                className="overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4"
                containerProps={{ role: 'img', 'aria-label': 'Diagrama de la lección' }}
                html={svg}
            />
        );
    }
    return (
        <div className="space-y-2">
            {error && <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-200">Render visual no disponible: {error}. Se muestra el código Mermaid como respaldo.</p>}
            <pre className="max-h-[420px] overflow-auto rounded-xl bg-gray-950 p-4 text-xs leading-6 text-gray-100"><code>{code}</code></pre>
        </div>
    );
};
