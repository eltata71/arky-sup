import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile, shouldExportPublication } from './shared';

const publicationDiagram = (context: ExportContext) => context.presentationModel?.diagrams[0];

export const mermaidExporter: ExportAdapter = {
  format: 'mermaid',
  async export(context) {
    const content = shouldExportPublication(context) ? publicationDiagram(context)?.mermaid : context.artifact.content;
    if (!content?.trim()) throw new Error('No hay código Mermaid exportable.');
    const blob = new Blob([content], { type: EXPORT_DEFINITIONS.mermaid.mimeType });
    return buildFile(context, 'mermaid', blob);
  },
};

export const diagramJsonExporter: ExportAdapter = {
  format: 'diagram-json',
  async export(context) {
    const diagram = shouldExportPublication(context) ? publicationDiagram(context) : null;
    const payload = diagram
      ? { schema: 'arky.presentation.diagram.v1', diagram: { ...diagram, ir: diagram.ir ?? null }, modelId: context.presentationModel?.id }
      : context.artifact.ir ?? { content: context.artifact.content };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: EXPORT_DEFINITIONS['diagram-json'].mimeType });
    return buildFile(context, 'diagram-json', blob);
  },
};
