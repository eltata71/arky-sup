import React, { useEffect, useId, useState } from 'react';
import { SafeRichText } from '../../ui/SafeRichText';
import { useUiText } from '../../../hooks/useUiText';

export interface SlideMermaidProps {
  code: string;
  description?: string;
}

/**
 * A slide's diagram, drawn — the PPTX embeds the same Mermaid as an image, so
 * showing its source on screen was the one block where what was presented
 * differed in kind from what was exported. Mermaid is loaded only when a
 * diagram slide is shown; if it cannot draw, the source stays readable.
 */
export const SlideMermaid: React.FC<SlideMermaidProps> = ({ code, description }) => {
  const t = useUiText();
  const id = `slide-mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        return mermaid.render(id, code);
      })
      .then((result) => { if (!cancelled) setSvg(result.svg); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code, id]);

  const label = description || t('deck.diagram');
  if (svg) {
    return (
      <SafeRichText
        as="div"
        className="flex justify-center overflow-hidden rounded-lg bg-white p-3 [&_svg]:max-h-[46vh] [&_svg]:max-w-full"
        containerProps={{ role: 'img', 'aria-label': label }}
        html={svg}
      />
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-primary-300 bg-primary-50 px-4 py-3 text-sm text-gray-700">
      {description && <p className="mb-2">{description}</p>}
      {failed && <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-gray-100 p-3 text-xs">{code}</pre>}
    </div>
  );
};

export default SlideMermaid;
