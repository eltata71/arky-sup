import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { MOTION } from '../../../lib/designTokens';
import useReducedMotion from '../../../hooks/useReducedMotion';
import type { Artifact } from '../../../lib/artifacts';
import { describeC4Navigation } from '../../../services/artifacts/application/diagramDetailLinks';

export interface C4LevelNavigatorProps {
  artifact: Artifact;
  projectArtifacts: readonly Artifact[];
  onOpenArtifact: (artifactId: string) => void;
  children: React.ReactNode;
}

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

/**
 * Navegación por niveles C4 (12.3): migas, «Entrar» por nodo con detalle, y
 * `Esc` para subir. Entrar hace un zoom corto hacia dentro y subir hacia
 * fuera; con movimiento reducido es sólo un fundido. Todo lo que decide
 * (padre, hijos) viene de `describeC4Navigation`; no regenera nada.
 */
export const C4LevelNavigator: React.FC<C4LevelNavigatorProps> = ({ artifact, projectArtifacts, onOpenArtifact, children }) => {
  const reduced = useReducedMotion();
  const nav = describeC4Navigation(artifact, projectArtifacts);
  const previousDepth = useRef(nav.trail.length);
  const direction = nav.trail.length >= previousDepth.current ? 1 : -1;
  useEffect(() => { previousDepth.current = nav.trail.length; }, [nav.trail.length]);

  const parentId = nav.parentArtifactId;
  useEffect(() => {
    if (!parentId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      onOpenArtifact(parentId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [parentId, onOpenArtifact]);

  const hasNavigation = nav.trail.length > 1 || nav.enterable.length > 0;
  const copy = {
    nav: 'Niveles C4',
    enter: (label: string) => `Entrar en «${label}»`,
    up: 'Subir un nivel (Esc)',
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="c4-level-navigator">
      {hasNavigation && (
        <nav aria-label={copy.nav} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-200 px-3 py-1.5 text-xs dark:border-gray-700">
          <ol className="flex flex-wrap items-center gap-1">
            {nav.trail.map((step, index) => {
              const current = index === nav.trail.length - 1;
              return (
                <li key={step.artifactId} className="flex items-center gap-1">
                  {index > 0 && <span aria-hidden="true">›</span>}
                  {current
                    ? <span aria-current="page" className="font-semibold">{step.levelLabel ?? step.name}</span>
                    : <button type="button" onClick={() => onOpenArtifact(step.artifactId)} className="rounded px-1 text-primary-600 hover:underline focus-visible:outline focus-visible:outline-2 dark:text-primary-400">{step.levelLabel ?? step.name}</button>}
                </li>
              );
            })}
          </ol>
          {parentId && (
            <button type="button" onClick={() => onOpenArtifact(parentId)} className="rounded border border-gray-300 px-2 py-0.5 dark:border-gray-600">{copy.up}</button>
          )}
          {nav.enterable.map((child) => (
            <button key={child.nodeId} type="button" onClick={() => onOpenArtifact(child.artifactId)} aria-label={copy.enter(child.label)} className="rounded bg-primary-600 px-2 py-0.5 text-white">
              {copy.enter(child.label)}
            </button>
          ))}
        </nav>
      )}
      <motion.div
        key={artifact.id}
        className="flex min-h-0 flex-1 flex-col"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: direction > 0 ? 1.06 : 0.94 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={{ duration: MOTION.duration.slow, ease: MOTION.ease.enter }}
      >
        {children}
      </motion.div>
    </div>
  );
};

export default C4LevelNavigator;
