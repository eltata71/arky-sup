import React from 'react';
import { motion } from 'motion/react';
import { SparklesIcon, XCircleIcon } from '../../Icons';

interface LoadingOverlayProps {
  message: string;
  onCancel?: () => void;
}

/**
 * Full-surface loading overlay used while a long-running AI action (test
 * generation, document conversion) is in flight. Extracted from
 * `ArtifactCanvas` so the diagram view and Phase 4 shells can reuse it.
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message, onCancel }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="absolute inset-0 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md flex flex-col items-center justify-center z-40 p-4 text-center h-full w-full"
  >
    <div className="relative mb-6">
      <div className="absolute inset-0 bg-primary-500/20 rounded-full blur-xl animate-pulse"></div>
      <svg className="relative animate-spin h-12 w-12 text-primary-600 dark:text-primary-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>
    <p className="text-gray-900 dark:text-white text-lg font-medium animate-pulse mb-4 tracking-tight">{message}</p>
    {onCancel && (
      <button
        onClick={onCancel}
        className="px-5 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded-full border border-gray-200 dark:border-gray-700 flex items-center transition-colors pointer-events-auto shadow-sm"
      >
        <XCircleIcon className="h-5 w-5 mr-2" />
        Ver como documento
      </button>
    )}
  </motion.div>
);

interface DiagramSkeletonProps {
  onCancel?: () => void;
  message?: string;
  detail?: string | null;
}

/**
 * Animated placeholder shown while the interactive diagram is being prepared.
 * Surfaces an observability `detail` line so users see why a render is slow.
 */
export const DiagramSkeleton: React.FC<DiagramSkeletonProps> = ({ onCancel, message = 'Generando diagrama con IA...', detail }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="absolute inset-0 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-center p-8 z-30 overflow-hidden"
  >
    <div className="w-full max-w-4xl h-full relative">
      {/* Flashing nodes */}
      <motion.div
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 w-32 h-16 bg-gray-200 dark:bg-gray-800 rounded-xl border border-gray-300 dark:border-gray-700"
      />
      <motion.div
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-40 h-20 bg-gray-200 dark:bg-gray-800 rounded-xl border border-gray-300 dark:border-gray-700"
      />
      <motion.div
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
        className="absolute bottom-1/4 right-1/4 w-32 h-16 bg-gray-200 dark:bg-gray-800 rounded-xl border border-gray-300 dark:border-gray-700"
      />
      {/* Connecting lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <motion.path
          d="M 25% 25% L 50% 50%"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-200 dark:text-gray-800"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <motion.path
          d="M 50% 50% L 75% 75%"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-200 dark:text-gray-800"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-[2px]">
        <div className="bg-white/90 dark:bg-gray-900/90 px-6 py-4 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 flex flex-col items-center space-y-4">
          <div className="flex items-center space-x-3">
            <SparklesIcon className="w-5 h-5 text-primary-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">{message}</span>
          </div>
          {detail && (
            <div className="w-full rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Observabilidad</p>
              <p className="mt-1 text-xs leading-snug text-amber-800 dark:text-amber-100">{detail}</p>
            </div>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full border border-gray-200 dark:border-gray-700 flex items-center transition-colors pointer-events-auto"
            >
              <XCircleIcon className="h-4 w-4 mr-1.5" />
              Ver como documento
            </button>
          )}
        </div>
      </div>
    </div>
  </motion.div>
);

export default DiagramSkeleton;
