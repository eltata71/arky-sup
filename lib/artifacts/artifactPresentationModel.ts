import type { Artifact } from './artifactModel';
import type { DiagramIR } from '../diagram';
import type { ExportFormat } from './exportContracts';

export const ARTIFACT_PRESENTATION_COMPILER_VERSION = '1.1.0';

export type PresentationAudience = 'executive' | 'technical' | 'operations' | 'business' | 'mixed';
export type PresentationMode = 'working' | 'publication' | 'executive' | 'technical' | 'committee' | 'audit';
export type PublicationExportMode = 'original' | 'publication' | 'document-diagram' | 'diagram-only' | 'table-only';

export type ArtifactPresentationSectionType =
  | 'summary'
  | 'body'
  | 'decision'
  | 'risk'
  | 'assumption'
  | 'next-steps'
  | 'traceability'
  | 'appendix';

export interface ArtifactPresentationSection {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  content: string;
  type: ArtifactPresentationSectionType;
  order: number;
}

export interface ArtifactPresentationLegendItem {
  id: string;
  label: string;
  meaning: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
}

export type ArtifactPresentationDiagramDensity = 'simple' | 'balanced' | 'detailed' | 'overloaded';
export type ArtifactPresentationDiagramOrientation = 'LR' | 'TD' | 'unknown';

export interface ArtifactPresentationDiagram {
  id: string;
  title: string;
  purpose: string;
  mermaid?: string;
  ir?: DiagramIR;
  legend: ArtifactPresentationLegendItem[];
  readingNotes: string[];
  density: ArtifactPresentationDiagramDensity;
  orientation: ArtifactPresentationDiagramOrientation;
  exportSafe: boolean;
  nodeCount: number;
  edgeCount: number;
  c4Level?: 'Context' | 'Container' | 'Component' | 'Deployment';
  diagramKind?: 'c4' | 'process' | 'data' | 'integration' | 'generic';
  technicalSummary?: string;
  executiveSummary?: string;
}

export interface ArtifactPresentationTable {
  id: string;
  title: string;
  headers: string[];
  rows: string[][];
  completeness: number;
  exportSafe: boolean;
  readingNotes: string[];
}

export interface ArtifactPresentationCallout {
  id: string;
  type: 'info' | 'decision' | 'risk' | 'warning' | 'assumption' | 'recommendation';
  title: string;
  content: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ArtifactExportProfile {
  recommendedFormats: ExportFormat[];
  availableFormats: ExportFormat[];
  blockedFormats: {
    format: ExportFormat;
    reason: string;
    recommendation: string;
  }[];
  defaultFormat: ExportFormat;
  canExportAsPublication: boolean;
  requiresUserReview: boolean;
}

export interface ArtifactPresentationQuality {
  score: number;
  readyForPublication: boolean;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  dimensions: {
    structure: number;
    readability: number;
    visualHierarchy: number;
    traceability: number;
    exportReadiness: number;
    audienceAlignment: number;
  };
}

export interface ArtifactPresentationTheme {
  name: 'executive' | 'technical' | 'audit';
  density: 'comfortable' | 'compact';
  colorMode: 'adaptive';
}

export interface ArtifactPresentationTraceEvent {
  id: string;
  code:
    | 'presentation.compile.started'
    | 'presentation.compile.success'
    | 'presentation.compile.warning'
    | 'presentation.compile.failed-non-blocking'
    | 'presentation.export-profile.resolved'
    | 'presentation.quality.evaluated'
    | 'presentation.export.requested'
    | 'presentation.export.original'
    | 'presentation.export.publication'
    | 'presentation.export.blocked'
    | 'presentation.export.completed'
    | 'presentation.export.failed';
  level: 'info' | 'warning' | 'error';
  message: string;
  at: string;
}

export interface ArtifactPresentationModel {
  id: string;
  artifactId: string;
  artifactName: string;
  artifactType: Artifact['type'];
  compilerVersion: string;
  audience: PresentationAudience;
  mode: PresentationMode;
  title: string;
  subtitle?: string;
  executiveSummary?: string;
  purpose?: string;
  scope?: string;
  sections: ArtifactPresentationSection[];
  diagrams: ArtifactPresentationDiagram[];
  tables: ArtifactPresentationTable[];
  callouts: ArtifactPresentationCallout[];
  decisions: ArtifactPresentationCallout[];
  risks: ArtifactPresentationCallout[];
  assumptions: ArtifactPresentationCallout[];
  nextSteps: string[];
  traceability: string[];
  exportProfile: ArtifactExportProfile;
  quality: ArtifactPresentationQuality;
  theme: ArtifactPresentationTheme;
  trace: ArtifactPresentationTraceEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactPresentationCompileOptions {
  audience?: PresentationAudience;
  mode?: PresentationMode;
  now?: string;
  compilerEnabled?: boolean;
}

export interface ArtifactPresentationCompileResult {
  enabled: boolean;
  model: ArtifactPresentationModel | null;
  warnings: string[];
  errors: string[];
  trace: ArtifactPresentationTraceEvent[];
}
