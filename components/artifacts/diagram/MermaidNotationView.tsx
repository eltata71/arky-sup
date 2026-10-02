import React, { useEffect, useRef, useState } from 'react';
import DiagramErrorPanel from './DiagramErrorPanel';
import { DiagramSkeleton } from './DiagramSkeleton';
import { initMermaidTheme } from './mermaidTheme';

export interface MermaidNotationViewProps {
  /** The stored Mermaid text, drawn as is — never re-serialised from the IR. */
  source: string | null;
  artifactName: string;
  /** Switches the canvas to the document view, where the source can be read. */
  onViewText: () => void;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const;
let notationRenderCounter = 0;

/**
 * The diagram in its own notation (8.3a).
 *
 * A sequence is lifelines, activations and `alt`/`loop` fragments; a Gantt is
 * a time axis; a state diagram has composite states. The interactive canvas
 * flattens all of them to boxes and arrows, so these dialects open here: the
 * stored text drawn by Mermaid itself. Nothing on this surface writes to the
 * artifact — editing stays on the canvas and in «Modificar diagrama».
 */
export const MermaidNotationView: React.FC<MermaidNotationViewProps> = ({ source, artifactName, onViewText }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'rendering' | 'ready' | 'error'>('rendering');
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number>(ZOOM_STEPS.indexOf(1));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!source?.trim()) {
        setStatus('error');
        setError('El artefacto no contiene texto Mermaid que dibujar.');
        return;
      }
      setStatus('rendering');
      setError(null);
      try {
        await initMermaidTheme(document.documentElement.classList.contains('dark'));
        const mermaid = (await import('mermaid')).default;
        notationRenderCounter += 1;
        const { svg } = await mermaid.render(`notation-${notationRenderCounter}`, source);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        const drawn = containerRef.current.querySelector('svg');
        if (drawn) {
          drawn.removeAttribute('height');
          drawn.style.maxWidth = '100%';
          drawn.setAttribute('role', 'img');
          drawn.setAttribute('aria-label', `Diagrama «${artifactName}» en su notación`);
        }
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [source, artifactName, attempt]);

  const zoom = ZOOM_STEPS[zoomIndex];

  return (
    <div className="flex-1 relative min-h-0 bg-gray-100 dark:bg-gray-900 flex flex-col h-full w-full animate-fade-in">
      {status === 'rendering' && (
        <DiagramSkeleton onCancel={onViewText} message="Dibujando el diagrama en su notación…" detail={null} />
      )}
      {status === 'error' && (
        <DiagramErrorPanel
          title="No se pudo dibujar la notación"
          body={error ?? 'Mermaid rechazó el texto del diagrama.'}
          mermaidSource={source}
          onRetry={() => setAttempt((value) => value + 1)}
          onViewText={onViewText}
        />
      )}
      <div className={`flex-1 overflow-auto p-6 ${status === 'ready' ? '' : 'hidden'}`}>
        <div
          className="mx-auto w-fit rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-950"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
        >
          <div ref={containerRef} data-testid="mermaid-notation" />
        </div>
      </div>
      {status === 'ready' && (
        <div
          role="group"
          aria-label="Zoom de la notación"
          className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-gray-200/60 bg-white/90 p-1 text-xs shadow-sm dark:border-gray-700/60 dark:bg-gray-900/90"
        >
          <button
            type="button"
            aria-label="Alejar"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((value) => Math.max(0, value - 1))}
            className="h-7 w-7 rounded-full font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Restablecer zoom"
            onClick={() => setZoomIndex(ZOOM_STEPS.indexOf(1))}
            className="min-w-[3rem] rounded-full px-2 py-1 tabular-nums text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <span aria-hidden>{Math.round(zoom * 100)} %</span>
          </button>
          <button
            type="button"
            aria-label="Acercar"
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((value) => Math.min(ZOOM_STEPS.length - 1, value + 1))}
            className="h-7 w-7 rounded-full font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
};

export default MermaidNotationView;
