import type { ArtifactGenerationStage, ArtifactGenerationStepStatus } from './artifactModel';

export interface GenerationPhaseCopy {
  /** Nombre breve de la fase, visible en el historial. */
  label: string;
  /** Explicación de lo que hace la aplicación, visible durante la espera. */
  description: string;
  /** Símbolo decorativo; el nombre y la explicación llevan el significado. */
  icon: string;
}

/** Único vocabulario de las fases de generación que ve la persona. */
export const GENERATION_PHASE_COPY: Record<ArtifactGenerationStage, GenerationPhaseCopy> = {
  recommendation: { label: 'Buscando el artefacto adecuado', description: 'Comparamos tu solicitud con el catálogo.', icon: '◇' },
  prompt: { label: 'Leyendo el contexto del proyecto', description: 'Reunimos el contexto para escribir.', icon: '▤' },
  'ai-generation': { label: 'Escribiendo', description: 'Preparamos el contenido del artefacto.', icon: '✎' },
  validation: { label: 'Comprobando el contenido', description: 'Revisamos las reglas del artefacto.', icon: '✓' },
  'quality-gate': { label: 'Revisando la calidad', description: 'Comprobamos si está listo para guardar.', icon: '✦' },
  fallback: { label: 'Preparando una alternativa', description: 'Buscamos una salida tras el fallo.', icon: '↻' },
  persistence: { label: 'Guardando', description: 'Guardamos el artefacto y su historial.', icon: '▣' },
  render: { label: 'Preparando la vista', description: 'Mostramos el resultado en el lienzo.', icon: '▧' },
  parsing: { label: 'Leyendo la respuesta', description: 'Interpretamos el contenido recibido.', icon: '⌕' },
  normalization: { label: 'Ordenando el contenido', description: 'Damos estructura al resultado.', icon: '≡' },
  export: { label: 'Preparando la descarga', description: 'Convertimos el artefacto al formato elegido.', icon: '⇩' },
  refinement: { label: 'Puliendo el resultado', description: 'Mejoramos el contenido válido.', icon: '✧' },
};

export const GENERATION_STATUS_COPY: Record<ArtifactGenerationStepStatus, string> = {
  'in-progress': 'En curso',
  success: 'Completada',
  warning: 'Atención',
  error: 'Error',
  skipped: 'Omitida',
};
