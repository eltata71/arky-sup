import type { Artifact, ArtifactGenerationTraceStep, ArtifactType } from '../../types';
import type {
  ArtifactDiagnostic,
  ArtifactEnvelope,
  ArtifactIntent,
  ArtifactPayload,
  ArtifactPayloadKind,
  ArtifactPipelineStage,
  ArtifactValidationResult,
  ArtifactViewMode,
} from '../../lib/artifacts/artifactPipelineContracts';

// El vocabulario se declara en la hoja y se republica desde aquí: los
// llamadores que ya lo pedían a este módulo no tienen que cambiar de puerta.
export type {
  ArtifactDiagnostic,
  ArtifactEnvelope,
  ArtifactIntent,
  ArtifactPayload,
  ArtifactPayloadKind,
  ArtifactPipelineStage,
  ArtifactValidationResult,
  ArtifactViewMode,
};
import type { DiagramAudience } from '../../lib/diagram';
import { extractIRDiagnostic } from '../diagram';
import { extractMermaid } from '../../utils/diagram/extractMermaid';
import { isPublicationViewEnabled } from './artifactPresentationFlags';

const now = () => new Date().toISOString();

const diagnostic = (
  stage: ArtifactPipelineStage,
  level: ArtifactDiagnostic['level'],
  code: string,
  message: string,
  detail?: string,
): ArtifactDiagnostic => ({ stage, level, code, message, detail, at: now() });

const looksLikeJson = (value: string): boolean => /^[\s\n\r]*[[{]/.test(value);
const looksLikeMarkdown = (value: string): boolean => /(^|\n)#{1,6}\s+|```|\|.+\|\n\|?\s*:?-{3,}/.test(value);

const getRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : null;

const readStringField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
};

const extractFencedJson = (value: string): string | null => {
  const jsonFence = value.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence?.[1]?.trim()) return jsonFence[1].trim();
  const genericFence = value.match(/```\s*([\s\S]*?)```/);
  if (genericFence?.[1]?.trim() && looksLikeJson(genericFence[1])) return genericFence[1].trim();
  return null;
};

