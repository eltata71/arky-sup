/**
 * El vocabulario del pipeline de generación de artefactos.
 *
 * Ocho declaraciones puras que vivían dentro de
 * `services/artifactGenerationPipeline.ts`, con el resultado de que
 * `lib/artifacts/contracts.ts` —la hoja donde la UI lee sus tipos— tenía que
 * importar hacia arriba, hacia un fichero suelto de la raíz de `services/`,
 * para poder republicarlas. Tres de los cinco imports ascendentes del
 * repositorio salían de ahí.
 *
 * Es el mismo patrón que ya trajo `ExportFormat` y `ArtifactKind` hasta aquí:
 * un contrato sin comportamiento baja a una hoja, y el servicio que lo
 * implementa lo importa hacia abajo como todo el mundo.
 *
 * Lo que NO está aquí, y no debe estarlo: `getArtifactViewCapabilities` y
 * `resolveSafeArtifactView`. Parecen puras y no lo son — preguntan a
 * `services/diagram` si el IR renderiza y a `services/artifacts` si la vista
 * de publicación está activa. Viven en `services/artifacts` con el resto del
 * pipeline.
 */
import type { ArtifactType } from '../../types';
import type { DiagramAudience } from '../diagram';

export type ArtifactIntent = 'catalog' | 'on-demand' | 'regeneration';
export type ArtifactViewMode = 'diagram' | 'split' | 'document' | 'markdown' | 'publication' | 'excalidraw' | 'lucidchart' | 'fable' | 'table';
export type ArtifactPayloadKind = 'raw' | 'markdown' | 'mermaid' | 'json' | 'react-flow' | 'excalidraw' | 'lucidchart' | 'text';
export type ArtifactPipelineStage =
  | 'request'
  | 'ai-generation'
  | 'raw-response'
  | 'parsing'
  | 'normalization'
  | 'validation'
  | 'rendering'
  | 'persistence'
  | 'export';

export interface ArtifactDiagnostic {
  stage: ArtifactPipelineStage;
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  detail?: string;
  at: string;
}

export interface ArtifactPayload {
  kind: ArtifactPayloadKind;
  content: string;
  renderable: boolean;
  diagnostics: ArtifactDiagnostic[];
}

export interface ArtifactEnvelope {
  id: string;
  title: string;
  artifactType: ArtifactType;
  intent: ArtifactIntent;
  audience: DiagramAudience | 'mixed';
  viewModes: ArtifactViewMode[];
  primaryViewMode: ArtifactViewMode;
  payloads: Partial<Record<ArtifactPayloadKind, ArtifactPayload>>;
  metadata: {
    rawResponseLength: number;
    normalizedAt: string;
    parser: 'json' | 'markdown' | 'mermaid' | 'text' | 'empty';
  };
  quality: {
    hasUsefulContent: boolean;
    hasRenderableView: boolean;
    criticalErrorCount: number;
    warningCount: number;
  };
  diagnostics: ArtifactDiagnostic[];
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactValidationResult {
  ok: boolean;
  status: 'ready' | 'warning' | 'recoverable-error' | 'blocked';
  visibleViewMode: ArtifactViewMode | null;
  diagnostics: ArtifactDiagnostic[];
}
