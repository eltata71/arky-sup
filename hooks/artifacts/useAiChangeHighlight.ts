import { useEffect } from 'react';
import { useReducedMotion } from '../useReducedMotion';

export const AI_CHANGE_HIGHLIGHT_MS = 600;

/** Resalta 600 ms los nodos que la IA tocó; con movimiento reducido no resalta. */
export function useAiChangeHighlight(touchedNodeIds: readonly string[], changeId: string | null): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || !changeId || touchedNodeIds.length === 0) return;
    const flashed: Element[] = [];
    // El lienzo pinta tras aplicar la versión: se espera un fotograma.
    const frame = window.requestAnimationFrame(() => {
      for (const id of touchedNodeIds) {
        const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
        if (node) { node.classList.add('ai-change-flash'); flashed.push(node); }
      }
    });
    const timer = window.setTimeout(() => flashed.forEach(node => node.classList.remove('ai-change-flash')), AI_CHANGE_HIGHLIGHT_MS + 100);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      flashed.forEach(node => node.classList.remove('ai-change-flash'));
    };
  }, [reduced, changeId, touchedNodeIds]);
}