export const parseArtifactRawResponse = (rawResponse: string, artifactType: ArtifactType): { payloads: ArtifactEnvelope['payloads']; diagnostics: ArtifactDiagnostic[]; parser: ArtifactEnvelope['metadata']['parser'] } => {
  const raw = rawResponse ?? '';
  const trimmed = raw.trim();
  const diagnostics: ArtifactDiagnostic[] = [];
  const payloads: ArtifactEnvelope['payloads'] = {
    raw: { kind: 'raw', content: raw, renderable: trimmed.length > 0, diagnostics: [] },
  };

  if (!trimmed) {
    diagnostics.push(diagnostic('parsing', 'error', 'raw.empty', 'La respuesta IA llegó vacía.'));
    return { payloads, diagnostics, parser: 'empty' };
  }

  const mermaid = extractMermaid(raw, artifactType.startsWith('mermaid') ? 'diagram' : 'hybrid');
  if (mermaid.ok) {
    payloads.mermaid = { kind: 'mermaid', content: mermaid.code, renderable: true, diagnostics: [] };
    diagnostics.push(diagnostic('parsing', 'info', 'parser.mermaid', 'Se detectó contenido Mermaid o diagrama textual.', `length=${mermaid.code.length}`));
    if (raw.trim() !== mermaid.code.trim()) {
      payloads.markdown = { kind: 'markdown', content: raw, renderable: true, diagnostics: [] };
      diagnostics.push(diagnostic('parsing', 'info', 'parser.markdown.context', 'Se conservó el contexto textual alrededor del diagrama.'));
    }
    return { payloads, diagnostics, parser: 'mermaid' };
  }

  const jsonCandidate = extractFencedJson(raw) ?? (looksLikeJson(trimmed) ? trimmed : null);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const asRecord = getRecord(parsed) ?? {};
      const nestedIR = getRecord(asRecord.ir);
      const nestedDiagram = getRecord(asRecord.diagram);
      const contentField = readStringField(asRecord, ['content', 'markdown', 'document', 'text', 'description']);
      const mermaidField = readStringField(asRecord, ['mermaid', 'mermaidCode', 'diagramCode']) ?? (nestedDiagram ? readStringField(nestedDiagram, ['mermaid', 'content', 'code']) : null);
      const graphRecord = nestedIR ?? nestedDiagram ?? asRecord;
      const hasNodes = Array.isArray(graphRecord.nodes) && Array.isArray(graphRecord.edges);
      const hasElements = Array.isArray(graphRecord.elements);

      if (contentField) payloads.markdown = { kind: 'markdown', content: contentField, renderable: true, diagnostics: [] };
      if (mermaidField) payloads.mermaid = { kind: 'mermaid', content: mermaidField, renderable: true, diagnostics: [] };

      const kind: ArtifactPayloadKind = hasNodes
        ? 'react-flow'
        : hasElements
          ? 'excalidraw'
          : mermaidField
            ? 'mermaid'
            : contentField
              ? 'markdown'
              : 'json';
      if (hasNodes || hasElements || kind === 'json') {
        payloads[kind] = { kind, content: JSON.stringify(hasNodes || hasElements ? graphRecord : parsed, null, 2), renderable: kind !== 'json', diagnostics: [] };
      }
      diagnostics.push(diagnostic('parsing', 'info', 'parser.json', `JSON válido detectado (${kind}).`, `nodes=${hasNodes ? (graphRecord.nodes as unknown[]).length : 'n/a'} edges=${hasNodes ? (graphRecord.edges as unknown[]).length : 'n/a'}`));
      return { payloads, diagnostics, parser: 'json' };
    } catch (error) {
      diagnostics.push(diagnostic('parsing', 'warning', 'parser.json.partial', 'La respuesta parece JSON pero no es parseable; se conserva como texto/Markdown.', error instanceof Error ? error.message : String(error)));
    }
  }

  if (looksLikeMarkdown(trimmed)) {
    payloads.markdown = { kind: 'markdown', content: raw, renderable: true, diagnostics: [] };
    diagnostics.push(diagnostic('parsing', 'info', 'parser.markdown', 'Se detectó Markdown/documento renderizable.'));
    return { payloads, diagnostics, parser: 'markdown' };
  }

  payloads.text = { kind: 'text', content: raw, renderable: true, diagnostics: [] };
  diagnostics.push(diagnostic('parsing', 'warning', 'parser.text', 'No se detectó estructura especializada; se usará fallback textual.'));
  return { payloads, diagnostics, parser: 'text' };
};

