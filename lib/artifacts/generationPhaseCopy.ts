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
  recommendation: { label: 'Buscando el artefacto adecuado', description: 'Comparamos tu solicitud con el catálogo de artefactos.', icon: '◇' },
  prompt: { label: 'Leyendo el contexto del proyecto', description: 'Reunimos la solicitud y el contexto necesario para escribir.', icon: '▤' },
  'ai-generation': { label: 'Escribiendo', description: 'Estamos preparando el contenido del artefacto.', icon: '✎' },
  validation: { label: 'Comprobando el contenido', description: 'Revisamos que el resultado cumpla las reglas del artefacto.', icon: '✓' },
  'quality-gate': { label: 'Revisando la calidad', description: 'Comprobamos si el resultado está listo para guardarse.', icon: '✦' },
  fallback: { label: 'Preparando una alternativa', description: 'Buscamos una salida útil tras un problema de generación.', icon: '↻' },
  persistence: { label: 'Guardando', description: 'Guardamos el artefacto y su historial.', icon: '▣' },
  render: { label: 'Preparando la vista', description: 'Ajustamos el resultado para mostrarlo en el lienzo.', icon: '▧' },
  parsing: { label: 'Leyendo la respuesta', description: 'Interpretamos el contenido recibido para poder comprobarlo.', icon: '⌕' },
  normalization: { label: 'Ordenando el contenido', description: 'Damos al resultado una estructura consistente.', icon: '≡' },
  export: { label: 'Preparando la descarga', description: 'Convertimos el artefacto al formato elegido.', icon: '⇩' },
  refinement: { label: 'Puliendo el resultado', description: 'Aplicamos mejoras sin perder el contenido válido.', icon: '✧' },
};

export const GENERATION_STATUS_COPY: Record<ArtifactGenerationStepStatus, string> = {
  'in-progress': 'En curso',
  success: 'Completada',
  warning: 'Atención',
  error: 'Error',
  skipped: 'Omitida',
};