export const normalizeArtifactEnvelope = (params: {
  artifactId: string;
  title: string;
  artifactType: ArtifactType;
  representation: Artifact['representation'];
  rawResponse: string;
  intent: ArtifactIntent;
  audience?: DiagramAudience | 'mixed';
}): ArtifactEnvelope => {
  const parsed = parseArtifactRawResponse(params.rawResponse, params.artifactType);
  const diagnostics = [...parsed.diagnostics];
  const diagramPayloadRenderable = Boolean(parsed.payloads.mermaid?.content.trim() || parsed.payloads['react-flow']?.content.trim() || parsed.payloads.excalidraw?.content.trim() || parsed.payloads.lucidchart?.content.trim());
  const hasDocumentPayload = Boolean(parsed.payloads.markdown?.content.trim() || parsed.payloads.text?.content.trim() || (!diagramPayloadRenderable && parsed.payloads.raw?.content.trim()));
  const viewModes: ArtifactViewMode[] = [];
  if (params.representation !== 'document' && diagramPayloadRenderable) viewModes.push('diagram', 'split', 'excalidraw', 'lucidchart', 'fable');
  if (hasDocumentPayload) viewModes.push('document', 'markdown');
  if (viewModes.length === 0 && parsed.payloads.raw?.content.trim()) viewModes.push('document', 'markdown');
  const primaryViewMode: ArtifactViewMode = diagramPayloadRenderable && params.representation !== 'document' ? 'diagram' : hasDocumentPayload ? 'document' : viewModes[0] ?? 'document';
  const criticalErrorCount = diagnostics.filter((item) => item.level === 'error').length;
  const warningCount = diagnostics.filter((item) => item.level === 'warning').length;
  const timestamp = now();
  return {
    id: params.artifactId,
    title: params.title,
    artifactType: params.artifactType,
    intent: params.intent,
    audience: params.audience ?? 'technical',
    viewModes,
    primaryViewMode,
    payloads: parsed.payloads,
    metadata: {
      rawResponseLength: params.rawResponse.length,
      normalizedAt: timestamp,
      parser: parsed.parser,
    },
    quality: {
      hasUsefulContent: params.rawResponse.trim().length > 0,
      hasRenderableView: viewModes.length > 0 && params.rawResponse.trim().length > 0,
      criticalErrorCount,
      warningCount,
    },
    diagnostics,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const validateArtifactEnvelope = (envelope: ArtifactEnvelope): ArtifactValidationResult => {
  const diagnostics = [...envelope.diagnostics];
  if (!envelope.quality.hasUsefulContent) {
    diagnostics.push(diagnostic('validation', 'error', 'content.empty', 'No existe contenido útil para mostrar.'));
    return { ok: false, status: 'blocked', visibleViewMode: null, diagnostics };
  }
  if (!envelope.quality.hasRenderableView) {
    diagnostics.push(diagnostic('validation', 'error', 'view.none', 'No existe una vista renderizable.'));
    return { ok: false, status: 'recoverable-error', visibleViewMode: null, diagnostics };
  }
  const status = envelope.quality.criticalErrorCount > 0
    ? 'recoverable-error'
    : envelope.quality.warningCount > 0
      ? 'warning'
      : 'ready';
  return { ok: true, status, visibleViewMode: envelope.primaryViewMode, diagnostics };
};

export const buildArtifactPipelineTraceSteps = (envelope: ArtifactEnvelope): ArtifactGenerationTraceStep[] => envelope.diagnostics.map((item) => ({
  stage: item.stage === 'parsing' ? 'validation' : item.stage === 'normalization' ? 'validation' : item.stage === 'raw-response' ? 'ai-generation' : item.stage === 'rendering' ? 'render' : item.stage === 'persistence' ? 'persistence' : 'validation',
  status: item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : 'success',
  message: item.message,
  detail: `${item.code}${item.detail ? ` · ${item.detail}` : ''}`,
  at: item.at,
}));

export interface ArtifactViewCapabilities {
  availableViews: ArtifactViewMode[];
  preferredView: ArtifactViewMode;
  hasRenderableDiagram: boolean;
  hasRenderableDocument: boolean;
  reason?: string;
}

const uniqueViews = (views: ArtifactViewMode[]): ArtifactViewMode[] => Array.from(new Set(views));

export const getArtifactViewCapabilities = (artifact: Artifact): ArtifactViewCapabilities => {
  const content = artifact.content.trim();
  const irDiagnostic = extractIRDiagnostic({ content: artifact.content, representation: artifact.representation, type: artifact.type });
  const hasRenderableIR = Boolean(artifact.ir?.nodes?.length) || irDiagnostic.status === 'ok';
  const hasRenderableDocument = content.length > 0;
  const availableViews = uniqueViews([
    ...(hasRenderableIR ? ['diagram', 'split', 'excalidraw', 'lucidchart', 'fable'] as ArtifactViewMode[] : []),
    ...(hasRenderableDocument ? ['document', 'markdown'] as ArtifactViewMode[] : []),
    ...(hasRenderableDocument && isPublicationViewEnabled() ? ['publication'] as ArtifactViewMode[] : []),
  ]);
  const preferredView: ArtifactViewMode = hasRenderableIR
    ? 'diagram'
    : hasRenderableDocument
      ? (/(^|\n)#{1,6}\s+/.test(content) ? 'markdown' : 'document')
      : 'document';
  return {
    availableViews,
    preferredView,
    hasRenderableDiagram: hasRenderableIR,
    hasRenderableDocument,
    reason: irDiagnostic.status === 'ok' ? undefined : irDiagnostic.status,
  };
};

export const resolveSafeArtifactView = (artifact: Artifact, requestedView: ArtifactViewMode): ArtifactViewMode => {
  const capabilities = getArtifactViewCapabilities(artifact);
  if (capabilities.availableViews.includes(requestedView)) return requestedView;
  if (requestedView === 'split' && capabilities.hasRenderableDiagram && capabilities.hasRenderableDocument) return 'split';
  return capabilities.preferredView;
};
